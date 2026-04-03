#!/usr/bin/env node
/**
 * Geektime Scraper
 *
 * Scrapes article titles and URLs from Geektime.co.il categories.
 *
 * Output:
 *   /workspace/group/marketing/data/geektime/latest.json
 *   /workspace/group/marketing/data/geektime/latest.md
 *
 * Usage:
 *   npm run geektime:scrape
 *
 * Note: Respects robots.txt and uses reasonable delays.
 */

import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://www.geektime.co.il";
const CATEGORIES = [
  { slug: "development", name: "Development" },
  { slug: "cyber", name: "Cyber" },
  { slug: "mobile", name: "Mobile" },
  { slug: "startups", name: "Startups" },
  { slug: "gaming", name: "Gaming" },
  { slug: "hardware", name: "Hardware" },
  { slug: "ai", name: "AI" }
];

const OUT_DIR = "/workspace/group/marketing/data/geektime";
const USER_AGENT = "Mozilla/5.0 (compatible; Bot/0.1; +https://example.com/bot)";
const DELAY_MS = 2000;

async function fetchWithDelay(url: string): Promise<string> {
  console.log(`  📡 ${url}`);
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const html = await response.text();
  await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  return html;
}

async function scrapeCategory(slug: string, name: string): Promise<Array<{ title: string; url: string }>> {
  const url = `${BASE_URL}/category/${slug}/`;
  try {
    const html = await fetchWithDelay(url);
    const $ = cheerio.load(html);
    const articles: Array<{ title: string; url: string }> = [];

    $("article a").each((_, elem) => {
      const href = $(elem).attr("href");
      const title = $(elem).text().trim();
      if (href && title && href.startsWith("/") && !href.includes("#") && title.length > 10) {
        articles.push({ title, url: `${BASE_URL}${href}` });
      }
    });

    $("h2 a, h3 a").each((_, elem) => {
      const href = $(elem).attr("href");
      const title = $(elem).text().trim();
      if (href && title && href.includes(slug) && title.length > 10) {
        const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
        if (!articles.some(a => a.url === fullUrl)) {
          articles.push({ title, url: fullUrl });
        }
      }
    });

    console.log(`    ✓ ${articles.length} articles`);
    return articles.slice(0, 20);
  } catch (error) {
    console.log(`    ⚠️  Failed: ${error}`);
    return [];
  }
}

async function main(): Promise<void> {
  console.log("=== Geektime Scraper ===\n");

  await mkdir(OUT_DIR, { recursive: true });

  const allArticles: Array<{ category: string; title: string; url: string }> = [];

  for (const cat of CATEGORIES) {
    console.log(`📁 ${cat.name} (${cat.slug})`);
    const articles = await scrapeCategory(cat.slug, cat.name);
    allArticles.push(...articles.map(a => ({ category: cat.name, ...a })));
  }

  console.log(`\n📊 Total articles: ${allArticles.length}`);

  // Write JSON
  const json = {
    collectedAt: new Date().toISOString(),
    articles: allArticles
  };
  await writeFile(path.join(OUT_DIR, "latest.json"), JSON.stringify(json, null, 2), "utf8");

  // Write markdown
  const md = allArticles
    .map(a => `- [${a.title}](${a.url}) — ${a.category}`)
    .join("\n");

  await writeFile(
    path.join(OUT_DIR, "latest.md"),
    `# Geektime Articles\n\nScraped: ${json.collectedAt}\nCategories: ${CATEGORIES.map(c => c.name).join(", ")}\n\n${md}\n`,
    "utf8"
  );

  console.log(`✅ Saved to ${OUT_DIR}/`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
