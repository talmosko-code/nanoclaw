#!/usr/bin/env node
/**
 * Podcast Fetcher
 *
 * Reads active podcast sources from /workspace/group/marketing/config/sources.md,
 * fetches the latest episode per feed, and optionally transcribes audio using
 * faster-whisper (local, no API cost).
 *
 * Output:
 *   /workspace/group/marketing/data/podcasts/latest.json
 *   /workspace/group/marketing/data/podcasts/latest.md
 *
 * Usage:
 *   npm run podcasts:fetch              # Metadata only (fast)
 *   npm run podcasts:fetch-transcribe   # + faster-whisper transcription (slow)
 *
 * Transcription requires faster-whisper to be installed in the container.
 * Models are cached in /workspace/group/marketing/whisper-cache/ (persists between runs).
 * Tune model size via WHISPER_MODEL env var (default: small).
 *
 * Environment:
 *   WHISPER_MODEL          - Model size: tiny|base|small|medium|large (default: small)
 *   WHISPER_CACHE_DIR      - Where to cache models (default: /workspace/group/marketing/whisper-cache)
 *   TRANSCRIPTION_MAX_MINUTES - Max audio minutes to transcribe per episode (default: 20)
 */

import { XMLParser } from "fast-xml-parser";
import { readFile, mkdir, writeFile, unlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import path from "node:path";

const SOURCES_PATH = "/workspace/group/marketing/config/sources.md";
const OUT_DIR = "/workspace/group/marketing/data/podcasts";
const WHISPER_SCRIPT = "/app/marketing-scripts/transcribe.py";
const TRANSCRIPTION_MAX_MINUTES = parseInt(process.env.TRANSCRIPTION_MAX_MINUTES || "20", 10);

const EPISODES_PER_FEED = 1;

type PodcastSource = {
  name: string;
  url: string;
  language: string;
  priority: number;
};

type Episode = {
  podcastName: string;
  title: string;
  url: string;
  description: string;
  pubDate: string;
  mp3Url?: string;
  transcript?: string;
  summaryFile?: string;
};

// ─── Source parsing ───────────────────────────────────────────────────────────

function parsePodcastSources(md: string): PodcastSource[] {
  const yamlBlockRe = /```yaml\n([\s\S]*?)```/g;
  const sources: PodcastSource[] = [];

  let block: RegExpExecArray | null;
  while ((block = yamlBlockRe.exec(md)) !== null) {
    const yaml = block[1]!;
    const lines = yaml.split("\n");
    let current: Partial<PodcastSource & { type: string; active: boolean }> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- name:")) {
        if (current.name && current.url && current.type === "podcast" && current.active !== false) {
          sources.push({
            name: current.name,
            url: current.url,
            language: current.language || "en",
            priority: current.priority || 2,
          });
        }
        current = { name: trimmed.slice(7).trim().replace(/^["']|["']$/g, "") };
      } else if (trimmed.startsWith("type:")) {
        current.type = trimmed.slice(5).trim().replace(/^["']|["']$/g, "");
      } else if (trimmed.startsWith("url:")) {
        current.url = trimmed.slice(4).trim().replace(/^["']|["']$/g, "");
      } else if (trimmed.startsWith("language:")) {
        current.language = trimmed.slice(9).trim().replace(/^["']|["']$/g, "");
      } else if (trimmed.startsWith("priority:")) {
        current.priority = parseInt(trimmed.slice(9).trim(), 10);
      } else if (trimmed.startsWith("active:")) {
        current.active = trimmed.slice(7).trim() !== "false";
      }
    }
    if (current.name && current.url && current.type === "podcast" && current.active !== false) {
      sources.push({
        name: current.name,
        url: current.url,
        language: current.language || "en",
        priority: current.priority || 2,
      });
    }
  }

  return sources.sort((a, b) => a.priority - b.priority);
}

// ─── RSS fetching ─────────────────────────────────────────────────────────────

async function fetchPodcastEpisodes(source: PodcastSource): Promise<Episode[]> {
  console.log(`  📻 ${source.name}`);
  try {
    const response = await fetch(source.url, {
      headers: { "User-Agent": "nanoclaw-marketing/1.0 (podcast-fetcher)" },
    });
    if (!response.ok) {
      console.log(`    ⚠️  HTTP ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseTagValue: false,
      parseAttributeValue: false,
    });

    const data = parser.parse(xml);
    const channel = data?.rss?.channel;
    if (!channel) {
      console.log("    ⚠️  No RSS channel found");
      return [];
    }

    const items = Array.isArray(channel.item) ? channel.item : [channel.item];
    const episodes: Episode[] = [];

    for (let i = 0; i < Math.min(items.length, EPISODES_PER_FEED); i++) {
      const item = items[i];
      const enclosureUrl = item?.enclosure?.["@_url"] || item?.enclosure?.url || "";
      episodes.push({
        podcastName: source.name,
        title: String(item?.title || "Untitled"),
        url: String(item?.link || enclosureUrl || ""),
        description: String(item?.description || item?.["content:encoded"] || "").slice(0, 500),
        pubDate: String(item?.pubDate || ""),
        mp3Url: enclosureUrl ? String(enclosureUrl) : undefined,
      });
    }

    console.log(`    ✓ ${episodes.length} episode(s)`);
    return episodes;
  } catch (err) {
    console.log(`    ⚠️  Error: ${err}`);
    return [];
  }
}

// ─── MP3 extraction (RSS enclosure only — no Playwright) ─────────────────────

async function extractMp3Url(episode: Episode): Promise<string | null> {
  // Already have enclosure URL from RSS
  if (episode.mp3Url) return episode.mp3Url;

  // Try fetching the episode URL to find an enclosure
  if (!episode.url) return null;
  try {
    const response = await fetch(episode.url, {
      headers: { "User-Agent": "nanoclaw-marketing/1.0" },
    });
    if (!response.ok) return null;
    const xml = await response.text();
    const match = xml.match(/<enclosure[^>]+url="([^"]+\.mp3[^"]*)"/i);
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}

// ─── MP3 download (curl, with file validation) ────────────────────────────────

async function downloadMp3(mp3Url: string, outDir: string): Promise<string | null> {
  const tmpPath = path.join(outDir, `tmp_${Date.now()}.mp3`);
  try {
    execSync(
      `curl -L -s -f --max-time 120 \
        -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
        -H "Accept: audio/mpeg,audio/*,*/*" \
        -o "${tmpPath}" "${mp3Url}"`,
      { encoding: "utf8" }
    );

    const fileStat = await stat(tmpPath).catch(() => null);
    if (!fileStat || fileStat.size < 2 * 1024 * 1024) {
      await unlink(tmpPath).catch(() => {});
      console.log(`    ✗ File too small (${fileStat ? Math.round(fileStat.size / 1024) + "KB" : "missing"}) — skipping`);
      return null;
    }

    return tmpPath;
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    console.log(`    ✗ Download failed: ${err}`);
    return null;
  }
}

// ─── Audio trimming (ffmpeg) ──────────────────────────────────────────────────

async function trimMp3(inputPath: string, maxMinutes: number): Promise<string> {
  const trimmedPath = inputPath.replace(".mp3", `_${maxMinutes}min.mp3`);
  try {
    execSync(
      `ffmpeg -y -i "${inputPath}" -t ${maxMinutes * 60} -c copy "${trimmedPath}" 2>/dev/null`,
      { encoding: "utf8" }
    );
    return trimmedPath;
  } catch {
    // ffmpeg not available or failed — use original
    return inputPath;
  }
}

// ─── Whisper transcription ────────────────────────────────────────────────────

function whisperAvailable(): boolean {
  if (!existsSync(WHISPER_SCRIPT)) return false;
  const result = spawnSync("python3", ["-c", "import faster_whisper"], { encoding: "utf8" });
  return result.status === 0;
}

async function transcribeWithWhisper(mp3Path: string): Promise<string | null> {
  const model = process.env.WHISPER_MODEL || "small";
  const cacheDir = process.env.WHISPER_CACHE_DIR || "/workspace/group/marketing/whisper-cache";

  console.log(`    🎙️  Transcribing with faster-whisper (model: ${model})...`);
  try {
    const result = spawnSync(
      "python3",
      [WHISPER_SCRIPT, mp3Path, "--model", model, "--cache-dir", cacheDir],
      { encoding: "utf8", timeout: 600000 } // 10 min timeout
    );
    if (result.status !== 0) {
      console.log(`    ⚠️  Whisper error: ${result.stderr?.slice(0, 200)}`);
      return null;
    }
    const transcript = result.stdout.trim();
    return transcript || null;
  } catch (err) {
    console.log(`    ⚠️  Whisper failed: ${err}`);
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function fetchPodcasts(options: { withTranscription: boolean }): Promise<void> {
  console.log("=== Podcast Fetcher ===");
  console.log(`Transcription: ${options.withTranscription ? "ON (faster-whisper)" : "OFF (metadata only)"}`);
  console.log("");

  if (!existsSync(SOURCES_PATH)) {
    console.error(`Sources file not found: ${SOURCES_PATH}`);
    console.error("Run /marketing-data-collector to bootstrap config.");
    process.exitCode = 1;
    return;
  }

  const sourcesContent = await readFile(SOURCES_PATH, "utf8");
  const sources = parsePodcastSources(sourcesContent);
  console.log(`Found ${sources.length} active podcast sources\n`);

  await mkdir(OUT_DIR, { recursive: true });

  if (options.withTranscription && !whisperAvailable()) {
    console.log("⚠️  faster-whisper not available — running in metadata-only mode.");
    options.withTranscription = false;
  }

  const allEpisodes: Episode[] = [];

  for (const source of sources) {
    const episodes = await fetchPodcastEpisodes(source);
    allEpisodes.push(...episodes);
  }

  console.log(`\n📊 Total episodes: ${allEpisodes.length}`);

  if (allEpisodes.length === 0) {
    console.log("No episodes found. Exiting.");
    return;
  }

  // Transcription pipeline
  if (options.withTranscription) {
    console.log("\n🎙️  Starting transcription pipeline...");
    let transcribedCount = 0;

    for (let i = 0; i < allEpisodes.length; i++) {
      const episode = allEpisodes[i]!;
      console.log(`[${i + 1}/${allEpisodes.length}] ${episode.title.slice(0, 60)}`);

      const mp3Url = await extractMp3Url(episode);
      if (!mp3Url) {
        console.log("    ⚠️  No MP3 URL found — skipping transcription");
        continue;
      }
      episode.mp3Url = mp3Url;

      console.log(`    ⬇️  Downloading MP3...`);
      const mp3Path = await downloadMp3(mp3Url, OUT_DIR);
      if (!mp3Path) continue;

      // Trim to max minutes
      const trimmedPath = await trimMp3(mp3Path, TRANSCRIPTION_MAX_MINUTES);
      const isNewFile = trimmedPath !== mp3Path;

      const transcript = await transcribeWithWhisper(trimmedPath);
      if (transcript) {
        episode.transcript = transcript;
        console.log(`    ✓ Transcript: ${transcript.length} chars`);
        transcribedCount++;
      }

      // Cleanup temp files
      await unlink(mp3Path).catch(() => {});
      if (isNewFile) await unlink(trimmedPath).catch(() => {});
    }

    console.log(`\n✓ Transcribed ${transcribedCount}/${allEpisodes.length} episodes`);
  }

  // Write JSON
  const json = {
    collectedAt: new Date().toISOString(),
    withTranscription: options.withTranscription,
    episodes: allEpisodes,
  };
  await writeFile(path.join(OUT_DIR, "latest.json"), JSON.stringify(json, null, 2), "utf8");

  // Write markdown
  const md = allEpisodes
    .map(e => {
      const lines = [`- [${e.title}](${e.url}) — ${e.podcastName} (${e.pubDate})`];
      if (e.description) lines.push(`  ${e.description.slice(0, 200)}`);
      if (e.transcript) lines.push(`  📝 Transcript: ${e.transcript.slice(0, 300)}...`);
      return lines.join("\n");
    })
    .join("\n\n");

  await writeFile(
    path.join(OUT_DIR, "latest.md"),
    `# Podcast Episodes\n\nCollected: ${json.collectedAt}\n\n${md}\n`,
    "utf8"
  );

  console.log(`\n✅ Done! Fetched ${allEpisodes.length} episodes`);
  console.log(`   JSON: ${path.join(OUT_DIR, "latest.json")}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const withTranscription = args.includes("--transcribe");
  await fetchPodcasts({ withTranscription });
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
