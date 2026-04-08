import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export const TELEGRAPH_THRESHOLD = 2500;

function getTelegraphToken(): string | undefined {
  return (
    process.env.TELEGRAPH_ACCESS_TOKEN ||
    readEnvFile(['TELEGRAPH_ACCESS_TOKEN']).TELEGRAPH_ACCESS_TOKEN
  );
}

export async function publishToTelegraph(
  title: string,
  text: string,
): Promise<string | null> {
  const token = getTelegraphToken();
  if (!token) return null;
  try {
    const nodes = text
      .split('\n\n')
      .filter(Boolean)
      .map((p) => ({ tag: 'p', children: [p] }));
    const body = JSON.stringify({
      access_token: token,
      title: title.slice(0, 256) || 'NanoClaw',
      content: JSON.stringify(nodes),
    });
    const res = await fetch('https://api.telegra.ph/createPage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const json = (await res.json()) as {
      ok: boolean;
      result?: { url: string };
    };
    if (json.ok && json.result?.url) return json.result.url;
  } catch (err) {
    logger.debug({ err }, 'Telegraph publish failed');
  }
  return null;
}
