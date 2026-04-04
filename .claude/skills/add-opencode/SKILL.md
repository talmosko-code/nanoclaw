---
name: add-opencode
description: Add OpenCode SDK as an alternative agent backend to NanoClaw. Lets you run any LLM provider (OpenRouter, OpenAI, Google, DeepSeek, etc.) instead of the Anthropic SDK. Switch between runners via AGENT_RUNNER in .env or per-group in container config.
---

# Add OpenCode Runner

This skill adds [OpenCode SDK](https://github.com/anomalyco/opencode) as an alternative agent backend. After applying, you can switch providers per-group or globally by editing `.env` — no rebuild required (except the initial container rebuild).

## What it does

- Adds `container/agent-runner/src/runners/opencode.ts` — the OpenCode runner (new file)
- Updates `container/agent-runner/src/index.ts` — dispatches by `AGENT_RUNNER` env var; Anthropic code stays inline (minimal change)
- Updates `container/agent-runner/package.json` — adds `@opencode-ai/sdk`
- Updates `container/Dockerfile` — installs `opencode-ai` globally + XDG dirs
- Updates `src/types.ts` — adds shared `AgentRunner` type and per-group `agentRunner` in `ContainerConfig`
- Updates `src/config.ts` — exports `AGENT_RUNNER`
- Updates `src/container-runner.ts` — passes OpenCode env vars, adds session mount
- Updates `src/index.ts` — auto-discards incompatible session IDs on runner switch

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

### 2a. Create the OpenCode runner

```bash
mkdir -p container/agent-runner/src/runners
```

Create `container/agent-runner/src/runners/opencode.ts`:

```typescript
import * as fs from 'fs';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  script?: string;
}

interface RunnerOptions {
  prompt: string;
  sessionId?: string;
  containerInput: ContainerInput;
  mcpServerPath: string;
  sdkEnv: Record<string, string | undefined>;
  resumeAt?: string;
  onOutput: (output: {
    status: 'success' | 'error';
    result: string | null;
    newSessionId?: string;
    error?: string;
  }) => void;
  shouldClose: () => boolean;
  drainIpcInput: () => string[];
  log: (msg: string) => void;
}

interface RunnerResult {
  newSessionId?: string;
  lastAssistantUuid?: string;
  closedDuringQuery: boolean;
}

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

function readClaudeMd(containerInput: ContainerInput): string | undefined {
  const groupPath = '/workspace/group/CLAUDE.md';
  const globalPath = '/workspace/global/CLAUDE.md';
  let content = '';

  if (fs.existsSync(groupPath)) {
    content += fs.readFileSync(groupPath, 'utf-8');
  }

  if (!containerInput.isMain && fs.existsSync(globalPath)) {
    if (content) content += '\n\n---\n\n';
    content += fs.readFileSync(globalPath, 'utf-8');
  }

  return content || undefined;
}

function buildConfig(
  mcpServerPath: string,
  containerInput: ContainerInput,
): Record<string, unknown> {
  const provider = process.env.OPENCODE_PROVIDER || 'anthropic';
  const model = process.env.OPENCODE_MODEL;
  const smallModel = process.env.OPENCODE_SMALL_MODEL;
  const proxyUrl = process.env.ANTHROPIC_BASE_URL;

  const providerModelId = model
    ? model.replace(new RegExp(`^${provider}/`), '')
    : undefined;
  const providerSmallModelId = smallModel
    ? smallModel.replace(new RegExp(`^${provider}/`), '')
    : undefined;

  const modelsToRegister = [providerModelId, providerSmallModelId]
    .filter(Boolean)
    .filter((id, i, a) => a.indexOf(id as string) === i);

  const providerOptions: Record<string, unknown> =
    provider === 'anthropic'
      ? {}
      : {
          [provider]: {
            options: { apiKey: 'placeholder', baseURL: proxyUrl },
            ...(modelsToRegister.length > 0
              ? {
                  models: Object.fromEntries(
                    modelsToRegister.map((id) => [
                      id,
                      { id, name: id, tool_call: true },
                    ]),
                  ),
                }
              : {}),
          },
        };

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
    if (!createOpencode) {
      createOpencode = await getCreateOpencode();
    }
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

    // Re-read CLAUDE.md on every query (unlike Claude Code which does this
    // automatically, OpenCode needs us to inject it each time).
    const claudeMd = readClaudeMd(opts.containerInput);
    const effectivePrompt = claudeMd
      ? `<system>\n${claudeMd}\n</system>\n\n${prompt}`
      : prompt;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.client as any).session.promptAsync({
      path: { id },
      body: { parts: [{ type: 'text', text: effectivePrompt }] },
    });

    let closedDuringQuery = false;
    const partTextByMessageId = new Map<string, string>();
    const roleByMessageId = new Map<string, string>();

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

// Lazy import — only loaded when AGENT_RUNNER=opencode
async function getCreateOpencode() {
  const mod = await import('@opencode-ai/sdk');
  return mod.createOpencode;
}

let createOpencode: typeof import('@opencode-ai/sdk').createOpencode;

OpenCodeRunner.create = async function (
  mcpServerPath: string,
  containerInput: ContainerInput,
): Promise<OpenCodeRunner> {
  if (!createOpencode) {
    createOpencode = await getCreateOpencode();
  }
  const config = buildConfig(mcpServerPath, containerInput);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { client, server } = await (createOpencode as any)({ config });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventsResult = await (client as any).event.subscribe();
  return new OpenCodeRunner(client, server, eventsResult.stream);
};
```

### 2b. Update agent-runner index.ts with dispatch

In `container/agent-runner/src/index.ts`:

1. Add import after the Anthropic SDK import:

```typescript
import { OpenCodeRunner } from './runners/opencode.js';
```

2. Add `RunnerOptions` and `RunnerResult` interfaces (inline, no separate types file):

```typescript
interface RunnerOptions {
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

interface RunnerResult {
  newSessionId?: string;
  lastAssistantUuid?: string;
  closedDuringQuery: boolean;
}
```

3. Add `runOpenCodeLoop` function (before `runScript`):

```typescript
async function runOpenCodeLoop(
  prompt: string,
  sessionId: string | undefined,
  containerInput: ContainerInput,
  mcpServerPath: string,
  sdkEnv: Record<string, string | undefined>,
): Promise<void> {
  const runner = await OpenCodeRunner.create(mcpServerPath, containerInput);

  const runnerOpts: RunnerOptions = {
    prompt,
    sessionId,
    containerInput,
    mcpServerPath,
    sdkEnv,
    onOutput: (output) => {
      writeOutput(output);
    },
    shouldClose,
    drainIpcInput,
    log,
  };

  try {
    while (true) {
      log(`Starting OpenCode query (session: ${sessionId || 'new'})...`);

      const result = await runner.runQuery(runnerOpts);
      if (result.newSessionId) {
        sessionId = result.newSessionId;
        runnerOpts.sessionId = sessionId;
      }

      if (result.closedDuringQuery) {
        log('Close sentinel consumed during OpenCode query, exiting');
        break;
      }

      writeOutput({
        status: 'success',
        result: null,
        newSessionId: sessionId,
      });

      log('OpenCode query ended, waiting for next IPC message...');

      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new query`);
      runnerOpts.prompt = nextMessage;
    }
  } finally {
    runner.close();
  }
}
```

4. In `main()`, add dispatch before the Anthropic query loop:

```typescript
// Select agent runner
const agentRunner = process.env.AGENT_RUNNER || 'anthropic';

