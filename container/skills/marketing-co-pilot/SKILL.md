---
name: marketing-co-pilot
description: Entry point for all LinkedIn content workflows. Delegates to individual skills. Use for LinkedIn content ideas, topic scouting, post drafting, editing, or analytics.
---

# Marketing Co-Pilot

Entry point for the LinkedIn content pipeline.

## Skills

| Skill | When to use | Precondition |
|-------|-------------|--------------|
| `/marketing-data-collector` | Fetch fresh content from all sources (newsletters, podcasts, YouTube, Geektime). Run weekly or before topic scouting. | Optional; first run bootstraps config under `/workspace/group/marketing/`. |
| `/linkedin-topic-scout` | Generate ~20 weekly topic ideas from the cache, write to Notion Topics Backlog. | Cache recommended fresh: run `/marketing-data-collector` within ~7 days (see skill). After write, skill runs **Verify** (read-back in Notion). |
| `/linkedin-post-producer` | Take one topic from backlog → Hebrew draft in Notion Posts. | Row in Topics Backlog with `Status = New` and fields populated (see topic-scout handoff). |
| `/linkedin-editor-he` | Polish Hebrew draft for publish. | Draft exists in Posts. |
| `/linkedin-analytics-collector` | T+3: scrape LinkedIn metrics, write to Metrics Snapshots. | Post published; URLs/time window per skill. |

## Typical weekly flow

1. **`/marketing-data-collector`** — refreshes cache
   - ~5 min (metadata only)
   - ~30–60 min (with faster-whisper transcription, depending on active podcast sources)

2. **`/linkedin-topic-scout`** — reads cache, generates up to 20 topics, writes to Notion, then **verifies** each new Topics Backlog row (read-back via Notion MCP). Check the skill’s summary for confirm/fail.

3. Review and shortlist 5 topics in Notion for the week.

4. Daily: **`/linkedin-post-producer`** → **`/linkedin-editor-he`** → publish manually

5. T+3: **`/linkedin-analytics-collector`** for each published post

## Notion

Use the **notion** MCP for all Notion operations.
Databases: Posts, Topics Backlog, Metrics Snapshots.

## Config files (per group, editable)

```
/workspace/group/marketing/config/
  sources.md               ← Enable/disable sources (newsletters, podcasts, youtube, blogs)
  youtube-channels.md      ← Add/remove curated YouTube channels
  brand/
    objectives-positioning.md  ← ICP, voice, content boundaries
    pillars-claims.md          ← 10 content pillars with angles and hooks
    voice-hebrew-style.md      ← Hebrew tone and style guide
```

Bootstrap with `/marketing-data-collector` (copies defaults on first run).
