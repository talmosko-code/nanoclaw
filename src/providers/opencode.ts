/**
 * Host-side container config for the `opencode` provider.
 *
 * OpenCode's `opencode serve` process stores state under XDG_DATA_HOME, which
 * we pin to a per-session host directory mounted at /opencode-xdg. The
 * OPENCODE_* and ANTHROPIC_BASE_URL are resolved from process.env first, then
 * from the project's .env file (launchd plist often lacks those vars). NO_PROXY /
 * no_proxy are merged so the OpenCode client can reach 127.0.0.1 when OneCLI sets
 * HTTPS_PROXY.
 */
import fs from 'fs';
import path from 'path';

import { readEnvFile } from '../env.js';
import { registerProviderContainerConfig } from './provider-container-registry.js';

const OPENCODE_HOST_ENV_KEYS = [
  'OPENCODE_PROVIDER',
  'OPENCODE_MODEL',
  'OPENCODE_SMALL_MODEL',
  'ANTHROPIC_BASE_URL',
] as const;

/** Optional tuning — merged into the same file read as OPENCODE_* */
const OPENCODE_OPTIONAL_HOST_ENV_KEYS = ['NANOCLAW_OPENCODE_IDLE_TIMEOUT_MS'] as const;

/** process.env overrides .env (for launchd/systemd injections). */
function resolveOpencodeHostEnv(processEnv: NodeJS.ProcessEnv): Record<string, string> {
  const fileEnv = readEnvFile([...OPENCODE_HOST_ENV_KEYS, ...OPENCODE_OPTIONAL_HOST_ENV_KEYS]);
  const out: Record<string, string> = {};
  for (const key of OPENCODE_HOST_ENV_KEYS) {
    const raw = processEnv[key]?.trim() || fileEnv[key];
    if (raw) out[key] = raw;
  }
  for (const key of OPENCODE_OPTIONAL_HOST_ENV_KEYS) {
    const raw = processEnv[key]?.trim() || fileEnv[key];
    if (raw) out[key] = raw;
  }
  return out;
}

function mergeNoProxy(current: string | undefined, additions: string): string {
  if (!current?.trim()) return additions;
  const parts = new Set(
    current
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  for (const addition of additions.split(',')) {
    const trimmed = addition.trim();
    if (trimmed) parts.add(trimmed);
  }
  return [...parts].join(',');
}

registerProviderContainerConfig('opencode', (ctx) => {
  const opencodeDir = path.join(ctx.sessionDir, 'opencode-xdg');
  fs.mkdirSync(opencodeDir, { recursive: true });

  const env: Record<string, string> = {
    XDG_DATA_HOME: '/opencode-xdg',
    NO_PROXY: mergeNoProxy(ctx.hostEnv.NO_PROXY, '127.0.0.1,localhost'),
    no_proxy: mergeNoProxy(ctx.hostEnv.no_proxy, '127.0.0.1,localhost'),
  };
  Object.assign(env, resolveOpencodeHostEnv(ctx.hostEnv));

  return {
    mounts: [{ hostPath: opencodeDir, containerPath: '/opencode-xdg', readonly: false }],
    env,
  };
});