if (agentRunner === 'opencode') {
  await runOpenCodeLoop(
    prompt,
    sessionId,
    containerInput,
    mcpServerPath,
    sdkEnv,
  );
  return;
}

// Anthropic/Claude Code runner (default) — existing code stays as-is
```

### 2c. Add SDK dependency

In `container/agent-runner/package.json`, add:

```json
"@opencode-ai/sdk": "^1.3.7"
```

Then run:

```bash
cd container/agent-runner && npm install && cd ../..
```

### 2d. Update the Dockerfile

In `container/Dockerfile`:

1. Update the npm install line:

```dockerfile
RUN npm install -g agent-browser @anthropic-ai/claude-code opencode-ai
```

2. Add XDG directory pre-creation after workspace dirs:

```dockerfile
RUN mkdir -p /home/node/.local/share /home/node/.local/state /home/node/.local/cache \
    && chown -R node:node /home/node/.local
```

### 2e. Add shared AgentRunner type and per-group config

In `src/types.ts`, add the shared type and use it in `ContainerConfig`:

```typescript
export type AgentRunner = 'anthropic' | 'opencode';

export interface ContainerConfig {
  agentRunner?: AgentRunner; // Per-group agent runner selection
  additionalMounts?: AdditionalMount[];
  timeout?: number;
}
```

### 2f. Export AGENT_RUNNER from config.ts

In `src/config.ts`:

1. Add to the `readEnvFile` call:

```typescript
'AGENT_RUNNER',
```

2. Add export:

```typescript
export const AGENT_RUNNER =
  process.env.AGENT_RUNNER || envConfig.AGENT_RUNNER || 'anthropic';
