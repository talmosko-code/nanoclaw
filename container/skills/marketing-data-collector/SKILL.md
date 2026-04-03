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

## Step 1 — Bootstrap config on first run, always refresh sources.json

Check if the config directory exists:

```bash
test -d /workspace/group/marketing/config && echo EXISTS || echo MISSING
```

If **MISSING**, create it and copy the bundled defaults:

```bash
mkdir -p /workspace/group/marketing/config/brand
cp /app/marketing-scripts/defaults/sources.json /workspace/group/marketing/config/sources.json
cp /app/marketing-scripts/defaults/youtube-channels.md /workspace/group/marketing/config/youtube-channels.md
cp /app/marketing-scripts/defaults/brand/objectives-positioning.md /workspace/group/marketing/config/brand/
cp /app/marketing-scripts/defaults/brand/pillars-claims.md /workspace/group/marketing/config/brand/
cp /app/marketing-scripts/defaults/brand/voice-hebrew-style.md /workspace/group/marketing/config/brand/
```

If **EXISTS**, always refresh `sources.json` from the bundled defaults to pick up any upstream fixes:

```bash
cp /app/marketing-scripts/defaults/sources.json /workspace/group/marketing/config/sources.json
```

Notify the user: "Config created at `/workspace/group/marketing/config/` with default sources and brand docs." (first run) or "sources.json refreshed from bundled defaults." (subsequent runs).

---

## Step 2 — Truncate progress file and launch 4 sub-agents in parallel

Before launching, truncate the progress tracker:

```bash
mkdir -p /workspace/group/marketing/data
> /workspace/group/marketing/data/.collection-progress
```

Start all four sub-agents simultaneously using the **Task tool** — do NOT wait for one to finish before starting the next.

**Sub-agent 1: Newsletters**

```bash
cd /app/marketing-scripts && npm run newsletters:fetch
```

Reads: `config/sources.json` (type: newsletter, active: true)
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

- Always: `cd /app/marketing-scripts && npm run podcasts:fetch` (metadata only, ~30 seconds)
- Optional transcription (separate step, **timeout: 200 minutes**): `cd /app/marketing-scripts && npm run podcasts:fetch-transcribe`

Reads: `config/sources.json` (type: podcast, active: true)
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

## Step 3 — Progressive checkpointing (check each sub-agent as it completes)

As each sub-agent task completes, immediately:

1. **Verify the output file** exists and is valid:

   ```bash
   # For newsletters:
   python3 -c "import json; d=json.load(open('/workspace/group/marketing/data/newsletters/latest.json')); print(f'newsletters: {sum(len(f[\"items\"]) for f in d[\"feeds\"])} items')" 2>/dev/null && echo OK || echo FAIL

   # For geektime:
   python3 -c "import json; d=json.load(open('/workspace/group/marketing/data/geektime/latest.json')); print(f'geektime: {len(d[\"articles\"])} articles')" 2>/dev/null && echo OK || echo FAIL

   # For podcasts:
   python3 -c "import json; d=json.load(open('/workspace/group/marketing/data/podcasts/latest.json')); print(f'podcasts: {len(d[\"episodes\"])} episodes')" 2>/dev/null && echo OK || echo FAIL

   # For youtube:
   python3 -c "import json; d=json.load(open('/workspace/group/marketing/data/youtube/latest.json')); print(f'youtube: {len(d[\"videos\"])} videos')" 2>/dev/null && echo OK || echo FAIL
   ```

2. **Append result to the progress file:**

   ```bash
   echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] <source>: <count> items <✓|✗ reason>" >> /workspace/group/marketing/data/.collection-progress
   ```

3. **Report partial success** — don't wait for the other agents.

This ensures that if the container times out or crashes mid-run, the data already collected is safely written and the progress file records what succeeded.

---

## Step 4 — Wait for remaining agents

Wait for all four tasks to complete (timeout: **120 minutes** for podcast transcription run; 10 minutes otherwise).

---

## Step 5 — Final verification

Read the progress file:

```bash
cat /workspace/group/marketing/data/.collection-progress
```

Then verify each JSON output that reported success:

```bash
cat /workspace/group/marketing/data/newsletters/latest.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'newsletters: {sum(len(f[\"items\"]) for f in d[\"feeds\"])} items')" 2>/dev/null
cat /workspace/group/marketing/data/geektime/latest.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'geektime: {len(d[\"articles\"])} articles')" 2>/dev/null
cat /workspace/group/marketing/data/podcasts/latest.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'podcasts: {len(d[\"episodes\"])} episodes')" 2>/dev/null
cat /workspace/group/marketing/data/youtube/latest.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'youtube: {len(d[\"videos\"])} videos')" 2>/dev/null
```

---

## Step 6 — Write collection timestamp

Write `.last-collected` only if at least one source succeeded:

```bash
date -u +%Y-%m-%dT%H:%M:%SZ > /workspace/group/marketing/data/.last-collected
```

If ALL sources failed, skip this step and tell the user the cache was not updated.

---

## Step 7 — Return summary

Report:

- Counts per source (from `.collection-progress`)
- Any failures (which fetcher failed and why)
- Whether transcription was enabled
- Reminder: "Run `/linkedin-topic-scout` to generate topic ideas."

---

## Cache folder structure

```
/workspace/group/marketing/
  config/
    sources.json             ← active sources (edit to add/disable)
    youtube-channels.md      ← curated YouTube channels
    brand/
      objectives-positioning.md
      pillars-claims.md
      voice-hebrew-style.md
  data/
    .collection-progress     ← append-only: per-source results from last run
    .last-collected          ← ISO timestamp of last successful collection
    newsletters/latest.json  ← {collectedAt, feeds:[{id,name,items:[{title,url}]}]}
    newsletters/latest.md
    geektime/latest.json     ← {collectedAt, articles:[{category,title,url}]}
    geektime/latest.md
    podcasts/latest.json     ← {collectedAt, episodes:[{podcastName,title,url,pubDate,transcript?}]}
    podcasts/latest.md
    youtube/latest.json      ← {collectedAt, videos:[{id,title,url,channel,publishedAt,transcriptPreview}]}
    youtube/latest.md
    whisper-cache/           ← faster-whisper model cache (auto-created, never auto-cleaned)
```

## Temp/Cache Cleanup

| File                        | When cleaned                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `.collection-progress`      | Truncated at start of each run (`> file`), kept after success as lightweight index for downstream skills |
| `tmp_*.mp3`                 | Cleaned inline by podcast script after transcription — no action needed                                  |
| `whisper-cache/`            | **Never** auto-cleaned — models are expensive to re-download                                             |
| `latest.json` / `latest.md` | Overwritten atomically by each run — no cleanup needed                                                   |
