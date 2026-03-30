import * as fs from 'fs';

import { createOpencode } from '@opencode-ai/sdk';

import type { ContainerInput, RunnerOptions, RunnerResult } from './types.js';

// Event types emitted by the OpenCode SSE stream (subset we care about)
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

function buildConfig(mcpServerPath: string, containerInput: ContainerInput): Record<string, unknown> {
  const provider = process.env.OPENCODE_PROVIDER || 'anthropic';
  const model = process.env.OPENCODE_MODEL;
  const smallModel = process.env.OPENCODE_SMALL_MODEL;
  // ANTHROPIC_BASE_URL is already injected into the container env by buildContainerArgs()
  // and points at the credential proxy. Reuse it as baseURL for non-Anthropic providers.
  const proxyUrl = process.env.ANTHROPIC_BASE_URL;

  // Strip "provider/" prefix to get the bare model ID for the registry entry
  const providerModelId = model ? model.replace(new RegExp(`^${provider}/`), '') : undefined;

  // For Anthropic: no explicit provider config — OpenCode inherits ANTHROPIC_BASE_URL
  // and ANTHROPIC_API_KEY=placeholder from the container env automatically via @ai-sdk/anthropic.
  // For all others: point baseURL at the credential proxy so it can inject the real API key.
  const providerOptions: Record<string, unknown> =
    provider === 'anthropic'
      ? {}
      : {
          [provider]: {
            options: { apiKey: 'placeholder', baseURL: proxyUrl },
            // Register the model if it may not be in OpenCode's built-in models.dev registry
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
  // Translates Claude Code's format to OpenCode's McpLocalConfig / McpRemoteConfig.
  const bridgedMcps: Record<string, unknown> = {};
  const settingsPath = '/home/node/.claude/settings.json';
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as {
      mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; type?: string; url?: string }>;
    };
    for (const [name, cfg] of Object.entries(settings.mcpServers ?? {})) {
      if (cfg.command) {
        // Local stdio MCP: { command, args?, env? } → McpLocalConfig
        bridgedMcps[name] = {
          type: 'local',
          command: [cfg.command, ...(cfg.args ?? [])],
          ...(cfg.env ? { environment: cfg.env } : {}),
        };
      } else if (cfg.url) {
        // Remote/HTTP MCP: { type: 'http', url } → McpRemoteConfig
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
    permission: 'allow',    // bypass all tool permission prompts — no TTY in container
    autoupdate: false,       // prevent self-update attempts inside the container
    snapshot: false,         // disable git-based undo/redo tracking (overhead, conflicts with workspace git)
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

/**
 * Stateful OpenCode runner.
 * The server and SSE event stream are created once and reused across
 * multiple prompts in the IPC follow-up loop.
 *
 * Usage:
 *   const runner = await OpenCodeRunner.create(mcpServerPath, containerInput);
 *   try {
 *     while (true) {
 *       const result = await runner.runQuery(opts);
 *       if (result.closedDuringQuery) break;
 *       // wait for IPC, then loop with new prompt
 *     }
 *   } finally {
 *     runner.close();
 *   }
 */
export class OpenCodeRunner {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private server: { url: string; close(): void };
  private stream: AsyncGenerator<OcEvent>;
  private sessionId: string | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private constructor(client: any, server: { url: string; close(): void }, stream: AsyncGenerator<OcEvent>) {
    this.client = client;
    this.server = server;
    this.stream = stream;
  }

  static async create(mcpServerPath: string, containerInput: ContainerInput): Promise<OpenCodeRunner> {
    const config = buildConfig(mcpServerPath, containerInput);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { client, server } = await (createOpencode as any)({ config });
    // event.subscribe() returns { stream: AsyncGenerator<Event> }
    // Events arrive as { type, properties } directly — no .payload wrapper
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventsResult = await (client as any).event.subscribe();
    return new OpenCodeRunner(client, server, eventsResult.stream);
  }

  async runQuery(opts: RunnerOptions): Promise<RunnerResult> {
    const { prompt, sessionId: inputSessionId, onOutput, shouldClose, log } = opts;

    // Create or resume session.
    // OpenCode sessions persist on disk via the XDG_DATA_HOME mount, so passing
    // an existing sessionId from NanoClaw's SQLite lets the agent resume context.
    if (!this.sessionId) {
      if (inputSessionId) {
        // Attempt to resume; if the session no longer exists OpenCode will fire
        // session.error and we fall back to creating a new one in the next call.
        this.sessionId = inputSessionId;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sessResp = await (this.client as any).session.create();
        this.sessionId = sessResp.data?.id as string | undefined;
        if (!this.sessionId) throw new Error('OpenCode: failed to create session');
        log(`OpenCode session created: ${this.sessionId}`);
      }
    }
    const id = this.sessionId;

    // Send prompt asynchronously — returns immediately (HTTP 204), agent runs in background
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.client as any).session.promptAsync({
      path: { id },
      body: { parts: [{ type: 'text', text: prompt }] },
    });

    let closedDuringQuery = false;

    // Buffer all message parts and roles.
    // message.part.updated (streaming text) fires BEFORE message.updated (sets the role),
    // so we cannot filter by role during streaming — we must buffer and resolve at idle.
    const partTextByMessageId = new Map<string, string>();
    const roleByMessageId = new Map<string, string>();
    let lastMessageIdThisTurn: string | undefined;

    // Timeout: if no meaningful event arrives within 90s the session is likely stuck
    // (e.g. resumed a session that was never persisted to disk and OpenCode silently
    // dropped the prompt). Treat as error so NanoClaw can retry with a fresh session.
    const IDLE_TIMEOUT_MS = 90_000;
    let lastEventAt = Date.now();
    const timeoutCheck = setInterval(() => {
      if (Date.now() - lastEventAt > IDLE_TIMEOUT_MS) {
        log(`OpenCode event timeout (${IDLE_TIMEOUT_MS}ms) — aborting session ${id}`);
        this.sessionId = undefined;
        // Break the for-await by closing the server (will cause stream to end)
        this.server.close();
      }
    }, 5000);

    try {
      // Manual iteration with .next() instead of for-await.
      // for-await calls generator.return() on break, which closes the SSE stream and
      // prevents subsequent queries from receiving events. .next() + while preserves
      // the open connection across multiple runQuery() calls on the same runner instance.
      while (true) {
        const { value: ev, done } = await this.stream.next();
        if (done) break;

        // Skip keep-alive and connection events (no meaningful content)
        if (!ev?.type || ev.type === 'server.heartbeat' || ev.type === 'server.connected') continue;

        lastEventAt = Date.now();

        log(`[ev] ${ev.type} ${JSON.stringify(ev.properties).slice(0, 200)}`);

        if (ev.type === 'message.updated') {
          const info = ev.properties?.info as { id?: string; role?: string } | undefined;
          if (info?.id && info?.role) {
            roleByMessageId.set(info.id, info.role);
            // Track the last message seen in this turn to find the final assistant reply
            lastMessageIdThisTurn = info.id;
          }
        }

        if (ev.type === 'message.part.updated') {
          const part = ev.properties?.part as OcPart | undefined;
          // Buffer all text parts keyed by message ID; resolve role at session.idle
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
          const props = ev.properties as { sessionID?: string; error?: { data?: { message?: string } } } | undefined;
          const errMsg =
            props?.error?.data?.message ||
            JSON.stringify(props?.error) ||
            'OpenCode session error';
          log(`OpenCode error: ${errMsg}`);

          // Clear session so the next call creates a fresh one rather than retrying
          // the same bad session — prevents infinite error loops.
          if (props?.sessionID === id) {
            this.sessionId = undefined;
          }

          // Do NOT include newSessionId in error output — NanoClaw would store it and
          // try to resume the same broken session on the next container start.
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

    // Resolve the assistant reply: find the last assistant message from this turn
    let resultText = '';
    for (const [msgId, role] of roleByMessageId) {
      if (role === 'assistant') {
        resultText = partTextByMessageId.get(msgId) ?? resultText;
      }
    }

    if (!closedDuringQuery) {
      onOutput({ status: 'success', result: resultText, newSessionId: id });
    }

    log(`OpenCode query done. result_len=${resultText.length} closedDuringQuery=${closedDuringQuery}`);
    return { newSessionId: id, closedDuringQuery };
  }

  close(): void {
    this.server.close();
  }
}