```

### 2g. Update container-runner.ts

1. Import `AGENT_RUNNER` from config and `readEnvFile` from env:

```typescript
import {
  AGENT_RUNNER,
  CONTAINER_IMAGE,
  // ... existing imports
} from './config.js';
import { readEnvFile } from './env.js';
```

2. In `buildVolumeMounts()`, add OpenCode session mount before `return mounts`:

```typescript
// OpenCode session persistence mount (per-group)
const effectiveRunner = group.containerConfig?.agentRunner || AGENT_RUNNER;
if (effectiveRunner === 'opencode') {
  const groupOpencodeDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    'opencode',
  );
  fs.mkdirSync(groupOpencodeDir, { recursive: true });
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

3. In `buildContainerArgs()`, add `group` parameter and pass OpenCode env vars:

```typescript
async function buildContainerArgs(
  group: RegisteredGroup,
  mounts: VolumeMount[],
  containerName: string,
  agentIdentifier?: string,
): Promise<string[]> {
```

After the TZ env var line:

```typescript
// Pass agent runner selection (per-group override or global default)
const effectiveRunner = group.containerConfig?.agentRunner || AGENT_RUNNER;
args.push('-e', `AGENT_RUNNER=${effectiveRunner}`);

// Pass OpenCode provider/model env vars when using opencode runner
if (effectiveRunner === 'opencode') {
  const envVars = readEnvFile([
    'OPENCODE_PROVIDER',
    'OPENCODE_MODEL',
    'OPENCODE_SMALL_MODEL',
  ]);
  if (envVars.OPENCODE_PROVIDER)
    args.push('-e', `OPENCODE_PROVIDER=${envVars.OPENCODE_PROVIDER}`);
  if (envVars.OPENCODE_MODEL)
    args.push('-e', `OPENCODE_MODEL=${envVars.OPENCODE_MODEL}`);
  if (envVars.OPENCODE_SMALL_MODEL)
    args.push('-e', `OPENCODE_SMALL_MODEL=${envVars.OPENCODE_SMALL_MODEL}`);
  args.push('-e', 'XDG_DATA_HOME=/home/node/.local/share');
  // Exclude localhost from OneCLI proxy — OpenCode runs its own local
  // server at 127.0.0.1:4096 that the SDK must reach directly.
  // Without this, the proxy intercepts and closes the connection (ECONNRESET).
  args.push('-e', 'NO_PROXY=127.0.0.1,localhost');
  args.push('-e', 'no_proxy=127.0.0.1,localhost');
}
```

4. Update the call site in `runContainerAgent()`:

```typescript
const containerArgs = await buildContainerArgs(
  group,
  mounts,
  containerName,
  agentIdentifier,
);
```

### 2h. Add session ID guard to index.ts

In `src/index.ts`:

1. Import `AGENT_RUNNER`:

```typescript
import {
  AGENT_RUNNER,
  ASSISTANT_NAME,
  // ... existing imports
} from './config.js';
```

2. In `runAgent()`, replace `const sessionId = sessions[group.folder];` with:

