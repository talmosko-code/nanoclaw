---
name: restart-agents
description: Kill all running agent containers and optionally clear stored sessions. Use when agents are stuck, using wrong model/config, or need a clean slate after changing .env.
---

# Restart Agents

Kills all running NanoClaw agent containers and optionally wipes their stored sessions so they start completely fresh on the next message.

## When to use

- Agent not responding after changing `OPENCODE_MODEL`, `OPENCODE_PROVIDER`, or `AGENT_RUNNER` in `.env`
- Agent stuck in a broken session loop
- Agent using stale code from an old container build
- You want to force re-injection of an updated `CLAUDE.md`
- Switching between Anthropic and OpenCode runners

## Step 1: Kill all running agent containers

```bash
docker ps --filter "name=nanoclaw-" --format "{{.Names}}" | xargs -r docker kill
```

This stops all active agent containers. NanoClaw's queue manager will spawn fresh ones on the next incoming message.

## Step 2 (optional): Clear stored session IDs

If you also want to wipe the conversation history and start a brand new session:

**Clear all groups:**
```bash
sqlite3 /root/Documents/nanoclaw/store/messages.db \
  "DELETE FROM sessions;"
```

**Clear a specific group only:**
```bash
sqlite3 /root/Documents/nanoclaw/store/messages.db \
  "DELETE FROM sessions WHERE group_folder = 'telegram_main';"
```

> Note: `UPDATE sessions SET session_id = NULL` will fail due to a NOT NULL constraint — use `DELETE` instead.

## Step 3 (optional): Wipe OpenCode on-disk session data

OpenCode persists session state to `data/sessions/<group>/opencode/`. Deleting this forces a truly fresh session even if the SQLite row is also deleted:

**All groups:**
```bash
rm -rf /root/Documents/nanoclaw/data/sessions/*/opencode/
```

**Specific group:**
```bash
rm -rf /root/Documents/nanoclaw/data/sessions/telegram_main/opencode/
```

## Step 4 (optional): Sync updated runner source to host mounts

If you've edited any runner files (`opencode.ts`, `anthropic.ts`, `index.ts`) and want running containers to pick them up without a full container rebuild, sync the source to all group mounts:

```bash
cd /root/Documents/nanoclaw
for dir in data/sessions/*/agent-runner-src/runners/; do
  [ -d "$dir" ] || continue
  cp container/agent-runner/src/runners/opencode.ts "$dir/opencode.ts"
  cp container/agent-runner/src/runners/anthropic.ts "$dir/anthropic.ts"
  echo "Synced $dir"
done
touch container/agent-runner/src/index.ts
```

After syncing, kill the containers (Step 1) and the next spawn will use the new source.

## Full clean restart (all-in-one)

```bash
# Kill containers
docker ps --filter "name=nanoclaw-" --format "{{.Names}}" | xargs -r docker kill

# Clear all sessions (SQLite + disk)
sqlite3 /root/Documents/nanoclaw/store/messages.db "DELETE FROM sessions;"
rm -rf /root/Documents/nanoclaw/data/sessions/*/opencode/

# Restart nanoclaw service
systemctl restart nanoclaw
```

## After restart

Send a message to any registered group. The container spawns fresh, reads the current `.env` values, and (for OpenCode) injects the group's `CLAUDE.md` on the first query.

Check it's working:
```bash
# Watch the app log
tail -f /root/Documents/nanoclaw/logs/nanoclaw.log

# Check container logs once spawned
docker logs $(docker ps --filter "name=nanoclaw-" --format "{{.Names}}" | head -1) 2>&1 | tail -20
```

Key log lines to look for:
- `Spawning container agent` — container starting
- `Injected CLAUDE.md context (N chars)` — group instructions loaded (OpenCode)
- `OpenCode session created: ses_...` — fresh session
- `Agent output: N chars` — response produced
