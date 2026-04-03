# Dynamic sources for Topic Scout

Topic Scout reads this file to know where to look for ideas. Only sources marked **active: true** are used. Add or remove rows; change `active` to `false` to disable without deleting.

Format: one source per block. Copy the block to add more (e.g. Israeli communities when you have them).

---

## Source block template

```yaml
- name: "Human-readable name"
  type: "reddit" | "hn" | "blog" | "newsletter" | "community" | "youtube" | "podcast"
  url: "https://..."
  language: "en" | "he"
  active: true
  priority: 2   # 1=highest, 5=lowest
  notes: "Optional; e.g. which subreddit or which section to scan"
```

---

## Active sources (defaults)

```yaml
# Global dev
- name: "React Status (RSS)"
  type: newsletter
  url: "https://react.statuscode.com/rss/"
  language: en
  active: true
  priority: 2
  notes: "Take only the first RSS item (latest issue); parse HTML description → Markdown"

- name: "Node Weekly (RSS)"
  type: newsletter
  url: "https://cprss.s3.amazonaws.com/nodeweekly.com.xml"
  language: en
  active: true
  priority: 2
  notes: "Take only the first RSS item (latest issue); parse HTML description → Markdown"

- name: "Frontend Focus (RSS)"
  type: newsletter
  url: "https://cprss.s3.amazonaws.com/frontendfoc.us.xml"
  language: en
  active: true
  priority: 2
  notes: "Take only the first RSS item (latest issue); parse HTML description → Markdown"

- name: "JavaScript Weekly (RSS)"
  type: newsletter
  url: "https://cprss.s3.amazonaws.com/javascriptweekly.com.xml"
  language: en
  active: true
  priority: 2
  notes: "Take only the first RSS item (latest issue); parse HTML description → Markdown"

- name: "r/reactjs"
  type: reddit
  url: "https://www.reddit.com/r/reactjs/"
  language: en
  active: true
  priority: 2
  notes: "Hot and top; look for pain points, debates, releases"

- name: "r/webdev"
  type: reddit
  url: "https://www.reddit.com/r/webdev/"
  language: en
  active: true
  priority: 2
  notes: "Broader frontend; velocity and tooling discussions"

- name: "Hacker News"
  type: hn
  url: "https://news.ycombinator.com/"
  language: en
  active: true
  priority: 2
  notes: "Front page + Ask HN; eng culture, scaling, AI in dev"

# English newsletters & blogs
- name: "Adventures in Nodeland"
  type: newsletter
  url: "https://adventures.nodeland.dev/rss.xml"
  language: en
  active: true
  priority: 2
  notes: "Matteo Collina's newsletter about Node.js, Fastify, Pino, Platformatic"

# Israeli / Hebrew — Geektime
- name: "Geektime – AI/ML (בינה מלאכותית)"
  type: blog
  url: "https://www.geektime.co.il/category/%d7%91%d7%99%d7%a0%d7%94-%d7%9e%d7%9c%d7%90%d7%9b%d7%95%d7%aa%d7%99%d7%aa/"
  language: he
  active: true
  priority: 2
  notes: "Scrape: npm run geektime:scrape → out/sources/geektime-articles.md (one MD file)"

- name: "Geektime – Development (תכנות)"
  type: blog
  url: "https://www.geektime.co.il/category/development/"
  language: he
  active: true
  priority: 2
  notes: "Scrape: npm run geektime:scrape → out/sources/geektime-articles.md"

- name: "Geektime – Life in Hi-Tech (החיים בהייטק)"
  type: blog
  url: "https://www.geektime.co.il/category/%d7%94%d7%97%d7%99%d7%99%d7%9d-%d7%91%d7%94%d7%99%d7%99%d7%98%d7%a7/"
  language: he
  active: true
  priority: 1
  notes: "Scrape: npm run geektime:scrape → out/sources/geektime-articles.md"

- name: "Geektime – Funding (מימון)"
  type: blog
  url: "https://www.geektime.co.il/category/funding/"
  language: he
  active: true
  priority: 1
  notes: "Scrape: npm run geektime:scrape → out/sources/geektime-articles.md"

# Podcasts — English (Frontend / Web Dev)
- name: "Syntax"
  type: podcast
  url: "https://feeds.megaphone.fm/FSI1483080183"
  language: en
  active: true
  priority: 2
  notes: "Wes Bos & Scott Tolinski; broad frontend, tooling, career"

- name: "PodRocket"
  type: podcast
  url: "https://feeds.fireside.fm/podrocket/rss"
  language: en
  active: true
  priority: 2
  notes: "LogRocket; short-form frontend interviews and news"

- name: "Front-End Fire"
  type: podcast
  url: "https://rss.buzzsprout.com/2226499.rss"
  language: en
  active: false
  priority: 2
  notes: "TJ VanToll, Paige Niedringhaus, Jack Herrington; frontend news"

- name: "The Frontend Masters Podcast"
  type: podcast
  url: "https://anchor.fm/s/ea8edf9c/podcast/rss"
  language: en
  active: false
  priority: 2
  notes: "Frontend Masters; deep dives on web dev topics"

- name: "JavaScript Jabber"
  type: podcast
  url: "https://www.spreaker.com/show/6102064/episodes/feed"
  language: en
  active: false
  priority: 2
  notes: "Long-running JS podcast; frameworks, architecture, career"

- name: "Web Rush"
  type: podcast
  url: "https://feeds.simplecast.com/tOjNXec5"
  language: en
  active: false
  priority: 2
  notes: "Dan Wahlin, John Papa, Ward Bell, Craig Shoemaker; web dev"

- name: "devtools.fm"
  type: podcast
  url: "https://anchor.fm/s/dd6922b4/podcast/rss"
  language: en
  active: true
  priority: 2
  notes: "Developer tools, open source, DX"

- name: "FedBites"
  type: podcast
  url: "https://anchor.fm/s/7ad265e8/podcast/rss"
  language: en
  active: false
  priority: 2
  notes: "Yoav Ganbar and Lio Fleishman; frontend ecosystem bites"

# Podcasts — English (Tech business / Soft skills / Leadership)
- name: "Design Better"
  type: podcast
  url: "https://designbetter.libsyn.com/rss"
  language: en
  active: true
  priority: 1
  notes: "The Curiosity Department, sponsored by Wix Studio; design & product"

- name: "Soft Skills Engineering"
  type: podcast
  url: "https://softskills.audio/feed.xml"
  language: en
  active: true
  priority: 1
  notes: "Jamison Dance & Dave Smith; career, teamwork, eng culture"

- name: "Nir And Far"
  type: podcast
  url: "https://anchor.fm/s/bcc500/podcast/rss"
  language: en
  active: true
  priority: 3
  notes: "Nir Eyal; behavioral design, habits, product psychology"

- name: "Akimbo (Seth Godin)"
  type: podcast
  url: "https://feeds.acast.com/public/shows/07058b20-e537-4225-9c56-3adf0e2a669a"
  language: en
  active: true
  priority: 3
  notes: "Controversial takes, career drama - use for inspiration, filter carefully"
  notes: "Seth Godin; marketing, leadership, shipping creative work"

- name: "Hardcore Soft Skills Podcast"
  type: podcast
  url: "https://rss.libsyn.com/shows/294176/destinations/2311193.xml"
  language: en
  active: true
  priority: 3
  notes: "Controversial takes, career drama - use for inspiration, filter carefully"
  notes: "Yadira Caro; communication, leadership, career growth"

- name: "Indie Hackers"
  type: podcast
  url: "https://feeds.transistor.fm/the-indie-hackers-podcast"
  language: en
  active: true
  priority: 3
  notes: "Controversial takes, career drama - use for inspiration, filter carefully"
  notes: "Courtland & Channing Allen; bootstrapping, solopreneurs, product"

- name: "Land of the Giants"
  type: podcast
  url: "https://feeds.megaphone.fm/landofthegiants"
  language: en
  active: true
  priority: 3
  notes: "Controversial takes, career drama - use for inspiration, filter carefully"
  notes: "Vox; big tech industry deep dives"

# Podcasts — Hebrew (Dev / Tech)
- name: "הוטפיקס (Hotfix)"
  type: podcast
  url: "https://anchor.fm/s/10fa5ddf8/podcast/rss"
  language: he
  active: true
  priority: 1
  notes: "שחר פולק, Head of Engineering ב-Imagen AI; הרגעים שבין הבילד לקריסה, קריירה, hiring, PM-Engineering dynamics"

- name: "מפתחים מחוץ לקופסה"
  type: podcast
  url: "https://rss.buzzsprout.com/1887121.rss"
  language: he
  active: true
  priority: 2
  notes: "שחר פולק ודותן טליתמן; Israeli dev community, open source"

- name: "עושים טכנולוגיה עם ד״ר יובל דרור"
  type: podcast
  url: "https://www.ranlevi.com/feed/osim_tech/"
  language: he
  active: true
  priority: 1
  notes: "רשת עושים היסטוריה; tech history and trends"

- name: "לא טכני ולא במקרה"
  type: podcast
  url: "https://anchor.fm/s/f01f6814/podcast/rss"
  language: he
  active: true
  priority: 1
  notes: "טל מוסקוביץ' ואדיר קנדל; פודקאסט על קריירה ופיתוח עצמי למפתחים"

# Podcasts — Hebrew (Business / Inspiration / Other)
- name: "אנשי הקשב"
  type: podcast
  url: "https://anchor.fm/s/5776ccec/podcast/rss"
  language: he
  active: true
  priority: 1
  notes: "ד״ר שירלי הרשקו; communication, listening, leadership"

- name: "נקודה למחשבה"
  type: podcast
  url: "https://feed.podbean.com/adishmitanka/feed.xml"
  language: he
  active: true
  priority: 1
  notes: "עדי שמיטנקה; thought-provoking conversations"

- name: "פופקורן (ליאור פרנקל)"
  type: podcast
  url: "https://anchor.fm/s/10152b9b0/podcast/rss"
  language: he
  active: true
  priority: 1
  notes: "ליאור פרנקל; marketing, branding, digital"

- name: "חצי שעה של השראה עם ערן גפן"
  type: podcast
  url: "http://feeds.soundcloud.com/users/soundcloud:users:313037130/sounds.rss"
  language: he
  active: true
  priority: 3
  notes: "Controversial takes, career drama - use for inspiration, filter carefully; ערן גפן; entrepreneurship, inspiration"

- name: "בזמן שעבדתם"
  type: podcast
  url: "https://www.omnycontent.com/d/playlist/2ee97a4e-8795-4260-9648-accf00a38c6a/a5d4b51f-5b9e-43db-84da-ace100c04108/0ab18f83-1327-4f4e-9d7a-ace100c0411f/podcast.rss"
  language: he
  active: true
  priority: 3
  notes: "Controversial takes, career drama - use for inspiration, filter carefully; mako; general culture and news"

- name: "Greg Isenberg (YouTube)"
  type: youtube
  url: "https://www.youtube.com/@gregisenberg"
  language: en
  active: true
  priority: 2
  notes: "Startup ideas, marketing, business strategy, community building"

- name: "Fireship (YouTube)"
  type: youtube
  url: "https://www.youtube.com/@Fireship"
  language: en
  active: true
  priority: 1
  notes: "Quick tech takes, trends, hot takes - great hooks for LinkedIn"

- name: "Theo (YouTube)"
  type: youtube
  url: "https://www.youtube.com/@t3dotgg"
  language: en
  active: true
  priority: 1
  notes: "Contrarian opinions, framework debates, strong hooks"

- name: "Joshua Fluke (YouTube)"
  type: youtube
  url: "https://www.youtube.com/@JoshuaFluke"
  language: en
  active: true
  priority: 1
  notes: "Real developer journey stories, job hunting, career struggles"

- name: "ThePrimeagen (YouTube)"
  type: youtube
  url: "https://www.youtube.com/@ThePrimeagen"
  language: en
  active: true
  priority: 2
  notes: "High energy, contrarian takes, performance deep dives"

- name: "TechLead (YouTube)"
  type: youtube
  url: "https://www.youtube.com/@TechLead"
  language: en
  active: true
  priority: 3
  notes: "Controversial takes, career drama - use for inspiration, filter carefully"

- name: "Matt Pocock (YouTube)"
  type: youtube
  url: "https://www.youtube.com/@mattpocockuk"
  language: en
  active: true
  priority: 1
  notes: "TypeScript expert, clear explanations, career advice for devs"

- name: "Ali Abdaal (YouTube)"
  type: youtube
  url: "https://www.youtube.com/@aliabdaal"
  language: en
  active: true
  priority: 2
  notes: "Productivity, creator economy, personal growth angles"

- name: "Jack Herrington (YouTube)"
  type: youtube
  url: "https://www.youtube.com/@jherr"
  language: en
  active: true
  priority: 1
  notes: "Full-stack, frameworks, practical dev insights"

- name: "Matt D'Avella (YouTube)"
  type: youtube
  url: "https://www.youtube.com/@MattDAvella"
  language: en
  active: true
  priority: 2
  notes: "Habits, productivity, minimalism - high quality production, dev-adjacent topics"

- name: "Thomas Frank (YouTube)"
  type: youtube
  url: "https://www.youtube.com/@ThomasFrank"
  language: en
  active: true
  priority: 2
  notes: "Productivity systems, student/dev life, Notion workflows"

- name: "HealthyGamerGG / Dr. K (YouTube)"
  type: youtube
  url: "https://www.youtube.com/@HealthyGamerGG"
  language: en
  active: true
  priority: 1
  notes: "Burnout, imposter syndrome, ADHD, mental health in tech - gold for soft skills pillar"

- name: "ByteByteGo (YouTube)"
  type: youtube
  url: "https://www.youtube.com/@ByteByteGo"
  language: en
  active: true
  priority: 2
  notes: "System design interviews, architecture deep dives"

---

## How Topic Scout uses this file

1. Parse all YAML blocks; filter where `active: true`.
2. Sort by `priority` (1 first).
3. Use `url` and `type` to decide how to fetch or search (e.g. Reddit API or RSS, HN API, feed URLs). If the agent cannot call external APIs, it may use web search or you supply an “inbox” of links.
4. Prefer sources with `language: he` for Israeli-specific angles; mix with `en` for global dev/prospect signals.

For Geektime (type: blog), run `npm run geektime:scrape` and use **out/sources/geektime-articles.md** (one Markdown file with all categories and articles).

To add Israeli sources later: add new blocks in the same format and set `active: true`.
- name: "Twitter / X"\ntype: twitter\nurl: "https://twitter.com/"\nlanguage: en\nactive: true\npriority: 2\nnotes: "Real-time ideas, trending topics, dev discussions"