```typescript
const isMain = group.isMain === true;

// Cross-runner session guard: discard session IDs belonging to the wrong runner.
const effectiveRunner = group.containerConfig?.agentRunner || AGENT_RUNNER;
const rawSessionId = sessions[group.folder];
const isOpencodeSession = rawSessionId?.startsWith('ses_');
const sessionId =
  (effectiveRunner === 'opencode') === isOpencodeSession
    ? rawSessionId
    : undefined;
if (rawSessionId && !sessionId) {
  logger.info(
    { group: group.name, staleSession: rawSessionId, runner: effectiveRunner },
    'Discarded stale session ID from different runner',
  );
}
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

If the build cache is stale, prune first:

```bash
docker buildx prune -f
./container/build.sh
```

## Phase 4: Configuration

### Global switch (all groups)

Edit `.env`:

```bash
AGENT_RUNNER=opencode
OPENCODE_PROVIDER=openrouter
OPENCODE_MODEL=openrouter/qwen/qwen3.5-flash-02-23
OPENCODE_SMALL_MODEL=openrouter/qwen/qwen3.5-flash-02-23
OPENROUTER_API_KEY=sk-or-v1-...
```

### Per-group switch

Set `agentRunner` in the group's `container_config` JSON in the database:

```sql
UPDATE registered_groups
SET container_config = json_set(
  COALESCE(container_config, '{}'),
  '$.agentRunner',
  'opencode'
)
WHERE folder = 'telegram_main';
```

Or via the IPC/register command — the `containerConfig.agentRunner` field is respected when spawning containers.

When a group has `agentRunner` set in its config, it overrides the global `AGENT_RUNNER` from `.env`. This lets you run some groups on OpenCode and others on Anthropic simultaneously.

### Supported providers

| Provider      | `OPENCODE_PROVIDER` | API Key Env Var                | OneCLI host pattern                 |
| ------------- | ------------------- | ------------------------------ | ----------------------------------- |
| Anthropic     | `anthropic`         | `ANTHROPIC_API_KEY`            | `api.anthropic.com`                 |
| OpenRouter    | `openrouter`        | `OPENROUTER_API_KEY`           | `openrouter.ai`                     |
| OpenAI        | `openai`            | `OPENAI_API_KEY`               | `api.openai.com`                    |
| Google Gemini | `google`            | `GOOGLE_GENERATIVE_AI_API_KEY` | `generativelanguage.googleapis.com` |
| DeepSeek      | `deepseek`          | `DEEPSEEK_API_KEY`             | `api.deepseek.com`                  |
| Groq          | `groq`              | `GROQ_API_KEY`                 | `api.groq.com`                      |
| Mistral       | `mistral`           | `MISTRAL_API_KEY`              | `api.mistral.ai`                    |
| xAI Grok      | `xai`               | `XAI_API_KEY`                  | `api.x.ai`                          |
| Together AI   | `together`          | `TOGETHER_API_KEY`             | `api.together.xyz`                  |
| Fireworks     | `fireworks`         | `FIREWORKS_API_KEY`            | `api.fireworks.ai`                  |
| Cohere        | `cohere`            | `COHERE_API_KEY`               | `api.cohere.ai`                     |
| Moonshot      | `moonshot`          | `MOONSHOT_API_KEY`             | `api.moonshot.cn`                   |

### Register provider keys in OneCLI

OneCLI is a host-pattern MITM proxy — it doesn't automatically know about providers. You must register each provider's key with its hostname:

```bash
# Example: register OpenRouter
onecli secrets create --name OpenRouter --type api_key \
  --value sk-or-v1-... --host-pattern openrouter.ai

# Example: register Google
onecli secrets create --name Google --type api_key \
  --value your-key --host-pattern generativelanguage.googleapis.com
