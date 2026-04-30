import type { McpServerConfig } from './types.js';

/** Loose JSON shape from container.json — may omit optional fields or use HTTP MCP. */
type LoadedMcpEntry = Partial<McpServerConfig> &
  Record<string, unknown> & {
    type?: string;
    url?: string;
    headers?: Record<string, string>;
  };

/** OpenCode `mcp` entry shape (local stdio server). */
export type OpenCodeMcpLocal = {
  type: 'local';
  command: string[];
  environment?: Record<string, string>;
  enabled: true;
};

/** OpenCode `mcp` entry shape (remote HTTP server). */
export type OpenCodeMcpRemote = {
  type: 'remote';
  url: string;
  headers?: Record<string, string>;
  enabled: true;
};

export type OpenCodeMcpEntry = OpenCodeMcpLocal | OpenCodeMcpRemote;

/**
 * Map NanoClaw v2 MCP definitions (from container.json) into OpenCode `mcp`:
 * local stdio (`command` + optional `args` / `env`), or remote HTTP when
 * `url` is set (optional `type`: http | remote | sse) and optional `headers`.
 */
export function mcpServersToOpenCodeConfig(
  servers: Record<string, LoadedMcpEntry | McpServerConfig> | undefined,
): Record<string, OpenCodeMcpEntry> {
  const out: Record<string, OpenCodeMcpEntry> = {};
  if (!servers) return out;
  for (const [name, cfg] of Object.entries(servers)) {
    const c = cfg as LoadedMcpEntry;

    const url = typeof c.url === 'string' ? c.url : '';
    const isRemote =
      (c.type === 'http' || c.type === 'remote' || c.type === 'sse') && Boolean(url);

    if (isRemote || (url && !c.command)) {
      out[name] = {
        type: 'remote',
        url,
        ...(c.headers && typeof c.headers === 'object' && Object.keys(c.headers).length > 0
          ? { headers: c.headers as Record<string, string> }
          : {}),
        enabled: true,
      };
      continue;
    }

    const command = typeof c.command === 'string' ? c.command : '';
    if (!command) {
      console.error(`[mcp-to-opencode] skipping "${name}": missing command/url`);
      continue;
    }

    const args = Array.isArray(c.args) ? (c.args as string[]) : [];
    const env =
      c.env && typeof c.env === 'object' && !Array.isArray(c.env)
        ? (c.env as Record<string, string>)
        : {};

    out[name] = {
      type: 'local',
      command: [command, ...args],
      ...(Object.keys(env).length > 0 ? { environment: env } : {}),
      enabled: true,
    };
  }
  return out;
}
