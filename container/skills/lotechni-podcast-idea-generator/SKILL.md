---
name: lotechni-podcast-idea-generator
description: Generate and save a new episode idea for the "לא טכני ולא במקרה" podcast. Collects a raw idea, reads recent RSS episodes, enriches it, and saves a fully-populated page to the Episode Ideas Notion DB. Returns the page URL.
---

# Lotechni Podcast Idea Generator

Generate a new episode idea for "לא טכני ולא במקרה" and save it to Notion.

## Show Identity

- **Show:** לא טכני ולא במקרה — soft skills and career coaching for developers
- **Hosts:** Tal Moskowitz and Adir Kandel
- **Audience:** Hebrew-speaking Israeli developers, junior to senior
- **Core themes:** Career strategy, communication, feedback, personal branding, AI impact on dev roles, networking, soft skills
- **Tone:** Conversational, practical, honest, mentorship-flavored
- **~45 episodes recorded**

## Steps

### 1. Collect

Ask the user for the episode idea — a story, a guest name, a subject, a raw note, anything. Accept it as-is and proceed.

### 2. Learn from RSS

Fetch the RSS feed to understand recent episodes and avoid duplication:

```bash
curl -s "https://anchor.fm/s/f01f6814/podcast/rss"
```

Extract the last 5–10 episode titles and descriptions.

### 3. Enrich

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

### 4. Save to Notion

Use the **notion-lotechni** MCP to create a page in the Episode Ideas DB.

- **DB data source ID:** `collection://1be5b6be-c8d3-496f-9f86-8e27697b3b56`
- **DB URL:** `https://www.notion.so/c7bf289355824a22ae887bf0a3148dc7`

Create the page with all 8 properties filled + the ליינאפ מוצע as page body content.

### 5. Return

Reply with the Notion page URL.