```

Without this step, OneCLI forwards the request unchanged (with the placeholder key) and the provider returns an auth error.

### Restart NanoClaw

```bash
# macOS
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux (systemd)
systemctl --user restart nanoclaw
```

## Phase 5: Verify

Send a message to your registered group and check for a response.

Check container logs:

```bash
docker logs $(docker ps --format '{{.Names}}' | grep nanoclaw | head -1)
```

Key log lines:

- `[agent-runner] Starting OpenCode query` — runner selected correctly
- `[agent-runner] OpenCode session created: ses_...` — session started
- `[agent-runner] OpenCode session idle` — response received
- `[agent-runner] OpenCode query done. result_len=N` — N > 0 means success

## Switching Back to Anthropic

Set `AGENT_RUNNER=anthropic` in `.env` (or per-group via `container_config`). Restart NanoClaw. The session guard automatically discards any stored `ses_...` session IDs.

## Architecture Notes

**Security**: Credentials are injected by OneCLI gateway — containers never see real API keys. The OpenCode runner sends requests to `ANTHROPIC_BASE_URL` (the OneCLI proxy) with a placeholder key, which OneCLI intercepts and replaces with the real key from `.env`.

**Sessions**: OpenCode sessions persist on disk at `data/sessions/<group>/opencode/` (mounted into the container). Per-group isolation.

**MCPs**: Any MCP added via `claude mcp add` is automatically bridged to OpenCode.

**CLAUDE.md**: The runner reads `/workspace/group/CLAUDE.md` (and `/workspace/global/CLAUDE.md` for non-main groups) and prepends it to every prompt inside `<system>` tags. This matches Claude Code's behavior of re-reading it on every turn. OpenCode doesn't read CLAUDE.md from the filesystem automatically, so the runner injects it manually.

**Per-group runner selection**: The `agentRunner` field in `containerConfig` overrides the global `AGENT_RUNNER`. This is stored in the `container_config` JSON column in the database — no schema migration needed.

## Known Gotchas

### 1. SSE stream closes on `for-await break` — use `.next()` instead

`for await (const ev of this.stream) { ... break; }` calls `generator.return()` on break, which closes the underlying SSE HTTP connection. The second call to `runQuery()` then iterates a closed generator and exits immediately with no events. **Symptom**: first message works, all follow-up messages produce `result_len=0` with no `[ev]` log lines. **Fix**: use `while (true) { const { value, done } = await this.stream.next(); ... }`.

### 2. `message.part.updated` fires before `message.updated`

Streaming text parts arrive _before_ the message's role is set. If you filter `part.updated` events by role eagerly, you miss all text and get empty results. **Fix**: buffer all text parts keyed by `messageID`, then resolve roles from `message.updated` events at `session.idle`.

### 3. Stale session IDs break the opposite runner

OpenCode session IDs start with `ses_`; Anthropic/Claude Code IDs are UUIDs. The session guard in `src/index.ts` handles this automatically.

### 4. `newSessionId` must NOT be emitted on session errors

If `session.error` triggers `onOutput({ ..., newSessionId })`, NanoClaw stores the broken session ID and tries to resume it on the next container start, causing an infinite error loop. Always omit `newSessionId` from error outputs.

### 5. XDG_DATA_HOME must be set explicitly

Without `XDG_DATA_HOME=/home/node/.local/share`, OpenCode writes session state to its default location which may not be the mounted volume.

### 6. `OPENCODE_SMALL_MODEL` defaults to a different model

If unset, OpenCode picks its own default small model for title generation. This causes a second unexpected API call. Set `OPENCODE_SMALL_MODEL` to the same model as `OPENCODE_MODEL`.

### 7. `message.updated` role resolution

The `roleByMessageId` map must be populated from `message.updated` events, not from `message.part.updated` events. The part events arrive first but don't have role info.

### 8. Models not in OpenCode's registry need explicit registration

If the model isn't in OpenCode's built-in database, `createOpencode()` will fail. Register it under the `provider` config key with `{ id, name, tool_call: true }`.

### 9. NO_PROXY must exclude localhost when using OneCLI

OneCLI is a transparent MITM proxy that intercepts ALL outbound HTTPS from the container. OpenCode runs its own local server at `127.0.0.1:4096` that the SDK communicates with. Without `NO_PROXY=127.0.0.1,localhost`, the proxy intercepts these local requests and closes the connection, causing `ECONNRESET` / "other side closed" crashes. The skill adds this env var automatically in `container-runner.ts`.

### 10. CLAUDE.md is re-read on every prompt

Unlike Claude Code's SDK which re-reads `CLAUDE.md` automatically each turn, OpenCode has no such mechanism. The runner reads the file and prepends it inside `<system>` tags on every `runQuery()` call, so changes to `CLAUDE.md` take effect on the next message without a session reset.

### 11. Inline `.env` comments get included in values

`.env` files do NOT support inline comments. `KEY=value  # comment` sets the value to `value  # comment`. Always put comments on their own line above the key.
