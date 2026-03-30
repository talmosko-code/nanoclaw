---
name: debug-group
description: Diagnose why a specific group agent isn't responding. Covers all common failure modes for both AGENT_RUNNER=anthropic and AGENT_RUNNER=opencode.
---

# Debug: Group Won't Answer

Use when a registered group stops responding to messages. Follow the checks in order — each step narrows down the cause.

## Step 0: Identify the group folder

```bash
sqlite3 /root/Documents/nanoclaw/store/messages.db \
  "SELECT jid, name, folder FROM registered_groups;"
```

Use the `folder` value (e.g. `telegram_main`, `whatsapp_lotechni-community`) in all commands below. Replace `<group>` with it.

## Step 1: Is nanoclaw receiving the messages?

```bash
tail -30 /root/Documents/nanoclaw/logs/nanoclaw.log
```

Look for:
- `Telegram message stored` / `WhatsApp message stored` — message reached nanoclaw ✓
- `New messages` → `Processing messages` → `Spawning container agent` — full pipeline ✓

**If no "message stored"**: the channel isn't receiving it. Check:
- Is the bot connected? Look for `Telegram bot connected` / `Connected to WhatsApp` near the top of the log
- For Telegram: is the trigger required? Check `requiresTrigger` in the group's registered_groups entry
- For WhatsApp: does the message start with `@Andy` (or the group's trigger)?

**If "message stored" but no "Spawning container agent"**: the message is being filtered. Check if the sender is on the allowlist, or if a trigger is required but missing.

## Step 2: Is the container running?

```bash
docker ps --filter "name=nanoclaw-<group>" --format "{{.Names}}\t{{.Status}}"
```

**If no container**: the agent was never spawned or already exited. Check the nanoclaw log for errors around the spawn time.

**If container is running**: get its logs:

```bash
docker logs $(docker ps --filter "name=nanoclaw-<group>" --format "{{.Names}}") 2>&1 | grep -v "^npm" | tail -40
```

## Step 3: Read the container logs

Common failure signatures:

### "Model not found: ..."
The `OPENCODE_MODEL` or `OPENCODE_SMALL_MODEL` value is wrong. Check:
- No inline comments: `KEY=value  # comment` — the comment becomes part of the value
- Full `provider/model-id` format: `openrouter/qwen/qwen3.5-flash-02-23`
- Model exists on the provider (`:free` suffix for free-tier OpenRouter models)

Fix: correct `.env`, then run `/restart-agents`.

### "OpenCode event timeout (90000ms)"
The model request went through but no response came back. Causes:
- Paid model with no credits (silent hang)
- Model ID doesn't exist on the provider
- Provider is down

Fix: switch to a known-working model (e.g. `openrouter/qwen/qwen3.5-flash-02-23`), then run `/restart-agents`.

### "ProviderModelNotFoundError" or "Model not found" (session resume)
OpenCode resumed an old session that was created with a different model config. Fix:
```bash
sqlite3 /root/Documents/nanoclaw/store/messages.db \
  "DELETE FROM sessions WHERE group_folder = '<group>';"
rm -rf /root/Documents/nanoclaw/data/sessions/<group>/opencode/
docker kill $(docker ps --filter "name=nanoclaw-<group>" --format "{{.Names}}")
```

### "No channel for JID" or empty output with `result_len=0`
- `result_len=0` with no events: SSE stream problem or model hanging (see timeout above)
- `result_len=0` with events but no text: role buffering issue in the runner

### Container exits in < 2 seconds with no output
Likely a session ID format mismatch (e.g. `ses_...` ID passed to Anthropic runner or UUID to OpenCode). The session guard in `src/index.ts` should catch this automatically — if not, clear the session manually (see above).

### "Credential proxy: OpenCode provider mode" — then nothing
The proxy is routing correctly but the API call is hanging. Check the API key:
```bash
grep "OPENROUTER_API_KEY\|ANTHROPIC" /root/Documents/nanoclaw/.env | grep -v "^#"
```
Make sure the key is set and not expired.

## Step 4: Check env vars actually reaching the container

```bash
docker inspect $(docker ps --filter "name=nanoclaw-<group>" --format "{{.Names}}") \
  --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E "OPENCODE|AGENT_RUNNER|ANTHROPIC_BASE"
```

Compare against active `.env` values:
```bash
grep -E "^OPENCODE|^AGENT_RUNNER" /root/Documents/nanoclaw/.env
```

If they differ, the nanoclaw service needs a restart to pick up `.env` changes.

## Step 5: Stale agent-runner-src mount

NanoClaw mounts the host source into containers at `/app/src`. If you recently rebuilt the container image but didn't sync the host mounts, the container runs old code.

Check:
```bash
md5sum /root/Documents/nanoclaw/container/agent-runner/src/runners/opencode.ts
md5sum /root/Documents/nanoclaw/data/sessions/<group>/agent-runner-src/runners/opencode.ts
```

If hashes differ, sync:
```bash
cd /root/Documents/nanoclaw
cp container/agent-runner/src/runners/opencode.ts \
   data/sessions/<group>/agent-runner-src/runners/opencode.ts
touch container/agent-runner/src/index.ts
```

Then kill the container (it will respawn on the next message).

## Step 6: CLAUDE.md not being read (OpenCode only)

If the agent responds but ignores its name, role, or formatting rules:

```bash
docker logs $(docker ps --filter "name=nanoclaw-<group>" --format "{{.Names}}") 2>&1 \
  | grep "Injected CLAUDE.md"
```

If missing, the group's `CLAUDE.md` isn't being injected. Check that `groups/<group>/CLAUDE.md` exists and is non-empty:
```bash
cat /root/Documents/nanoclaw/groups/<group>/CLAUDE.md
```

## Quick summary of fixes by symptom

| Symptom | Fix |
|---------|-----|
| No message stored | Check channel connection + trigger |
| Model not found | Fix `.env` model name (no inline comments, full prefix) |
| 90s timeout loop | Model needs credits or doesn't exist — switch model |
| Session resume error | Delete SQLite row + OpenCode disk data |
| Wrong env in container | Restart nanoclaw service |
| Old code in container | Sync agent-runner-src mounts |
| Agent ignores CLAUDE.md | Check file exists; stale mount may need sync |
| Container exits instantly | Session ID format mismatch — clear session |

When in doubt, run `/restart-agents` for a full clean restart.
