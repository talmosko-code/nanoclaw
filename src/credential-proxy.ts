/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the LLM API.
 * The proxy injects real credentials so containers never see them.
 *
 * Two modes based on AGENT_RUNNER:
 *
 *   AGENT_RUNNER=anthropic (default)
 *     API key:  Proxy injects x-api-key on every request.
 *     OAuth:    Container CLI exchanges its placeholder token for a temp
 *               API key via /api/oauth/claude_cli/create_api_key.
 *               Proxy injects real OAuth token on that exchange request;
 *               subsequent requests carry the temp key which is valid as-is.
 *
 *   AGENT_RUNNER=opencode + OPENCODE_PROVIDER != anthropic
 *     The OpenCode runner sets baseURL to the proxy URL for its provider.
 *     The proxy looks up the provider in PROVIDER_REGISTRY to determine
 *     the real upstream URL and auth style, then injects the correct API key.
 *     For OPENCODE_PROVIDER=anthropic, no change — OpenCode inherits
 *     ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY=placeholder from env and the
 *     existing proxy logic handles it identically to the anthropic runner.
 */
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

type AuthStyle = 'bearer' | 'x-api-key' | 'goog-key';

interface ProviderEntry {
  upstream: string;
  auth: AuthStyle;
  /** Name of the env var holding the real API key */
  envKey: string;
}

/**
 * Built-in registry for common OpenCode providers (sourced from models.dev).
 * ~90% of providers are OpenAI-compatible (Bearer auth).
 * Only Anthropic (x-api-key) and Google (x-goog-api-key) differ.
 *
 * Escape hatch for unlisted providers (no code change needed):
 *   OPENCODE_PROVIDER_UPSTREAM_URL=https://api.custom.com/v1
 *   OPENCODE_PROVIDER_AUTH_STYLE=bearer  (bearer | x-api-key | goog-key)
 *   OPENCODE_PROVIDER_API_KEY_ENV=CUSTOM_API_KEY
 */
