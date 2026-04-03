#!/usr/bin/env node
/**
 * YouTube Fetcher
 *
 * Reads curated channels from /workspace/group/marketing/config/youtube-channels.md,
 * fetches recent videos via RSS (no API key needed), and optionally downloads captions.
 *
 * Output:
 *   /workspace/group/marketing/data/youtube/latest.json
 *   /workspace/group/marketing/data/youtube/latest.md
 *
 * Usage:
 *   npm run youtube:fetch              # Curated channels, last 7 days
 *   npm run youtube:fetch -- --days 14 # Last 14 days
 *   npm run youtube:fetch -- --limit 30 # Max 30 videos
 *
 * Captions are downloaded via youtube-api skill's get-captions.py if available.
 * Key point extraction is left to the topic scout agent (no Gemini API needed here).
 *
 * Environment:
 *   YOUTUBE_API_KEY  - Optional. Enables API-based channel search fallback.
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const OUT_DIR = "/workspace/group/marketing/data/youtube";
const CHANNELS_FILE = "/workspace/group/marketing/config/youtube-channels.md";

// get-captions.py from the youtube-api container skill (soft dependency)
const CAPTIONS_SCRIPT = "/home/node/.claude/skills/youtube-api/get-captions.py";

const DOWNLOAD_DELAY_MS = 2000;
const RSS_DELAY_MS = 1000;

type Channel = {
  name: string;
  channelId: string;
  language: string;
  category: string;
  priority: number;
  notes: string;
};

type Video = {
  id: string;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  channel?: Channel;
};

type ProcessedVideo = {
  id: string;
  title: string;
  url: string;
  channel: string;
  publishedAt: string;
  transcriptPreview: string;
};

function extractYamlValue(block: string, key: string): string | undefined {
  const lines = block.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    const keyPattern = key === "name" ? /^-?\s*name:/ : new RegExp(`^${key}:`);
    if (keyPattern.test(trimmed)) {
      const value = trimmed.slice(trimmed.indexOf(":") + 1).trim();
      return value.replace(/^["'](.+)["']$/, "$1");
    }
  }
  return undefined;
}

async function parseChannels(): Promise<Channel[]> {
  if (!existsSync(CHANNELS_FILE)) {
    console.log("  ⚠️  Channels file not found:", CHANNELS_FILE);
    return [];
  }

  const content = await readFile(CHANNELS_FILE, "utf8");
  const channels: Channel[] = [];
  const yamlRegex = /```yaml\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = yamlRegex.exec(content)) !== null) {
    const yamlBlock = match[1]!;
    const entries = yamlBlock.split(/(?=- name:)/).filter(e => e.trim().startsWith("- name:"));

    for (const entry of entries) {
      const name = extractYamlValue(entry, "name");
      const channelId = extractYamlValue(entry, "channelId");
      if (name && channelId) {
        channels.push({
          name,
          channelId,
          language: extractYamlValue(entry, "language") || "en",
          category: extractYamlValue(entry, "category") || "general",
          priority: parseInt(extractYamlValue(entry, "priority") || "2", 10),
          notes: extractYamlValue(entry, "notes") || "",
        });
      }
    }
  }

  return channels.sort((a, b) => a.priority - b.priority);
}

async function fetchChannelRSS(channel: Channel, days: number): Promise<Video[]> {
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`;
  console.log(`    📡 ${channel.name}`);

  try {
    const response = await fetch(rssUrl, {
      headers: { "User-Agent": "nanoclaw-marketing/1.0" },
    });
    if (!response.ok) {
      console.log(`    ⚠️  RSS failed: ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const videos: Video[] = [];
    const entryRegex = /<entry[\s\S]*?<\/entry>/g;
    const entries = xml.match(entryRegex) || [];

    for (const entry of entries) {
      const idMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const id = idMatch?.[1];
      const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
      const title = titleMatch?.[1] || "Unknown";
      const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);
      const publishedAt = publishedMatch?.[1];

      if (!id || !publishedAt) continue;
      if (new Date(publishedAt) < cutoffDate) continue;

      const descMatch = entry.match(/<media:description>([\s\S]*?)<\/media:description>/);
      const description = descMatch?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").slice(0, 500) || "";

      videos.push({ id, title, description, channelTitle: channel.name, publishedAt, channel });
    }

    console.log(`    ✓ ${videos.length} video(s)`);
    return videos;
  } catch (err) {
    console.log(`    ⚠️  RSS error: ${err}`);
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadCaption(videoId: string): Promise<string | null> {
  if (!existsSync(CAPTIONS_SCRIPT)) return null;

  try {
    const listOutput = execSync(
      `python3 "${CAPTIONS_SCRIPT}" --list "${videoId}" 2>&1`,
      { encoding: "utf8", stdio: "pipe" }
    );

    if (!listOutput.includes("en") && !listOutput.includes("iw") && !listOutput.includes("he")) {
      return null;
    }

    const lang = listOutput.includes("en") ? "en" : "iw";
    const output = execSync(
      `python3 "${CAPTIONS_SCRIPT}" "${videoId}" --lang ${lang} --format txt 2>&1`,
      { encoding: "utf8", stdio: "pipe" }
    );

    if (
      output.includes("403: Forbidden") ||
      output.includes("HTTP Error 403") ||
      output.includes("No captions found") ||
      output.includes("No captions for language")
    ) {
      return null;
    }

    // Find saved transcript file
    const fileMatch = output.match(/to (\/[^\s]+)/);
    if (fileMatch) {
      const transcriptPath = fileMatch[1]!;
      if (existsSync(transcriptPath)) {
        const { readFile } = await import("node:fs/promises");
        return await readFile(transcriptPath, "utf8");
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchYouTube(options: { days: number; limit: number }): Promise<void> {
  console.log("=== YouTube Fetcher ===");
  console.log(`Days: ${options.days}, Limit: ${options.limit}`);
  console.log(`Captions: ${existsSync(CAPTIONS_SCRIPT) ? "available" : "not available (skip)"}`);
  console.log("");

  if (!existsSync(CHANNELS_FILE)) {
    console.error(`Channels file not found: ${CHANNELS_FILE}`);
    console.error("Run /marketing-data-collector to bootstrap config.");
    process.exitCode = 1;
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });

  const channels = await parseChannels();
  console.log(`Found ${channels.length} channels\n`);

  let allVideos: Video[] = [];

  for (let i = 0; i < channels.length; i++) {
    const channel = channels[i]!;
    const videos = await fetchChannelRSS(channel, options.days);
    allVideos.push(...videos);
    if (i < channels.length - 1) await sleep(RSS_DELAY_MS);
  }

  // Deduplicate
  const seen = new Set<string>();
  allVideos = allVideos.filter(v => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });

  allVideos = allVideos.slice(0, options.limit);
  console.log(`\n📊 Processing ${allVideos.length} unique videos...`);

  const processed: ProcessedVideo[] = [];

  for (let i = 0; i < allVideos.length; i++) {
    const video = allVideos[i]!;
    console.log(`[${i + 1}/${allVideos.length}] ${video.title.slice(0, 60)}`);

    const transcript = await downloadCaption(video.id);
    if (transcript) {
      console.log(`    ✓ Caption downloaded (${transcript.length} chars)`);
    }

    processed.push({
      id: video.id,
      title: video.title,
      url: `https://youtube.com/watch?v=${video.id}`,
      channel: video.channelTitle,
      publishedAt: video.publishedAt,
      transcriptPreview: transcript ? transcript.slice(0, 1000) : "",
    });

    if (i < allVideos.length - 1) await sleep(DOWNLOAD_DELAY_MS);
  }

  // Write JSON
  const json = {
    collectedAt: new Date().toISOString(),
    videos: processed,
  };
  await writeFile(path.join(OUT_DIR, "latest.json"), JSON.stringify(json, null, 2), "utf8");

  // Write markdown
  const md = processed
    .map(p => {
      const lines = [`- [${p.title}](${p.url}) — ${p.channel} (${new Date(p.publishedAt).toLocaleDateString()})`];
      if (p.transcriptPreview) lines.push(`  📝 ${p.transcriptPreview.slice(0, 200)}...`);
      return lines.join("\n");
    })
    .join("\n\n");

  await writeFile(
    path.join(OUT_DIR, "latest.md"),
    `# YouTube Videos\n\nCollected: ${json.collectedAt}\n\n${md}\n`,
    "utf8"
  );

  console.log(`\n✅ Done! Processed ${processed.length} videos`);
  console.log(`   JSON: ${path.join(OUT_DIR, "latest.json")}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const daysIndex = args.indexOf("--days");
  const days = daysIndex >= 0 ? parseInt(args[daysIndex + 1]!, 10) : 7;
  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex >= 0 ? parseInt(args[limitIndex + 1]!, 10) : 50;
  await fetchYouTube({ days, limit });
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
