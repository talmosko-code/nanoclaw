---
name: marketing-data-collector
description: Fetch fresh content from all configured sources (newsletters, Geektime, podcasts, YouTube) and cache to /workspace/group/marketing/data/. Deterministic — no MCP needed. Run before linkedin-topic-scout to refresh data. Transcription uses local faster-whisper (free, no API cost).
---

# Marketing Data Collector

Fetches content from all active sources and writes structured cache files.
No Notion dependency. Run weekly before using `/linkedin-topic-scout`.

All scripts live at `/app/marketing-scripts/` (baked into the container).
All output goes to `/workspace/group/marketing/data/` (writable, per-group).

---

## Step 1 — Bootstrap config on first run

Check if the config directory exists:

```bash
test -d /workspace/group/marketing/config && echo EXISTS || echo MISSING
```

If **MISSING**, create it and copy the bundled defaults:

```bash
mkdir -p /workspace/group/marketing/config/brand
cp /app/marketing-scripts/defaults/sources.md /workspace/group/marketing/config/sources.md
cp /app/marketing-scripts/defaults/youtube-channels.md /workspace/group/marketing/config/youtube-channels.md
cp /app/marketing-scripts/defaults/brand/objectives-positioning.md /workspace/group/marketing/config/brand/
cp /app/marketing-scripts/defaults/brand/pillars-claims.md /workspace/group/marketing/config/brand/
cp /app/marketing-scripts/defaults/brand/voice-hebrew-style.md /workspace/group/marketing/config/brand/
```

Notify the user: "Config created at `/workspace/group/marketing/config/` with default sources and brand docs."

---

## Step 2 — Launch 4 fetch sub-agents in parallel

Start all four sub-agents simultaneously using the **Task tool** — do NOT wait for one to finish before starting the next.

**Sub-agent 1: Newsletters**
```bash
cd /app/marketing-scripts && npm run newsletters:fetch
```
Reads: `config/sources.md` (type: newsletter, active: true)
Writes: `data/newsletters/latest.json` + `data/newsletters/latest.md`

**Sub-agent 2: Geektime blog**
```bash
cd /app/marketing-scripts && npm run geektime:scrape
```
Writes: `data/geektime/latest.json` + `data/geektime/latest.md`

**Sub-agent 3: Podcasts**

First check if faster-whisper is available:
```bash
python3 -c "import faster_whisper" 2>/dev/null && echo WHISPER_OK || echo WHISPER_MISSING
```

- If WHISPER_OK: `cd /app/marketing-scripts && npm run podcasts:fetch-transcribe`
- If WHISPER_MISSING: `cd /app/marketing-scripts && npm run podcasts:fetch`

Reads: `config/sources.md` (type: podcast, active: true)
Writes: `data/podcasts/latest.json` + `data/podcasts/latest.md`

Note: Transcription is local (faster-whisper). Model downloads on first run to
`/workspace/group/marketing/whisper-cache/` (persists between runs).
Control model size via `WHISPER_MODEL` env var (default: small).

**Sub-agent 4: YouTube**
```bash
cd /app/marketing-scripts && npm run youtube:fetch
```
Reads: `config/youtube-channels.md`
Writes: `data/youtube/latest.json` + `data/youtube/latest.md`

---

## Step 3 — Wait for all sub-agents, check results

Wait for all four tasks to complete (timeout: 60 minutes for transcription run; 10 minutes otherwise).

Verify each output:
```bash
cat /workspace/group/marketing/data/newsletters/latest.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'newsletters: {sum(len(f[\"items\"]) for f in d[\"feeds\"])} items')" 2>/dev/null
cat /workspace/group/marketing/data/geektime/latest.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'geektime: {len(d[\"articles\"])} articles')" 2>/dev/null
cat /workspace/group/marketing/data/podcasts/latest.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'podcasts: {len(d[\"episodes\"])} episodes')" 2>/dev/null
cat /workspace/group/marketing/data/youtube/latest.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'youtube: {len(d[\"videos\"])} videos')" 2>/dev/null
```

---

## Step 4 — Write collection timestamp

```bash
date -u +%Y-%m-%dT%H:%M:%SZ > /workspace/group/marketing/data/.last-collected
```

---

## Step 5 — Return summary

Report:
- Counts per source
- Any failures (which fetcher failed and why)
- Whether transcription was enabled
- Reminder: "Run `/linkedin-topic-scout` to generate topic ideas."

---

## Cache folder structure

```
/workspace/group/marketing/
  config/
    sources.md               ← active sources (edit to add/disable)
    youtube-channels.md      ← curated YouTube channels
    brand/
      objectives-positioning.md
      pillars-claims.md
      voice-hebrew-style.md
  data/
    newsletters/latest.json  ← {collectedAt, feeds:[{id,name,items:[{title,url}]}]}
    newsletters/latest.md
    geektime/latest.json     ← {collectedAt, articles:[{category,title,url}]}
    geektime/latest.md
    podcasts/latest.json     ← {collectedAt, episodes:[{podcastName,title,url,pubDate,transcript?}]}
    podcasts/latest.md
    youtube/latest.json      ← {collectedAt, videos:[{id,title,url,channel,publishedAt,transcriptPreview}]}
    youtube/latest.md
    .last-collected          ← ISO timestamp of last successful collection
    whisper-cache/           ← faster-whisper model cache (auto-created)
```
