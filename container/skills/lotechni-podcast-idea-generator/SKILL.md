---
name: lotechni-podcast-idea-generator
description: Generate and save a new episode idea for the "לא טכני ולא במקרה" podcast. Collects a raw idea, reads recent RSS episodes, enriches it, and saves a fully-populated page to the Episode Ideas Notion DB. Returns the page URL.
---

# Lotechni Podcast Idea Generator

Generate a new episode idea for "לא טכני ולא במקרה" and save it to Notion.

## Workflow overview (phases)

| Phase | Section | Purpose |
|-------|---------|---------|
| **Collect** | 1 | Raw idea from user |
| **Enrich** | 2–3 | RSS context + structured episode fields |
| **Write** | 4 | Create page in Episode Ideas DB |
| **Verify** | 5 | Read-back: page exists, DB correct, properties + body |
| **Return** | 6 | Reply with URL |

Do **not** skip **Verify** after Notion create.

## Show Identity

- **Show:** לא טכני ולא במקרה — soft skills and career coaching for developers
- **Hosts:** Tal Moskowitz and Adir Kandel
- **Audience:** Hebrew-speaking Israeli developers, junior to senior
- **Core themes:** Career strategy, communication, feedback, personal branding, AI impact on dev roles, networking, soft skills
- **Tone:** Conversational, practical, honest, mentorship-flavored
- **~45 episodes recorded**

## Phase: Collect — 1. Collect

Ask the user for the episode idea — a story, a guest name, a subject, a raw note, anything. Accept it as-is and proceed.

## Phase: Enrich — 2. Learn from RSS

Fetch the RSS feed to understand recent episodes and avoid duplication:

```bash
curl -s "https://anchor.fm/s/f01f6814/podcast/rss"
```

**RSS failure policy:**

- If `curl` fails (non-zero exit, no output, or obvious network error) → **STOP**; tell the user the feed could not be fetched and ask them to retry or paste recent episode titles manually.
- If the response is **empty** or **not valid XML/RSS** → **STOP**; same message.
- If the feed parses but has **no items** → **continue** with a **warning** that de-dup against recent episodes could not be verified; proceed with enrichment using show identity only.

Otherwise extract the last 5–10 episode titles and descriptions.

## Phase: Enrich — 3. Enrich

Using the raw input + RSS learnings + show identity above, generate:

- **Name** — a crisp Hebrew episode title (max ~60 chars)
- **Status** — דראפט
- **Guest Name**, **LinkedIn Guest**, **Guest Title**, **Referrer** — fill from user input if provided; leave blank otherwise
- **עם מה היינו רוצים שהמאזינים יצאו** — 2–3 Hebrew sentences on the concrete listener takeaway
- **רקע רלוונטי לפרק** — preserve ALL raw user input here, verbatim and in full: every link, note, mention, story, name, context detail, and fragment. Nothing omitted. Then add: why this topic fits the show now.
- **ליינאפ מוצע** (page body) — a 5-point suggested episode flow tailored to this specific topic:
  ```
  ## ליינאפ מוצע
  1. פתיחה
  2. נקודה 1
  3. נקודה 2
  4. נקודה 3
  5. סגירה וקריאה לפעולה
  ```

## Phase: Write — 4. Save to Notion

Use the **notion-lotechni** MCP to create a page in the Episode Ideas DB.

- **DB data source ID:** `collection://1be5b6be-c8d3-496f-9f86-8e27697b3b56`
- **DB URL:** `https://www.notion.so/c7bf289355824a22ae887bf0a3148dc7?v=7ba5ae8363b34956adbe499f01891b9c`

⚠️ **חשוב:** שמור **אך ורק** ב-DB הזה (Episode Ideas). אל תשמור ב-Episodes – זה ארכיב בלבד.

Create the page with all 8 properties filled + the ליינאפ מוצע as page body content.

Save the **page ID or URL** returned by the create operation for Verify.

If create returns an error → **STOP**; report the error and do not claim success.

## Phase: Verify — 5. Confirm write (mandatory)

Via **notion-lotechni** MCP:

1. **Retrieve** the page by ID or URL from step 4.
2. Confirm the page lives in **Episode Ideas** (not Episodes archive).
3. Confirm all **8 properties** are present and non-empty where required, and the **ליינאפ מוצע** body exists in page content.

If retrieve fails or any check fails → **STOP**; report what is missing. Do not return a URL as “success” until Verify passes.

## Phase: Return — 6. Return

Reply with the Notion page URL (only after Verify passed).
