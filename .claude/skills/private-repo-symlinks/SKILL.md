---
name: private-repo-symlinks
description: Fix symlinks from nanoclaw into a sibling private repo (e.g. nanoclaw-private) so agent Docker containers can read them. Use when CLAUDE.local.md or group files seem ignored in the container, or when relative links work on the Mac but break after spawn.
---

# Private-repo symlinks vs Docker agents

NanoClaw agent containers mount **`groups/<folder>/`** read-only at **`/workspace/agent`**. Anything the runtime must **`readFile`** (OpenCode injecting `CLAUDE.local.md`, the agent opening workspace files, etc.) must resolve **inside** that Linux mount.

## The problem

A **relative** symlink stored under `groups/<folder>/`:

```text
../../../nanoclaw-private/groups/foo/CLAUDE.md
```

resolves correctly on macOS relative to `groups/<folder>/` (typically `~/nanoclaw-private/...`).

Inside the container, path resolution starts from **`/workspace/agent`**. Going up three levels reaches **`/`**, so the tail becomes **`/nanoclaw-private/...`** — which **does not exist**. The link is effectively **dangling** from the agent’s POV:

- **`fs.readFileSync('/workspace/agent/CLAUDE.local.md')`** fails or appears empty-skipped  
- **`container/skills`** and similar links under **`container/`** use a **different** relative depth (`../../nanoclaw-private/...` from `container/`); that pattern usually still reaches the sibling repo from the repo root — **confirm** inside a quick `docker exec` read if unsure  
- Symptoms: prompts missing per-group/private copy for OpenCode, `head`/`cat` failing on `CLAUDE.local.md` from `docker exec` with “No such file or directory”, even when the symlink target is an absolute **`/Users/...`** macOS path.

**Important:** Typical Docker Desktop setups **do not** expose `/Users` at `/Users` inside the Linux container. Only directories you bind-mount appear there. Absolute macOS paths in symlink targets are usually **still dangling** from the agent’s viewpoint.

### Trunk NanoClaw: host-resolved snapshot (preferred)

Every container spawn runs **`composeGroupClaudeMd()` on the host**.

**Before that code can run:** the host process must be **`node dist/index.js`** compiled from current `src/` (see `launchd/com.nanoclaw.plist`). After `git pull` or any change under `src/` (including compose), run:

```bash
pnpm run build
```

then restart NanoClaw (`launchctl kickstart …`). If you skip **`pnpm run build`**, old `dist/claude-md-compose.js` **deletes** **`CLAUDE-local.host-resolved.md`** on every reconcile (it is not in `desired` any more on old code), which looks like “private never loads.”

If **`CLAUDE.local.md`** resolves via `realpath()` to **outside** `groups/<folder>/`, the host writes **`groups/<folder>/.claude-fragments/CLAUDE-local.host-resolved.md`** with the inlined text.

- **OpenCode** reads that file first when building the injected context (`container/agent-runner/src/providers/opencode.ts`).
- **Claude Code** resolves the same path through the `@` import chain in composed `CLAUDE.md`, without relying on symlink visibility in Docker.

You can keep symlinked **`CLAUDE.local.md`** for editing on macOS alongside the symlink into `nanoclaw-private`; the snapshot is regenerated every spawn.

## Other fixes (when you need symlink paths to work directly in-container)

Other workspace files symlinked outside `groups/<folder>/` (not **`CLAUDE.local.md`**) may still fail until you **mount** the private repo or copy files in-tree.

### Retarget **`../../../nanoclaw-private`** on the Mac

Keeps nicer relative links on disk (still dangling in Docker unless you also mount)—useful alongside the **`CLAUDE.local`** snapshot pattern:

```bash
export PRIVATE_REPO="$HOME/nanoclaw-private"
bash "${CLAUDE_SKILL_DIR}/scripts/retarget-private-symlinks.sh" "$NANOCLOW_REPO/groups/dm-with-tal"
```

```bash
chmod +x "${CLAUDE_SKILL_DIR}/scripts/retarget-private-symlinks.sh"
"${CLAUDE_SKILL_DIR}/scripts/retarget-private-symlinks.sh" "$NANOCLOW_REPO/groups/my-group" "$HOME/nanoclaw-private"
```

The script only rewrites targets that **exactly** begin with **`../../../nanoclaw-private/`**.

### Mount private repo (**`additionalMounts`**)

Portable across collaborators: expose private content at **`/mnt/…`** inside the VM and symlink **to that Linux path**.

### Runtime note (OpenCode)

For **`provider: opencode`**, the runner prefers **`/workspace/agent/.claude-fragments/CLAUDE-local.host-resolved.md`** before raw **`CLAUDE.local.md`**.

## Verification

Host (**after** spawning once, or manually run **`composeGroupClaudeMd`** wiring):

```bash
head groups/<folder>/.claude-fragments/CLAUDE-local.host-resolved.md
```

Container (when **`CLAUDE.local.md`** escapes the bind-mount, **`head /workspace/agent/CLAUDE.local.md`** may still fail—use the snapshot):

```bash
docker exec <nanoclaw-v2-…> sh -lc 'wc -l /workspace/agent/.claude-fragments/CLAUDE-local.host-resolved.md'
```

## Git / portability caveat

Snapshots live under **`groups/<folder>/.claude-fragments/`** and regenerate every spawn—they can contain inlined private prose; **keep `nanoclaw-private` out of public git** via ignore rules / separate repo checkout. Prefer not committing symlink targets with machine-specific prefixes when teams share main.
