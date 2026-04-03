---
name: lotechni-summary
description: Create episode summaries for "לא טכני ולא במקרה". Download captions from YouTube, generate HTML + YouTube description versions, send to Tal for review, then update YouTube after approval.
---

# Lotechni Summary Skill

Creates episode summaries for "לא טכני ולא במקרה" (Not Technical and Not by Chance).

Use the **notion-lotechni** MCP for all Notion operations.

## ⚠️ CRITICAL RULES

- **NEVER update YouTube without Tal's approval** on the summary first
- **NEVER publish to Spotify** — descriptions managed separately
- **Always send both versions** (HTML + YouTube) to Tal for review before uploading

---

## Step 1 — Download captions from YouTube

```bash
python3 /app/podcast-scripts/get-captions.py [VIDEO_ID] --lang iw --format txt
```

Output: `/workspace/group/transcript_[VIDEO_ID].txt`

If no captions yet (YouTube takes ~1–2 hours after upload):
```bash
python3 /app/podcast-scripts/get-captions.py [VIDEO_ID] --list
```

Token auto-refreshes on 401. If token is fully expired, run:
```bash
python3 /app/podcast-scripts/setup-oauth.py
```

---

## Step 2 — Read RSS feed for style and episode numbering

```bash
curl -s "https://anchor.fm/s/f01f6814/podcast/rss" | head -500
```

Look at recent episode titles and descriptions for numbering (פרק 45, etc.) and style consistency.

---

## Step 3 — Generate two summary versions

Using the captions + RSS context, generate both deliverables:

### Version 1: HTML (for website / RSS / Spotify)

```html
<h3>פרק {NUMBER} = [Catchy title] - [Guest name]</h3>
<p>[Opening: 3–4 sentences. Start with pain point, introduce Tal, Adir, and guest, explain listener value].</p>
<p><strong>רגע אחד זכור במיוחד:</strong><br>
"[Strong, thought-provoking quote from the episode]"</p>
<p><strong>על מה דיברנו הפעם?</strong></p>
<ul>
<li>[Point 1 — actionable, punchy, explains WHY it's worth listening]</li>
<li>[Point 2]</li>
<li>[Point 3]</li>
<li>[Point 4]</li>
<li>[Point 5]</li>
</ul>
<p>------</p>
<p>מוזמנים להאזין לנו בכל הפלטפורמות ולהצטרף לקהילה שלנו בוואטסאפ ⬇️<br>
<a href="https://lotechni.dev">https://lotechni.dev</a></p>
<p>אנחנו נהנים מאוד ליצור תוכן איכותי ומקורי עבור קהילת המפתחים. נשמח אם תעבירו את הפרק לעוד חבר או חברה, נשמח לשמוע תגובות ורעיונות חדשים ולראות שהפודקאסט מדורג ב-5 כוכבים :) מחכים לכם בקהילה</p>
```

### Version 2: YouTube (emojis, spaced paragraphs, hashtags)

```
פרק {NUMBER} = [Catchy title] - [Guest name] 🚀

[Opening 3–4 sentences matching HTML but with 1–2 emojis].

💡 רגע אחד זכור במיוחד:

"[Strong quote from the episode]"

🎙️ על מה דיברנו הפעם?

[Emoji] [Topic]: [Short value explanation for developers]
[Emoji] [Topic]: [Short value explanation for developers]
[Emoji] [Topic]: [Short value explanation for developers]
[Emoji] [Topic]: [Short value explanation for developers]
[Emoji] [Topic]: [Short value explanation for developers]

🔗 הצטרפו לקהילה שלנו:

מוזמנים להאזין לנו בכל הפלטפורמות ולהצטרף לקהילה שלנו בוואטסאפ ⬇️

https://lotechni.dev

❤️ אהבתם?

אנחנו נהנים מאוד ליצור תוכן איכותי ומקורי עבור קהילת המפתחים. נשמח אם תעבירו את הפרק לעוד חבר או חברה, נשמח לשמוע תגובות ורעיונות חדשים ולראות שהפודקאסט מדורג ב-5 כוכבים :) מחכים לכם בקהילה!

#[RelevantHashtag] #SoftwareEngineering #TechPodcast #CareerGrowth #לא_טכני_ולא_במקרה
```

### Content guidelines

**Opening (Hook):** Start with a pain point question or strong statement. Introduce the topic and guest.

**Quote:** One strong, thought-provoking quote from the transcript under "רגע אחד זכור במיוחד".

**Bullet points (5–7):** Short, punchy, emphasize WHY developers should listen (WIIFM).
- NOT: "we talked about X"
- YES: "how to do X to advance your career" / "why Y is dead and how it affects you"

**Tone:** Conversational, light, a bit cheeky, very practical. Speak to developers as a colleague.

---

## Step 4 — Send both versions to Tal for review

Send BOTH the HTML version and the YouTube version. Wait for approval.

---

## Step 5 — Update YouTube description (only after Tal approves)

```bash
python3 - <<'SCRIPT'
import json
from urllib.request import urlopen, Request

TOKEN_FILE = "/workspace/extra/credentials/youtube-tokens.json"
VIDEO_ID = "VIDEO_ID_HERE"
description = """APPROVED_DESCRIPTION_HERE"""

with open(TOKEN_FILE) as f:
    at = json.load(f)["access_token"]

url = f"https://www.googleapis.com/youtube/v3/videos?part=snippet&id={VIDEO_ID}"
req = Request(url, headers={"Authorization": f"Bearer {at}"})
video_data = json.loads(urlopen(req).read())
snippet = video_data["items"][0]["snippet"]
snippet["description"] = description

update_url = "https://www.googleapis.com/youtube/v3/videos?part=snippet"
req = Request(
    update_url,
    data=json.dumps({"id": VIDEO_ID, "snippet": snippet}).encode(),
    headers={"Authorization": f"Bearer {at}", "Content-Type": "application/json"},
    method="PUT"
)
urlopen(req)
print("✅ YouTube description updated")
SCRIPT
```

---

## Reference

- Show: לא טכני ולא במקרה — soft skills and career coaching for developers
- Hosts: Tal Moskovich (טל מוסקוביץ') and Adir Kandel (אדיר קנדל)
- RSS: `https://anchor.fm/s/f01f6814/podcast/rss`
- Hebrew + inline English tech terms is standard style
- Credentials: `/workspace/extra/credentials/youtube-tokens.json`