const PROVIDER_REGISTRY: Record<string, ProviderEntry> = {
  anthropic: {
    upstream: 'https://api.anthropic.com',
    auth: 'x-api-key',
    envKey: 'ANTHROPIC_API_KEY',
  },
  openai: {
    upstream: 'https://api.openai.com/v1',
    auth: 'bearer',
    envKey: 'OPENAI_API_KEY',
  },
  openrouter: {
    upstream: 'https://openrouter.ai/api/v1',
    auth: 'bearer',
    envKey: 'OPENROUTER_API_KEY',
  },
  google: {
    upstream: 'https://generativelanguage.googleapis.com',
    auth: 'goog-key',
    envKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
  deepseek: {
    upstream: 'https://api.deepseek.com/v1',
    auth: 'bearer',
    envKey: 'DEEPSEEK_API_KEY',
  },
  xai: {
    upstream: 'https://api.x.ai/v1',
    auth: 'bearer',
    envKey: 'XAI_API_KEY',
  },
  mistral: {
    upstream: 'https://api.mistral.ai/v1',
    auth: 'bearer',
    envKey: 'MISTRAL_API_KEY',
  },
  groq: {
    upstream: 'https://api.groq.com/openai/v1',
    auth: 'bearer',
    envKey: 'GROQ_API_KEY',
  },
  together: {
    upstream: 'https://api.together.xyz/v1',
    auth: 'bearer',
    envKey: 'TOGETHER_API_KEY',
  },
  fireworks: {
    upstream: 'https://api.fireworks.ai/inference/v1',
    auth: 'bearer',
    envKey: 'FIREWORKS_API_KEY',
  },
  cohere: {
    upstream: 'https://api.cohere.ai/v1',
    auth: 'bearer',
    envKey: 'COHERE_API_KEY',
  },
  perplexity: {
    upstream: 'https://api.perplexity.ai',
    auth: 'bearer',
    envKey: 'PERPLEXITY_API_KEY',
  },
  cerebras: {
    upstream: 'https://api.cerebras.ai/v1',
    auth: 'bearer',
    envKey: 'CEREBRAS_API_KEY',
  },
  sambanova: {
    upstream: 'https://api.sambanova.ai/v1',
    auth: 'bearer',
    envKey: 'SAMBANOVA_API_KEY',
  },
};

/** Resolve provider entry for AGENT_RUNNER=opencode mode. */
function resolveOcProvider(
  secrets: Record<string, string | undefined>,
): ProviderEntry | null {
  const provider = secrets.OPENCODE_PROVIDER;
  if (!provider || provider === 'anthropic') return null; // handled by existing anthropic logic

  // Env-var overrides take precedence (escape hatch for unlisted providers)
  const upstreamOverride = secrets.OPENCODE_PROVIDER_UPSTREAM_URL;
  const authOverride = secrets.OPENCODE_PROVIDER_AUTH_STYLE as
    | AuthStyle
    | undefined;
  const envKeyOverride = secrets.OPENCODE_PROVIDER_API_KEY_ENV;

  const registered = PROVIDER_REGISTRY[provider];
  if (!registered && !upstreamOverride) {
    logger.warn(
      { provider },
      'OpenCode provider not in registry and no OPENCODE_PROVIDER_UPSTREAM_URL set; proxy will forward as-is',
    );
    return null;
  }

  return {
    upstream: upstreamOverride || registered.upstream,
    auth: authOverride || registered?.auth || 'bearer',
    envKey:
      envKeyOverride ||
      registered?.envKey ||
      `${provider.toUpperCase()}_API_KEY`,
  };
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'AGENT_RUNNER',
    'OPENCODE_PROVIDER',
    'OPENCODE_PROVIDER_UPSTREAM_URL',
    'OPENCODE_PROVIDER_AUTH_STYLE',
    'OPENCODE_PROVIDER_API_KEY_ENV',
  ]);

  // Determine if we're routing an OpenCode non-Anthropic provider
  const ocProvider =
    secrets.AGENT_RUNNER === 'opencode' ? resolveOcProvider(secrets) : null;

  let upstreamUrl: URL;
  let authMode: AuthMode;
  let oauthToken: string | undefined;
  let ocProviderApiKey: string | undefined;
  let ocAuthStyle: AuthStyle | undefined;

  if (ocProvider) {
    // OpenCode mode with a non-Anthropic provider:
    // Route to the provider's real upstream and inject its API key
    const providerKey = readEnvFile([ocProvider.envKey])[ocProvider.envKey];
    upstreamUrl = new URL(ocProvider.upstream);
    ocProviderApiKey = providerKey;
    ocAuthStyle = ocProvider.auth;
    authMode = 'api-key'; // doesn't matter — we handle injection below
    logger.info(
      {
        provider: secrets.OPENCODE_PROVIDER,
        upstream: ocProvider.upstream,
        auth: ocProvider.auth,
      },
      'Credential proxy: OpenCode provider mode',
    );
  } else {
    // Default Anthropic / OpenCode-with-Anthropic mode
    authMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
    oauthToken =
      secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;
    upstreamUrl = new URL(
      secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    );
  }

  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const headers: Record<string, string | number | string[] | undefined> =
          {
            ...(req.headers as Record<string, string>),
            host: upstreamUrl.host,
            'content-length': body.length,
          };

        // Strip hop-by-hop headers that must not be forwarded by proxies
        delete headers['connection'];
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];

        if (ocProvider && ocProviderApiKey) {
          // OpenCode non-Anthropic provider: inject credentials using provider's auth style
          delete headers['x-api-key'];
          delete headers['authorization'];
          delete headers['x-goog-api-key'];
          switch (ocAuthStyle) {
            case 'x-api-key':
              headers['x-api-key'] = ocProviderApiKey;
              break;
            case 'goog-key':
              headers['x-goog-api-key'] = ocProviderApiKey;
              break;
            case 'bearer':
            default:
              headers['authorization'] = `Bearer ${ocProviderApiKey}`;
              break;
          }
        } else if (authMode === 'api-key') {
          // Anthropic API key mode
          delete headers['x-api-key'];
          headers['x-api-key'] = secrets.ANTHROPIC_API_KEY;
        } else {
          // OAuth mode: replace placeholder Bearer token with the real one
          if (headers['authorization']) {
            delete headers['authorization'];
            if (oauthToken) {
              headers['authorization'] = `Bearer ${oauthToken}`;
            }
          }
        }

        const upstream = makeRequest(
          {
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port || (isHttps ? 443 : 80),
            path: upstreamUrl.pathname.replace(/\/$/, '') + req.url,
            method: req.method,
            headers,
          } as RequestOptions,
          (upRes) => {
            res.writeHead(upRes.statusCode!, upRes.headers);
            upRes.pipe(res);
          },
        );

        upstream.on('error', (err) => {
          logger.error(
            { err, url: req.url },
            'Credential proxy upstream error',
          );
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
        });

        upstream.write(body);
        upstream.end();
      });
    });

    server.listen(port, host, () => {
      logger.info({ port, host, authMode }, 'Credential proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}
