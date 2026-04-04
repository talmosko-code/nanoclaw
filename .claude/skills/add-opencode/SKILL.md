---
name: add-opencode
description: Add OpenCode SDK as an alternative agent backend to NanoClaw. Lets you run any LLM provider (OpenRouter, OpenAI, Google, DeepSeek, etc.) instead of the Anthropic SDK. Switch between runners via AGENT_RUNNER in .env with no code changes.
---

# Add OpenCode Runner

This skill adds [OpenCode SDK](https://github.com/anomalyco/opencode) as a second agent backend alongside the existing Anthropic/Claude Code runner. After applying, you can switch providers by editing `.env` and restarting — no rebuild required.

## What it does

- Adds `container/agent-runner/src/runners/opencode.ts` — the OpenCode runner
- Adds `container/agent-runner/src/runners/types.ts` — shared runner interfaces
- Refactors `container/agent-runner/src/runners/anthropic.ts` — extracts existing Anthropic logic
- Updates `container/agent-runner/src/index.ts` — dispatches by `AGENT_RUNNER`
- Updates `container/agent-runner/package.json` — adds `@opencode-ai/sdk`
- Updates `container/Dockerfile` — installs `opencode-ai` globally
- Updates `src/credential-proxy.ts` — routes non-Anthropic provider traffic + fixes path bug
- Updates `src/container-runner.ts` — passes OC env vars, adds session mount, bridges MCPs
- Updates `src/config.ts` — exports `AGENT_RUNNER`
- Updates `src/index.ts` — auto-discards incompatible session IDs on runner switch
- Documents new variables in `.env`

## Phase 1: Pre-flight

### Check current state

```bash
ls container/agent-runner/src/runners/opencode.ts 2>/dev/null && echo "Already applied" || echo "Not applied"
```

If already applied, skip to Phase 4 (Configuration).

### Check NanoClaw version compatibility

```bash
grep '"version"' package.json
```

This skill requires NanoClaw ≥ 1.2.0 (container runner architecture). If older, run `/update-nanoclaw` first.

## Phase 2: Apply Code Changes

### 2a. Create shared runner types

Create `container/agent-runner/src/runners/types.ts`:

```typescript
export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  script?: string;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

export interface RunnerOptions {
  prompt: string;
  sessionId?: string;
  containerInput: ContainerInput;
  mcpServerPath: string;
  sdkEnv: Record<string, string | undefined>;
  resumeAt?: string;
  onOutput: (output: ContainerOutput) => void;
  shouldClose: () => boolean;
  drainIpcInput: () => string[];
  log: (msg: string) => void;
}

export interface RunnerResult {
  newSessionId?: string;
  lastAssistantUuid?: string;
  closedDuringQuery: boolean;
}
```

Create the runners directory if it doesn't exist:

```bash
mkdir -p container/agent-runner/src/runners
```

### 2b. Extract Anthropic runner

Read the current `container/agent-runner/src/index.ts`. Find the `runQuery` function and `MessageStream` class that implement the Anthropic runner. Move them into a new file `container/agent-runner/src/runners/anthropic.ts` with this signature:

```typescript
import type { RunnerOptions, RunnerResult } from './types.js';

export async function runAnthropicQuery(
  opts: RunnerOptions,
): Promise<RunnerResult> {
  // ... existing runQuery logic ...
}
```

Keep `index.ts` importing and calling `runAnthropicQuery` as before. Import types from `./runners/types.js` instead of defining them inline.

### 2c. Create the OpenCode runner

Create `container/agent-runner/src/runners/opencode.ts`:

```typescript
import * as fs from 'fs';

import { createOpencode } from '@opencode-ai/sdk';

import type { ContainerInput, RunnerOptions, RunnerResult } from './types.js';

interface OcEvent {
  type: string;
  properties?: Record<string, unknown>;
}

interface OcPart {
  id: string;
  messageID: string;
  type: string;
  text?: string;
}

function buildConfig(
  mcpServerPath: string,
  containerInput: ContainerInput,
): Record<string, unknown> {
  const provider = process.env.OPENCODE_PROVIDER || 'anthropic';
  const model = process.env.OPENCODE_MODEL;
  const smallModel = process.env.OPENCODE_SMALL_MODEL;
  // ANTHROPIC_BASE_URL points at the credential proxy — reuse it as baseURL for all providers
  const proxyUrl = process.env.ANTHROPIC_BASE_URL;

  // Strip "provider/" prefix to get the bare model ID for the provider registry
  const providerModelId = model
    ? model.replace(new RegExp(`^${provider}/`), '')
    : undefined;

  const providerOptions: Record<string, unknown> =
    provider === 'anthropic'
      ? {}
      : {
          [provider]: {
            options: { apiKey: 'placeholder', baseURL: proxyUrl },
            ...(providerModelId
              ? {
                  models: {
                    [providerModelId]: {
                      id: providerModelId,
                      name: providerModelId,
                      tool_call: true,
                    },
                  },
                }
              : {}),
          },
        };

  // Bridge MCPs from settings.json (written by container-runner.ts on the host).
  // Translates Claude Code format to OpenCode's McpLocalConfig / McpRemoteConfig.
  const bridgedMcps: Record<string, unknown> = {};
  const settingsPath = '/home/node/.claude/settings.json';
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as {
      mcpServers?: Record<
        string,
        {
          command?: string;
          args?: string[];
          env?: Record<string, string>;
          type?: string;
          url?: string;
        }
      >;
    };
    for (const [name, cfg] of Object.entries(settings.mcpServers ?? {})) {
      if (cfg.command) {
        bridgedMcps[name] = {
          type: 'local',
          command: [cfg.command, ...(cfg.args ?? [])],
          ...(cfg.env ? { environment: cfg.env } : {}),
        };
      } else if (cfg.url) {
        bridgedMcps[name] = { type: 'remote', url: cfg.url };
      }
    }
  } catch {
    // settings.json absent or unreadable — proceed without extra MCPs
  }

  return {
    ...(model ? { model } : {}),
    ...(smallModel ? { small_model: smallModel } : {}),
    enabled_providers: [provider],
    permission: 'allow',
    autoupdate: false,
    snapshot: false,
    provider: providerOptions,
    mcp: {
      nanoclaw: {
        type: 'local',
        command: ['node', mcpServerPath],
        environment: {
          NANOCLAW_CHAT_JID: containerInput.chatJid,
          NANOCLAW_GROUP_FOLDER: containerInput.groupFolder,
          NANOCLAW_IS_MAIN: containerInput.isMain ? '1' : '0',
        },
      },
      ...bridgedMcps,
    },
  };
}

export class OpenCodeRunner {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private server: { url: string; close(): void };
  private stream: AsyncGenerator<OcEvent>;
  private sessionId: string | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private constructor(
    client: any,
    server: { url: string; close(): void },
    stream: AsyncGenerator<OcEvent>,
  ) {
    this.client = client;
    this.server = server;
    this.stream = stream;
  }

  static async create(
    mcpServerPath: string,
    containerInput: ContainerInput,
  ): Promise<OpenCodeRunner> {
    const config = buildConfig(mcpServerPath, containerInput);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { client, server } = await (createOpencode as any)({ config });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventsResult = await (client as any).event.subscribe();
    return new OpenCodeRunner(client, server, eventsResult.stream);
  }

  async runQuery(opts: RunnerOptions): Promise<RunnerResult> {
    const {
      prompt,
      sessionId: inputSessionId,
      onOutput,
      shouldClose,
      log,
    } = opts;

    if (!this.sessionId) {
      if (inputSessionId) {
        this.sessionId = inputSessionId;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sessResp = await (this.client as any).session.create();
        this.sessionId = sessResp.data?.id as string | undefined;
        if (!this.sessionId)
          throw new Error('OpenCode: failed to create session');
        log(`OpenCode session created: ${this.sessionId}`);
      }
    }
    const id = this.sessionId;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.client as any).session.promptAsync({
      path: { id },
      body: { parts: [{ type: 'text', text: prompt }] },
    });

    let closedDuringQuery = false;
    const partTextByMessageId = new Map<string, string>();
    const roleByMessageId = new Map<string, string>();
    let lastMessageIdThisTurn: string | undefined;

    const IDLE_TIMEOUT_MS = 90_000;
    let lastEventAt = Date.now();
    const timeoutCheck = setInterval(() => {
      if (Date.now() - lastEventAt > IDLE_TIMEOUT_MS) {
        log(
          `OpenCode event timeout (${IDLE_TIMEOUT_MS}ms) — aborting session ${id}`,
        );
        this.sessionId = undefined;
        this.server.close();
      }
    }, 5000);

    try {
      // Use .next() instead of for-await: for-await calls generator.return() on break,
      // which closes the SSE stream and prevents subsequent queries from receiving events.
      while (true) {
        const { value: ev, done } = await this.stream.next();
        if (done) break;

        if (
          !ev?.type ||
          ev.type === 'server.heartbeat' ||
          ev.type === 'server.connected'
        )
          continue;

        lastEventAt = Date.now();
        log(`[ev] ${ev.type} ${JSON.stringify(ev.properties).slice(0, 200)}`);

        if (ev.type === 'message.updated') {
          const info = ev.properties?.info as
            | { id?: string; role?: string }
            | undefined;
          if (info?.id && info?.role) {
            roleByMessageId.set(info.id, info.role);
            lastMessageIdThisTurn = info.id;
          }
        }

        if (ev.type === 'message.part.updated') {
          const part = ev.properties?.part as OcPart | undefined;
          if (part?.type === 'text' && part.messageID && part.text) {
            partTextByMessageId.set(part.messageID, part.text);
          }
        }

        if (ev.type === 'session.idle') {
          const props = ev.properties as { sessionID?: string } | undefined;
          if (props?.sessionID === id) {
            log('OpenCode session idle');
            break;
          }
        }

        if (ev.type === 'session.error') {
          const props = ev.properties as
            | { sessionID?: string; error?: { data?: { message?: string } } }
            | undefined;
          const errMsg =
            props?.error?.data?.message ||
            JSON.stringify(props?.error) ||
            'OpenCode session error';
          log(`OpenCode error: ${errMsg}`);
          if (props?.sessionID === id) {
            this.sessionId = undefined;
          }
          onOutput({ status: 'error', result: null, error: errMsg });
          return { closedDuringQuery: false };
        }

        if (shouldClose()) {
          closedDuringQuery = true;
          break;
        }
      }
    } finally {
      clearInterval(timeoutCheck);
    }

    let resultText = '';
    for (const [msgId, role] of roleByMessageId) {
      if (role === 'assistant') {
        resultText = partTextByMessageId.get(msgId) ?? resultText;
      }
    }

    if (!closedDuringQuery) {
      onOutput({ status: 'success', result: resultText, newSessionId: id });
    }

    log(
      `OpenCode query done. result_len=${resultText.length} closedDuringQuery=${closedDuringQuery}`,
    );
    return { newSessionId: id, closedDuringQuery };
  }

  close(): void {
    this.server.close();
  }
}
```

### 2d. Update index.ts dispatch

In `container/agent-runner/src/index.ts`, add dispatch logic in the `main()` function:

```typescript
import { runAnthropicQuery } from './runners/anthropic.js';
import { OpenCodeRunner } from './runners/opencode.js';

// Inside main():
const agentRunner = process.env.AGENT_RUNNER || 'anthropic';

if (agentRunner === 'opencode') {
  await runOpenCodeLoop(prompt, sessionId, containerInput, mcpServerPath);
} else {
  await runAnthropicLoop(
    prompt,
    sessionId,
    containerInput,
    mcpServerPath,
    sdkEnv,
  );
}
```

The `runOpenCodeLoop` function creates an `OpenCodeRunner`, runs the first query, then waits for IPC follow-up messages in a loop (same pattern as the Anthropic loop).

### 2e. Add SDK dependency

In `container/agent-runner/package.json`, add to dependencies:

```json
"@opencode-ai/sdk": "^1.3.7"
```

Then run:

```bash
cd container/agent-runner && npm install && cd ../..
```

### 2f. Update the Dockerfile

In `container/Dockerfile`, find the global npm install line and add `opencode-ai`:

```dockerfile
RUN npm install -g agent-browser @anthropic-ai/claude-code opencode-ai
```

Also add XDG directory pre-creation (prevents EACCES errors when OpenCode writes session state):

```dockerfile
RUN mkdir -p /home/node/.local/share /home/node/.local/state /home/node/.local/cache \
    && chown -R node:node /home/node/.local
```

### 2g. Export AGENT_RUNNER from config.ts

In `src/config.ts`, add:

```typescript
export const AGENT_RUNNER =
  process.env.AGENT_RUNNER || envConfig.AGENT_RUNNER || 'anthropic';
```

### 2h. Extend the credential proxy

In `src/credential-proxy.ts`, add a provider registry and routing logic for OpenCode:

**Critical path bug fix:** change the upstream request path from:

```typescript
path: req.url,
```

to:

```typescript
path: upstreamUrl.pathname.replace(/\/$/, '') + req.url,
```

This ensures the upstream path prefix (e.g. `/api/v1` for OpenRouter) is prepended to the incoming request path. Without this fix, requests to `https://openrouter.ai/api/v1` are forwarded to `openrouter.ai/chat/completions` (missing `/api/v1`), causing 0-token responses.

Also add the `PROVIDER_REGISTRY` and `resolveOcProvider()` logic that routes based on `OPENCODE_PROVIDER`. See the full implementation — it maps provider IDs to upstream URLs, auth styles (`bearer`, `x-api-key`, `goog-key`), and env var key names. The API key is always read from the host `.env` and injected by the proxy; it is never sent to the container.

### 2i. Extend container-runner.ts

**Pass OpenCode env vars to containers:**

In `buildContainerArgs()`, add:

```typescript
const envVars = readEnvFile([
  'AGENT_RUNNER',
  'OPENCODE_PROVIDER',
  'OPENCODE_MODEL',
  'OPENCODE_SMALL_MODEL',
]);
if (envVars.AGENT_RUNNER)
  args.push('-e', `AGENT_RUNNER=${envVars.AGENT_RUNNER}`);
if (envVars.OPENCODE_PROVIDER)
  args.push('-e', `OPENCODE_PROVIDER=${envVars.OPENCODE_PROVIDER}`);
if (envVars.OPENCODE_MODEL)
  args.push('-e', `OPENCODE_MODEL=${envVars.OPENCODE_MODEL}`);
if (envVars.OPENCODE_SMALL_MODEL)
  args.push('-e', `OPENCODE_SMALL_MODEL=${envVars.OPENCODE_SMALL_MODEL}`);
if (envVars.AGENT_RUNNER === 'opencode') {
  args.push('-e', 'XDG_DATA_HOME=/home/node/.local/share');
}
```

**Add OpenCode session persistence mount:**

In `buildVolumeMounts()`, add a per-group volume for OpenCode session data:

```typescript
if (envVars.AGENT_RUNNER === 'opencode') {
  const groupOpencodeDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    'opencode',
  );
  fs.mkdirSync(groupOpencodeDir, { recursive: true });
  // ensure node user can write
  try {
    fs.chownSync(groupOpencodeDir, 1000, 1000);
  } catch {
    fs.chmodSync(groupOpencodeDir, 0o777);
  }
  mounts.push({
    hostPath: groupOpencodeDir,
    containerPath: '/home/node/.local/share/opencode',
    readonly: false,
  });
}
```

**Bridge MCPs from `~/.claude.json`:**

After building `mcpServers` from `~/.claude/.credentials.json`, also read local stdio MCPs from `~/.claude.json`:

```typescript
const claudeJsonPath = path.join(os.homedir(), '.claude.json');
if (fs.existsSync(claudeJsonPath)) {
  try {
    const claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
    const projectMcps = claudeJson.projects?.[process.cwd()]?.mcpServers ?? {};
    for (const [name, cfg] of Object.entries(projectMcps) as Array<
      [string, Record<string, unknown>]
    >) {
      if (cfg.command) {
        mcpServers[name] = cfg; // pass through Claude Code format; opencode.ts translates at runtime
      }
    }
  } catch {
    /* ignore */
  }
}
```

This automatically makes any MCP added via `claude mcp add` available to OpenCode without extra config.

### 2j. Add runner-switching guard to index.ts

In the function that calls the container agent, add a guard that discards session IDs belonging to the wrong runner:

```typescript
import { AGENT_RUNNER } from './config.js';

// When reading the stored session ID for a group:
const rawSessionId = sessions[group.folder];
const isOpencodeSession = rawSessionId?.startsWith('ses_');
const sessionId =
  (AGENT_RUNNER === 'opencode') === isOpencodeSession
    ? rawSessionId
    : undefined;
```

OpenCode session IDs start with `ses_`; Anthropic/Claude Code session IDs are UUIDs. This makes switching `AGENT_RUNNER` in `.env` + restarting seamless — no manual DB cleanup needed.

### 2k. Document new variables in .env

Add to `.env` (and `.env.example` if it exists):

```bash
# OpenCode runner — set AGENT_RUNNER=opencode to switch from Anthropic SDK
# AGENT_RUNNER=opencode
# OPENCODE_PROVIDER=openrouter           # any provider ID (anthropic, openai, openrouter, google, …)
# OPENCODE_MODEL=openrouter/qwen/qwen3.5-flash-02-23   # format: provider/model-id
# OPENCODE_SMALL_MODEL=openrouter/qwen/qwen3.5-flash-02-23  # optional — defaults to provider default
# OPENROUTER_API_KEY=sk-or-v1-...        # injected by credential proxy — never sent to container
#
# For providers not in the built-in registry (no code change needed):
# OPENCODE_PROVIDER_UPSTREAM_URL=https://api.custom.com/v1
# OPENCODE_PROVIDER_AUTH_STYLE=bearer    # bearer | x-api-key | goog-key (default: bearer)
# OPENCODE_PROVIDER_API_KEY_ENV=CUSTOM_API_KEY
```

## Phase 3: Build and Verify

### Build host

```bash
npm run build
```

Fix any TypeScript errors before proceeding.

### Rebuild container image

```bash
./container/build.sh
```

This compiles the container TypeScript (including the new runners) and bakes `opencode-ai` into the image.

### Verify the build

```bash
echo '{"prompt":"say hello in one word","groupFolder":"test","chatJid":"test@g.us","isMain":false}' \
  | docker run -i nanoclaw-agent:latest 2>&1 | grep -E "NANOCLAW_OUTPUT|error"
```

This runs in Anthropic mode (default). Should return `{"status":"success","result":"..."}`.

## Phase 4: Configuration

### Activate OpenCode runner

Edit `.env` to uncomment and set:

```bash
AGENT_RUNNER=opencode
OPENCODE_PROVIDER=openrouter       # or: anthropic, openai, google, deepseek, groq, …
OPENCODE_MODEL=openrouter/qwen/qwen3.5-flash-02-23
OPENCODE_SMALL_MODEL=openrouter/qwen/qwen3.5-flash-02-23
OPENROUTER_API_KEY=sk-or-v1-...
```

Ask the user which provider they want. Supported providers out of the box (key env vars in parentheses):

| Provider         | `OPENCODE_PROVIDER` | API Key Env Var                |
| ---------------- | ------------------- | ------------------------------ |
| Anthropic        | `anthropic`         | `ANTHROPIC_API_KEY`            |
| OpenRouter       | `openrouter`        | `OPENROUTER_API_KEY`           |
| OpenAI           | `openai`            | `OPENAI_API_KEY`               |
| Google Gemini    | `google`            | `GOOGLE_GENERATIVE_AI_API_KEY` |
| DeepSeek         | `deepseek`          | `DEEPSEEK_API_KEY`             |
| Groq             | `groq`              | `GROQ_API_KEY`                 |
| Mistral          | `mistral`           | `MISTRAL_API_KEY`              |
| xAI Grok         | `xai`               | `XAI_API_KEY`                  |
| Together AI      | `together`          | `TOGETHER_API_KEY`             |
| Fireworks        | `fireworks`         | `FIREWORKS_API_KEY`            |
| Cohere           | `cohere`            | `COHERE_API_KEY`               |
| Moonshot (Kimi)  | `moonshot`          | `MOONSHOT_API_KEY`             |
| **OpenCode Zen** | `opencode`          | `OPENCODE_ZEN_API_KEY`         |

### OpenCode Zen

OpenCode Zen is a curated model gateway by the OpenCode team. Models are tested and verified to work well as coding agents.

**Setup:**

1. Sign up at https://opencode.ai/auth
2. Add billing details and copy your API key
3. Set in `.env`:
   ```bash
   OPENCODE_PROVIDER=opencode
   OPENCODE_MODEL=opencode/qwen3.6-plus-free
   OPENCODE_SMALL_MODEL=opencode/qwen3.6-plus-free
   OPENCODE_ZEN_API_KEY=your-zen-api-key
   ```

**Free models:**
| Model ID | Description |
|----------|-------------|
| `qwen3.6-plus-free` | Qwen 3.6 Plus — capable general-purpose model |
| `nemotron-3-super-free` | NVIDIA Nemotron 3 Super |
| `minimax-m2.5-free` | MiniMax M2.5 |
| `mimo-v2-pro-free` | MiMo V2 Pro |
| `mimo-v2-omni-free` | MiMo V2 Omni |
| `big-pickle` | Stealth model (identity unknown) |

**Paid models** (per-request pricing, auto-reload at $5 balance):

- Claude: `claude-sonnet-4-5`, `claude-sonnet-4-6`, `claude-opus-4-5`, `claude-opus-4-6`, `claude-haiku-4-5`
- GPT: `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.3-codex`, `gpt-5.2`, `gpt-5.2-codex`
- Gemini: `gemini-3.1-pro`, `gemini-3-flash`
- Other: `kimi-k2.5`, `glm-5`, `minimax-m2.5`

Full list and pricing: https://opencode.ai/docs/zen/

**Endpoint routing:** Zen uses different endpoints per model type:

- OpenAI-compatible (`qwen`, `kimi`, `glm`, `minimax`): `/v1/chat/completions`
- Anthropic (`claude-*`): `/v1/messages`
- OpenAI (`gpt-*`): `/v1/responses`
- Google (`gemini-*`): `/v1/models/{model}`

The credential proxy forwards all paths correctly since it prepends the upstream base URL to the request path.

For any unlisted provider, use the escape hatch:

```bash
OPENCODE_PROVIDER_UPSTREAM_URL=https://api.custom.com/v1
OPENCODE_PROVIDER_AUTH_STYLE=bearer
OPENCODE_PROVIDER_API_KEY_ENV=CUSTOM_API_KEY
CUSTOM_API_KEY=your-key-here
```

**Model format:** always `provider/model-id`. Examples:

- `openrouter/qwen/qwen3.5-flash-02-23`
- `openrouter/anthropic/claude-haiku-4.5`
- `openai/gpt-4o-mini`
- `google/gemini-2.0-flash`

### Restart NanoClaw

```bash
# macOS
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux (systemd)
systemctl --user restart nanoclaw

# Direct
pkill -f "dist/index.js" && node dist/index.js &
```

## Phase 5: Verify

Send a message to your registered group and check for a response. Then verify OpenRouter (or your provider) logs show a request.

Check container logs if something goes wrong:

```bash
docker logs $(docker ps --format '{{.Names}}' | grep nanoclaw | head -1)
```

Key log lines to look for:

- `[agent-runner] Initializing OpenCode runner...` — runner selected correctly
- `[agent-runner] OpenCode session created: ses_...` — session started
- `[agent-runner] OpenCode session idle` — response received
- `[agent-runner] OpenCode query done. result_len=N` — N > 0 means success

If `result_len=0`: check that the credential proxy is in OpenCode mode (look for `Credential proxy: OpenCode provider mode` in the nanoclaw log) and verify your API key is set correctly.

## Switching Back to Anthropic

Comment out the OpenCode variables in `.env`:

```bash
# AGENT_RUNNER=opencode
# OPENCODE_PROVIDER=...
# etc.
```

Restart NanoClaw. The runner-switching guard automatically discards any stored `ses_...` session IDs, so the Anthropic runner starts fresh with no manual DB cleanup needed.

## Known Gotchas

These are real issues hit during development. Read before debugging.

### 1. Credential proxy path bug (already fixed in 2h — don't regress)

The proxy's `path: req.url` only forwards the request path, discarding the upstream URL's pathname. When `upstreamUrl = https://openrouter.ai/api/v1`, the proxy would forward to `openrouter.ai/chat/completions` instead of `openrouter.ai/api/v1/chat/completions`. OpenRouter returns its website HTML for `/chat/completions`, which OpenCode parses as 0 tokens. **Symptom**: `result_len=0` with no API errors, 0 tokens in the provider's usage dashboard.

### 2. SSE stream closes on `for-await break` — use `.next()` instead

`for await (const ev of this.stream) { ... break; }` calls `generator.return()` on break, which closes the underlying SSE HTTP connection. The second call to `runQuery()` then iterates a closed generator and exits immediately with no events. **Symptom**: first message works, all follow-up messages produce `result_len=0` with no `[ev]` log lines.

### 3. `message.part.updated` fires before `message.updated`

Streaming text parts arrive _before_ the message's role (`assistant` / `user`) is set. If you filter `part.updated` events by role eagerly, you miss all text and get empty results. **Fix**: buffer all text parts keyed by `messageID`, then resolve roles from `message.updated` events, and collect the final text only at `session.idle`.

### 4. Stale session IDs break the opposite runner

OpenCode session IDs start with `ses_`; Anthropic/Claude Code IDs are UUIDs. If you switch `AGENT_RUNNER` without the guard in 2j, NanoClaw passes an `ses_...` ID to the Anthropic runner (or vice versa), which fails immediately and retries indefinitely. **Symptom**: rapid retry loop, no `Agent output` log lines, containers exit in under a second.

### 5. Docker build cache retains stale COPY layers

`docker build --no-cache` alone does NOT invalidate `COPY` steps when using BuildKit — the builder volume retains old layer content. **Symptom**: your code changes don't appear inside the container even after a rebuild. **Fix**: prune the builder first:

```bash
docker buildx prune -f
./container/build.sh
```

### 6. `agent-runner-src` host mount overrides container `/app/src`

NanoClaw mounts the host's runner source into containers at `/app/src`. After editing runner files, the running container still uses the cached host copy. **Fix**: sync changed files to the group's host mount directory AND touch `index.ts` to invalidate the cache check:

```bash
cp container/agent-runner/src/runners/opencode.ts \
   data/sessions/<group>/agent-runner-src/runners/opencode.ts
touch container/agent-runner/src/index.ts
```

Then restart NanoClaw. The next container spawn will sync the updated source.

### 7. XDG_DATA_HOME must be set explicitly

Without `XDG_DATA_HOME=/home/node/.local/share`, OpenCode writes session state to its default location which may not be the mounted volume. Set it explicitly in the container environment (handled in 2i).

### 8. `OPENCODE_SMALL_MODEL` defaults to a different model

If unset, OpenCode picks its own default small model for title generation (e.g. `anthropic/claude-haiku-4.5` when using OpenRouter). This causes a second unexpected API call. Set `OPENCODE_SMALL_MODEL` to the same model as `OPENCODE_MODEL` to keep everything on one model.

### 9. `newSessionId` must NOT be emitted on session errors

If `session.error` triggers `onOutput({ ..., newSessionId })`, NanoClaw stores the broken session ID and tries to resume it on the next container start, causing an infinite error loop. Always omit `newSessionId` from error outputs.

### 10. `opencode serve` lingers on port 4096 after crashes

When the OpenCode server crashes or the container exits uncleanly, the `opencode` binary can keep listening on port 4096. On the next container start, `createOpencode()` tries to bind the same port and fails immediately. **Symptom**: container starts then dies in under a second with `EADDRINUSE` or similar port-conflict errors. **Fix** (before retesting manually on the host):

```bash
pkill -9 -f opencode
```

Inside the container this resolves automatically because each container run has an isolated network namespace. This issue only affects direct host-side testing (e.g. `docker run -i`).

### 11. SSE events have no `.payload` wrapper — TypeScript types lie

`client.event.subscribe()` returns `{ stream: AsyncGenerator<OcEvent> }`. Each `ev` is `{ type, properties }` directly. The TypeScript type definitions suggest a `.payload` field but it does not exist at runtime. Accessing `ev.payload.*` silently returns `undefined`. Always use `ev.properties.*` for event data.

### 12. Model version numbers use dots, not hyphens

OpenCode model IDs use dots in version suffixes: `openrouter/qwen/qwen3.5-flash-02-23`, not `openrouter/qwen/qwen3-flash-02-23`. Getting this wrong causes `Model not found` errors without a clear hint. Always check the provider's model list for the exact ID.

### 13. Models not in OpenCode's registry need explicit registration in config

If the model isn't in OpenCode's built-in `models.dev` database, `createOpencode()` will fail with a model-not-found error. Register it under the `provider` config key:

```typescript
provider: {
  [providerId]: {
    models: {
      [modelId]: { id: modelId, name: 'Display Name', tool_call: true },
    },
  },
},
```

### 14. Never set `OPENCODE_CONFIG_CONTENT` directly

The OpenCode SDK uses `OPENCODE_CONFIG_CONTENT` internally to pass the JSON config blob to the spawned `opencode serve` process. Setting this env var yourself will be overwritten or cause conflicts. Always inject config via `createOpencode({ config: ... })`.

### 15. OpenCode does NOT read `CLAUDE.md` automatically — inject it into the first prompt

Claude Code's SDK reads `CLAUDE.md` from `cwd` automatically. OpenCode has no such mechanism — it ignores the filesystem entirely for system instructions. The fix: read `/workspace/group/CLAUDE.md` (and `/workspace/global/CLAUDE.md` for non-main groups) at the start of the first `runQuery()` call and prepend the content to the prompt inside `<system>` tags:

```typescript
if (!this.claudeMdInjected) {
  const claudeMd = readClaudeMd(opts.containerInput);
  if (claudeMd) {
    effectivePrompt = `<system>\n${claudeMd}\n</system>\n\n${prompt}`;
  }
  this.claudeMdInjected = true;
}
```

Only inject on the first query — subsequent turns in the same session already have it in history. **Symptom if missing**: agent ignores its name, role, formatting rules, and any group-specific instructions. It may respond as a generic assistant or identify itself as a different model.

### 16. Register both main and small models, not just the main model

`buildConfig()` originally only registered the main model. When `OPENCODE_SMALL_MODEL` differs from `OPENCODE_MODEL`, OpenCode tries to use the small model for title generation and fails with `Model not found`. Register all unique model IDs:

```typescript
const modelsToRegister = [providerModelId, providerSmallModelId]
  .filter(Boolean)
  .filter((id, i, a) => a.indexOf(id) === i); // deduplicate

models: Object.fromEntries(
  modelsToRegister.map((id) => [id, { id, name: id, tool_call: true }]),
),
```

### 17. Inline `.env` comments get included in env var values

`.env` files do NOT support inline comments. `KEY=value  # comment` sets the value to `value  # comment` — the comment becomes part of the string. OpenCode then tries to find a model named `openrouter/qwen/qwen3.5-flash-02-23   # format: provider/model-id`. **Symptom**: `Model not found: openrouter/qwen/qwen3.5-flash-02-23   # format:...` with the comment text in the error. Always put comments on their own line above the key.

### 18. OpenRouter shows "Unknown" app unless you set identifying headers

OpenRouter uses `X-Title` and `HTTP-Referer` request headers to label traffic in its dashboard. Without them, every request shows as "Unknown". Add these in the credential proxy when `OPENCODE_PROVIDER=openrouter`:

```typescript
if (secrets.OPENCODE_PROVIDER === 'openrouter') {
  headers['x-title'] = 'NanoClaw';
  headers['http-referer'] = 'https://github.com/qwibitai/nanoclaw';
}
```

---

## Adding a New Provider

The credential proxy has a built-in `PROVIDER_REGISTRY` in `src/credential-proxy.ts`. Adding a new provider requires **two steps** — no code changes to the runner or container are needed.

### Step 1: Add to PROVIDER_REGISTRY

In `src/credential-proxy.ts`, add an entry to the `PROVIDER_REGISTRY` object:

```typescript
myprovider: {
  upstream: 'https://api.myprovider.com/v1',
  auth: 'bearer',           // 'bearer' | 'x-api-key' | 'goog-key'
  envKey: 'MYPROVIDER_API_KEY',
},
```

| Field      | Description                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upstream` | The base URL of the provider's API. The proxy prepends this to the incoming request path. For OpenAI-compatible APIs, this is typically `https://api.provider.com/v1`. |
| `auth`     | How the API key should be sent. `bearer` → `Authorization: Bearer <key>`, `x-api-key` → `x-api-key: <key>`, `goog-key` → `x-goog-api-key: <key>`.                      |
| `envKey`   | The name of the env var in `.env` that holds the real API key.                                                                                                         |

### Step 2: Add to .env

```bash
OPENCODE_PROVIDER=myprovider
OPENCODE_MODEL=myprovider/model-name
OPENCODE_SMALL_MODEL=myprovider/model-name
MYPROVIDER_API_KEY=your-key-here
```

### Step 3: Rebuild and restart

```bash
npm run build
systemctl restart nanoclaw
```

### Unlisted providers (escape hatch — no code change needed)

For providers you don't want to add to the registry, use the escape hatch in `.env`:

```bash
OPENCODE_PROVIDER=custom
OPENCODE_MODEL=custom/some-model
OPENCODE_PROVIDER_UPSTREAM_URL=https://api.custom.com/v1
OPENCODE_PROVIDER_AUTH_STYLE=bearer
OPENCODE_PROVIDER_API_KEY_ENV=CUSTOM_API_KEY
CUSTOM_API_KEY=your-key-here
```

### How it works

1. The OpenCode runner sends all API requests to `ANTHROPIC_BASE_URL` (the credential proxy) with a placeholder key
2. The proxy looks up the provider in `PROVIDER_REGISTRY` (or uses escape-hatch env vars)
3. It strips the placeholder auth, injects the real key from `.env`, and forwards to the actual upstream
4. The container never sees real credentials

### Provider endpoint compatibility

Most LLM providers offer an **OpenAI-compatible** endpoint at `/v1/chat/completions`. These work out of the box with `auth: 'bearer'`:

- OpenRouter, OpenAI, DeepSeek, Groq, Mistral, xAI, Together, Fireworks, Cohere, Perplexity, Cerebras, SambaNova, Moonshot

Providers with **different auth styles**:

- Anthropic: `x-api-key` header at `https://api.anthropic.com`
- Google AI Studio: `goog-key` (`x-goog-api-key`) — but note Google's native API is NOT OpenAI-compatible; use the `/v1beta/openai` endpoint with `bearer` auth instead
- OpenCode Zen: `bearer` auth at `https://opencode.ai/zen` (routes to different sub-endpoints per model type)

---

## Architecture Notes

**Security**: API keys never enter the container. The container always sends requests to the credential proxy at `ANTHROPIC_BASE_URL` (the host's docker bridge IP). The proxy injects the real key and forwards to the actual LLM API.

**Sessions**: OpenCode sessions persist on disk at `data/sessions/<group>/opencode/` (mounted into the container). This gives the agent per-group memory across container restarts, identical to how Anthropic sessions work.

**MCPs**: Any MCP added via `claude mcp add` in the nanoclaw project directory is automatically bridged to OpenCode. Local stdio MCPs (`command`/`args`/`env` format) are translated to OpenCode's `McpLocalConfig`; HTTP MCPs are translated to `McpRemoteConfig`. No extra config needed.

**Skills**: NanoClaw syncs all skills from `container/skills/` into each group's session directory at `data/sessions/<group>/skills/`. This directory is mounted into the container at `/home/node/.claude/skills/`. OpenCode discovers these skills automatically via its `.claude/skills/*/SKILL.md` discovery path. Skills are available to the agent through the native `skill` tool — no extra config needed. To add a new skill, create a folder under `container/skills/<name>/SKILL.md` and it will be synced to all groups on next container spawn.

**CLAUDE.md**: Each group has its own `CLAUDE.md` at `groups/<group>/CLAUDE.md` (e.g. `groups/telegram_main/CLAUDE.md`). This is mounted into the container at `/workspace/group/CLAUDE.md`. The OpenCode runner reads this file at the start of the first query and prepends it to the prompt inside `<system>` tags. Non-main groups also get the global `groups/global/CLAUDE.md` appended. This gives each group its own identity, formatting rules, and behavioral instructions.

**SSE stream**: The event stream is created once per container lifecycle and reused across all IPC follow-up messages. Manual `.next()` iteration (not `for-await`) is used to prevent the stream from closing between queries.
