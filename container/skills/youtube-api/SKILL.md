---
name: youtube-api
description: Upload videos to YouTube and download captions using the YouTube Data API v3. Use when uploading a podcast episode to YouTube or downloading captions for an existing video.
---

# YouTube API Skill

Upload videos and download captions via YouTube Data API v3.
Scripts are at `/app/podcast-scripts/` (baked into the container).

## Credentials

OAuth tokens are required. They live at:
- `/workspace/extra/credentials/youtube-tokens.json` — access + refresh tokens (auto-refreshed)
- `/workspace/extra/credentials/youtube-client-secret.json` — OAuth client secret

If these files are missing, run the OAuth setup (see below).

---

## Upload a Video

```bash
python3 /app/podcast-scripts/upload-video.py \
  --file /workspace/group/episode.mp4 \
  --title "פרק 45 - כותרת | שם אורח | לא טכני ולא במקרה" \
  --description "תיאור הפרק" \
  --privacy unlisted \
  --tags "פודקאסט,לא טכני ולא במקרה,קריירה,פיתוח"
```

Options:
- `--file` — path to video file (any path accessible in the container)
- `--title` — video title
- `--description` — description (supports multiline)
- `--privacy` — `public`, `unlisted`, or `private` (default: unlisted)
- `--tags` — comma-separated tags
- `--playlist` — playlist ID to add to after upload

On success, prints the video ID and URL. The video ID is needed for captions.

---

## Download Captions

```bash
# Download Hebrew captions as plain text
python3 /app/podcast-scripts/get-captions.py VIDEO_ID --lang iw --format txt

# List available caption tracks
python3 /app/podcast-scripts/get-captions.py VIDEO_ID --list

# Download as SRT
python3 /app/podcast-scripts/get-captions.py VIDEO_ID --lang iw --format srt
```

Output is saved to `/workspace/group/transcript_{VIDEO_ID}.{format}`.

Note: YouTube takes ~1–2 hours to generate auto-captions after upload. If `--list` shows no tracks, wait and retry.

---

## Update Video Description

```bash
python3 - <<'EOF'
import json
from urllib.request import urlopen, Request

TOKEN_FILE = "/workspace/extra/credentials/youtube-tokens.json"
VIDEO_ID = "VIDEO_ID_HERE"
description = """DESCRIPTION_HERE"""

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
print("✅ Description updated")
EOF
```

---

## Channel Info

```bash
python3 /app/podcast-scripts/get-captions.py --channel
```

---

## OAuth Setup (first time only)

Run this once to generate `youtube-tokens.json`:

```bash
python3 /app/podcast-scripts/setup-oauth.py
```

Follow the printed instructions: open the auth URL, approve permissions, paste the redirect URL.
Tokens are saved to `/workspace/extra/credentials/youtube-tokens.json`.
After setup, `upload-video.py` and `get-captions.py` auto-refresh the token on expiry.

---

## Notes

- YouTube upload of 10 GB takes ~10–15 minutes
- Quota: ~1,600 units/upload, ~6 uploads/day on the free tier
- Token auto-refresh: both scripts retry once with a refreshed token on HTTP 401
- Upload the original MP4 — YouTube handles large files (tested up to 10 GB)
