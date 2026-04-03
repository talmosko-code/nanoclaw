# YouTube Channels for Curated Scouting (Working RSS Feeds Only)

Strong channels with working RSS feeds. Updated 2026-03-18.

Format: one channel per block

```yaml
- name: "Fireship"
  channelId: "UCsBjURrPoezykLs9EqgamOA"
  language: en
  category: tech
  priority: 1
  notes: "Quick tech takes, trends, hot takes - great hooks for LinkedIn"

- name: "Theo (t3dotgg)"
  channelId: "UCtuO2h6OwDueF7h3p8DYYjQ"
  language: en
  category: tech
  priority: 1
  notes: "Contrarian opinions, framework debates, strong hooks"

- name: "Joshua Fluke"
  channelId: "UCWhwhAaDJV9EWeSGcWSiGfQ"
  language: en
  category: career
  priority: 1
  notes: "Real developer journey stories, job hunting, career struggles"

- name: "Matt Pocock"
  channelId: "UCswG6FSbgZjbWtdf_hMLaow"
  language: en
  category: tech
  priority: 1
  notes: "TypeScript expert, clear explanations, career advice for devs"

- name: "Jack Herrington"
  channelId: "UC6vRUjYqDuoUsYsku86Lrsw"
  language: en
  category: tech
  priority: 1
  notes: "Full-stack, frameworks, practical dev insights, contrarian takes"

- name: "HealthyGamerGG / Dr. K"
  channelId: "UCrGYoowsH-aKfSCM5TOzAsA"
  language: en
  category: personal-growth
  priority: 1
  notes: "Burnout, imposter syndrome, ADHD, mental health in tech - gold for soft skills pillar"

- name: "Matt D'Avella"
  channelId: "UCJ24N4O0bP7LGLBDvye7oCA"
  language: en
  category: personal-growth
  priority: 2
  notes: "Habits, productivity, minimalism - high quality production"

- name: "Thomas Frank"
  channelId: "UCd_WBvzBg1UbHE8j8MIL5Ng"
  language: en
  category: personal-growth
  priority: 2
  notes: "Productivity systems, student/dev life, Notion workflows"

- name: "ThePrimeagen"
  channelId: "UCUyeluBRhGPCW4rPe_UvBZQ"
  language: en
  category: tech
  priority: 2
  notes: "High energy, contrarian takes, performance deep dives"

- name: "Ali Abdaal"
  channelId: "UChfo46ZNOV-vtehDc25A1Ug"
  language: en
  category: personal-growth
  priority: 2
  notes: "Productivity, creator economy, personal growth angles"

- name: "ByteByteGo"
  channelId: "UCZgt6AzoyjslHTC9dz0UoTw"
  language: en
  category: system-design
  priority: 2
  notes: "System design interviews, architecture deep dives"

- name: "Greg Isenberg"
  channelId: "UCPjNBjflYl0-HQtUvOx0Ibw"
  language: en
  category: business
  priority: 2
  notes: "Startup ideas, marketing, business strategy, community building"

- name: "TechLead"
  channelId: "UC4xKdmAXFh4ACyhpiQ_3qBw"
  language: en
  category: career
  priority: 3
  notes: "Controversial takes, career drama - use for inspiration, filter carefully"
```

## Hebrew Channels (Israeli)

```yaml
- name: "לא טכני ולא במקרה"
  channelId: "UCLpmLrI1eI0u5RaTL07cQrA"
  language: he
  category: podcast
  priority: 1
  notes: "הפודקאסט של טל עם אדיר קנדל; קריירה, טכנולוגיה, קהילה"

- name: "מפתחים מחוץ לקופסה"
  channelId: "UCFHagTiMptZc8r64v1k7EsQ"
  language: he
  category: community
  priority: 1
  notes: "שחר פולק ודותן טליתמן; קהילת מפתחים ישראלית"
```

---

## How to use

Run with `--curated` flag to only process videos from these channels:
```bash
npm run youtube:fetch -- --curated
```

Or run without to search across all YouTube based on trends.

## Note on Channel IDs

YouTube RSS feeds require the **channel ID** (e.g., `UCUyeluBRhGPCW4rPe_UvBZQ`),
not the custom handle (e.g., `@theprimeagen`).

To find a channel ID:
1. Go to the channel page
2. View page source
3. Search for `"channelId":"`
4. Copy the ID (starts with UC)

Channels with only custom handles (no legacy channel ID) won't work with RSS.
