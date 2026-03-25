---
name: marketing-co-pilot
description: Entry point for all LinkedIn content workflows. Delegates to individual skills. Use for LinkedIn content ideas, topic scouting, post drafting, editing, or analytics.
---

# Marketing Co-Pilot

Entry point for the LinkedIn content pipeline. All logic lives in the repo at `/workspace/extra/marketing-co-pilot/`.

## Start here

Read `/workspace/extra/marketing-co-pilot/AGENTS.md` — it defines the full cadence, subagents, Notion DBs, and flow.

## Subagents

Use the dedicated skills for each task:
- `/linkedin-topic-scout` — weekly topic generation (~20 ideas)
- `/linkedin-post-producer` — topic → Hebrew draft
- `/linkedin-editor-he` — polish draft for publish
- `/linkedin-analytics-collector` — T+3 metrics

## Notion

Use the **notion** MCP for all Notion operations (Posts, Topics Backlog, Metrics Snapshots databases).
