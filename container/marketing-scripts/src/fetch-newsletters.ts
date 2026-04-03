#!/usr/bin/env node
/**
 * Newsletter Fetcher
 *
 * Reads active newsletter sources from /workspace/group/marketing/config/sources.md
 * and fetches the latest RSS issue for each, outputting structured data.
 *
 * Output:
 *   /workspace/group/marketing/data/newsletters/latest.json
 *   /workspace/group/marketing/data/newsletters/latest.md
 *
 * Usage:
 *   npm run newsletters:fetch
 */

import { XMLParser } from "fast-xml-parser";
import TurndownService from "turndown";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SOURCES_PATH = "/workspace/group/marketing/config/sources.md";
const OUT_DIR = "/workspace/group/marketing/data/newsletters";

type Feed = {
  id: string;
  name: string;
  url: string;
};

type ExtractedItem = {
  title: string;
  url: string;
  description: string;
};

type FeedResult = {
  id: string;
  name: string;
  latestIssue: {
    title: string;
    link: string;
    pubDate: string;
  };
  items: ExtractedItem[];
};

// Parse active newsletter sources from sources.md
function parseNewsletterSources(md: string): Feed[] {
  const yamlBlockRe = /```yaml\n([\s\S]*?)```/g;
  const feeds: Feed[] = [];

  let block: RegExpExecArray | null;
  while ((block = yamlBlockRe.exec(md)) !== null) {
    const yaml = block[1]!;
    const lines = yaml.split("\n");
    let current: Partial<{ name: string; url: string; type: string; active: boolean }> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- name:")) {
        if (current.name && current.url && current.type === "newsletter" && current.active !== false) {
          const id = current.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          feeds.push({ id, name: current.name, url: current.url });
        }
        current = { name: trimmed.slice(7).trim().replace(/^["']|["']$/g, "") };
      } else if (trimmed.startsWith("type:")) {
        current.type = trimmed.slice(5).trim().replace(/^["']|["']$/g, "");
      } else if (trimmed.startsWith("url:")) {
        current.url = trimmed.slice(4).trim().replace(/^["']|["']$/g, "");
      } else if (trimmed.startsWith("active:")) {
        current.active = trimmed.slice(7).trim() !== "false";
      }
    }
    // Push last entry
    if (current.name && current.url && current.type === "newsletter" && current.active !== false) {
      const id = current.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      feeds.push({ id, name: current.name, url: current.url });
    }
  }

  return feeds;
}

function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function createTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "_"
  });

  td.addRule("dropTrackingImages", {
    filter: (node: unknown) => {
      if (!node || (node as any).nodeName !== "IMG") return false;
      const src = (node as any).getAttribute?.("src") || "";
      return (
        src.includes("/open/") ||
        src.endsWith("/rss") ||
        src.includes("open/") ||
        src.includes("pixel") ||
        src.includes("1x1")
      );
    },
    replacement: () => ""
  });

  return td;
}

function extractItemsFromHtml(html: string, td: TurndownService): ExtractedItem[] {
  const items: ExtractedItem[] = [];

  // Extract links with surrounding context
  const linkRe = /<a\s+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const url = m[1]!;
    const rawTitle = m[2]!.replace(/<[^>]+>/g, "").trim();
    if (rawTitle.length < 10) continue;
    // Skip tracking/unsub links
    if (
      url.includes("unsubscribe") ||
      url.includes("click.") ||
      url.includes("track.") ||
      url.includes("view-online")
    ) continue;
    items.push({ title: rawTitle, url, description: "" });
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function fetchFeed(feed: Feed, td: TurndownService): Promise<FeedResult | null> {
  console.log(`  📡 ${feed.name} — ${feed.url}`);
  try {
    const resp = await fetch(feed.url, {
      headers: { "User-Agent": "nanoclaw-marketing/1.0 (newsletter-fetcher)" }
    });
    if (!resp.ok) {
      console.log(`    ⚠️  HTTP ${resp.status}`);
      return null;
    }
    const xml = await resp.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseTagValue: false,
      parseAttributeValue: false
    });
    const data = parser.parse(xml);
    const channel = data?.rss?.channel || data?.feed;
    if (!channel) {
      console.log("    ⚠️  No channel found");
      return null;
    }

    const rawItems = ensureArray(channel.item || channel.entry);
    const latest = rawItems[0];
    if (!latest) {
      console.log("    ⚠️  No items");
      return null;
    }

    const latestTitle = String(latest.title || "");
    const latestLink = String(latest.link || latest["link/@href"] || "");
    const latestPubDate = String(latest.pubDate || latest.published || latest.updated || "");

    // Extract items from HTML description of latest issue
    const description = String(
      latest.description || latest["content:encoded"] || latest.content?.["#text"] || latest.summary?.["#text"] || ""
    );
    const items = extractItemsFromHtml(description, td);
    console.log(`    ✓ ${items.length} items`);

    return {
      id: feed.id,
      name: feed.name,
      latestIssue: { title: latestTitle, link: latestLink, pubDate: latestPubDate },
      items
    };
  } catch (err) {
    console.log(`    ⚠️  Error: ${err}`);
    return null;
  }
}

async function main(): Promise<void> {
  console.log("=== Newsletter Fetcher ===\n");

  if (!existsSync(SOURCES_PATH)) {
    console.error(`Sources file not found: ${SOURCES_PATH}`);
    console.error("Run /marketing-data-collector to bootstrap config.");
    process.exitCode = 1;
    return;
  }

  const sourcesContent = await readFile(SOURCES_PATH, "utf8");
  const feeds = parseNewsletterSources(sourcesContent);
  console.log(`Found ${feeds.length} active newsletter sources\n`);

  if (feeds.length === 0) {
    console.log("No active newsletter sources in sources.md. Exiting.");
    return;
  }

  const td = createTurndown();
  await mkdir(OUT_DIR, { recursive: true });

  const results: FeedResult[] = [];

  for (const feed of feeds) {
    const result = await fetchFeed(feed, td);
    if (result) results.push(result);
  }

  const totalItems = results.reduce((s, r) => s + r.items.length, 0);
  console.log(`\n📊 Total: ${results.length} feeds, ${totalItems} items`);

  // Write JSON
  const json = {
    collectedAt: new Date().toISOString(),
    feeds: results
  };
  await writeFile(path.join(OUT_DIR, "latest.json"), JSON.stringify(json, null, 2), "utf8");

  // Write markdown (one line per item across all feeds)
  const md = results
    .flatMap(r =>
      r.items.map(item => `- [${item.title}](${item.url})`)
    )
    .join("\n");

  await writeFile(
    path.join(OUT_DIR, "latest.md"),
    `# Newsletter Items\n\nCollected: ${json.collectedAt}\nSources: ${results.map(r => r.name).join(", ")}\n\n${md}\n`,
    "utf8"
  );

  console.log(`✅ Saved to ${OUT_DIR}/`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
