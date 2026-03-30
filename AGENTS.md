## Learned User Preferences

- Telegram must always be kept in-tree and never removed during upstream merges; user explicitly corrected this mid-merge with "don't remove telegram".
- When asked to investigate why an agent isn't responding, check container logs and the running container list before drawing conclusions.
- User prefers to understand the existing defense mechanisms in the codebase before implementing new ones; ask "is this already defended?" is a recurring pattern.
- OpenCode SDK (`@opencode-ai/sdk`) is integrated as an alternative agent backend alongside `@anthropic-ai/claude-agent-sdk`. Switch via `AGENT_RUNNER=opencode` in `.env`; no rebuild required.

## Learned Workspace Facts

- `.cursor/` is in `.gitignore` so the working tree stays clean for git operations; this was added during an upstream merge to unblock the workflow.
- WhatsApp channel only connects when `store/auth/creds.json` exists; Telegram channel only connects when `TELEGRAM_BOT_TOKEN` is set in `.env`. Both can coexist.
- The stale-session defense in `src/index.ts` (`runAgent`) is narrow: it only retries without a session when the error text includes `'No conversation found with session ID'`; other SDK errors fall through.
- When `AGENT_RUNNER=anthropic` (default), containers use `query()` from `@anthropic-ai/claude-agent-sdk`; sessions are passed as `resume: sessionId`. When `AGENT_RUNNER=opencode`, the OpenCode runner (`container/agent-runner/src/runners/opencode.ts`) uses `createOpencode()` + SSE events; sessions carry `ses_` prefixed IDs. A guard in `src/index.ts` auto-discards incompatible session IDs on runner switch.
- Credential proxy (`src/credential-proxy.ts`) injects the real API key / OAuth token; containers only receive a placeholder key and `ANTHROPIC_BASE_URL` pointing to the proxy — real credentials never reach the container.
- User runs OpenRouter as the upstream LLM API; `ANTHROPIC_BASE_URL` points to the credential proxy, which forwards to OpenRouter using `ANTHROPIC_AUTH_TOKEN`; the OpenRouter API key env var is `OPENROUTER_API_KEY`.
- During upstream merges, `git stash push -u` is used to handle untracked files that would be overwritten, and the stash is dropped after verifying merge results are correct.
- OpenCode SDK (`@opencode-ai/sdk`): `client.event.subscribe()` returns `{ stream: AsyncGenerator }` — iterate as `for await (const ev of result.stream)`, where `ev` is `{ type, properties }` directly with NO `.payload` wrapper (despite what TypeScript types suggest).
- OpenCode model format is `"provider/model-id"` (e.g. `"openrouter/anthropic/claude-haiku-4.5"` — dots not hyphens in version numbers); models not in OpenCode's built-in registry require custom registration: `provider.<id>.models.<modelId>: { id, name, tool_call: true }` in config.
- OpenCode server (`opencode serve`) lingers on port 4096 after crashes; kill all instances with `pkill -9 -f opencode` before retesting.
- Config is injected via `createOpencode({ config: ... })`; `OPENCODE_CONFIG_CONTENT` env var is used internally by the SDK and should not be set directly.
- Local (stdio) project MCPs are stored in `/root/.claude.json` under `projects["/root/Documents/nanoclaw"].mcpServers` — NOT in `~/.claude/settings.json`. `container-runner.ts` reads this file and writes MCPs into the container's `settings.json` on each spawn so containers always get the latest MCP list.
- OpenCode MCP format for stdio servers: `{ type: 'local', command: string[], environment: { KEY: val } }`. For HTTP servers: `{ type: 'remote', url: string }`. Claude Code's format differs: `{ command, args, env }` (stdio) and `{ type: 'http', url }` (HTTP). `opencode.ts` `buildConfig()` translates between formats at runtime by reading `settings.json`.
