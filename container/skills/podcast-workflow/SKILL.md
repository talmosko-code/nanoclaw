---
name: podcast-workflow
description: Upload podcast episodes to YouTube and Spotify, then generate episode summary. Full pipeline: download from MyAirBridge → upload to YouTube + Spotify → schedule summary generation.
---

# Podcast Workflow

Orchestrates the full podcast episode lifecycle for "לא טכני ולא במקרה".

## Dependencies

- `myairbridge-downloader` skill — download source file from mab.to
- `youtube-api` skill — YouTube upload + captions
- `spotify-uploader` skill — Spotify for Podcasters upload
- `lotechni-summary` skill — episode summary generation

---

## ⚠️ CRITICAL RULES

**One upload attempt only.** If YouTube or Spotify upload fails → **STOP**. Report what happened. Wait for Tal's instructions. Do NOT retry without explicit approval.

**Report after every step** — what completed, relevant details (file name, video ID, URL), and what's starting next.

**Never auto-publish.** YouTube: upload as `unlisted`. Spotify: save as draft. Tal reviews before publishing.

**Never assume success.** If a step "probably worked" but you're not 100% sure → STOP and ask Tal to verify.

**Timeouts are not failures.** If upload reached 90%+ and timed out, report the status and ask Tal how to proceed.

---

## Step 1 — Download from MyAirBridge

Use `myairbridge-downloader` skill to download the MP4 to `/workspace/group/`.

**REPORT:** "✅ Download complete: [filename] ([size])"

---

## Step 2 — Upload to YouTube

Use `youtube-api` skill:

```bash
python3 /app/podcast-scripts/upload-video.py \
  --file /workspace/group/[FILENAME].mp4 \
  --title "[TITLE]" \
  --description "[DESCRIPTION]" \
  --privacy unlisted \
  --tags "פודקאסט,לא טכני ולא במקרה,תכנות,פיתוח,קריירה"
```

Save the **video ID** from the output — needed for captions.

**REPORT:** "✅ YouTube upload complete: [video ID] | https://youtube.com/watch?v=[ID]"

If upload fails → **STOP**.

---

## Step 3 — Compress for Spotify (only if needed)

**Skip compression by default.** Spotify accepts files up to 10 GB+. Direct upload is preferred.

Only compress if:
- Source file > 10 GB AND swap is limited (< 8 GB free)
- Source is ProRes/RAW (extremely large)
- Internet connection is very slow

If needed:
```bash
ffmpeg -i input.mp4 -c:v libx264 -preset medium -crf 22 -c:a copy -movflags +faststart output.mp4
```

**REPORT:** "⏭️ Skipping compression — direct upload" OR "✅ Compression complete: [size]"

---

## Step 4 — Upload to Spotify

Use `spotify-uploader` skill. Upload the same MP4 (or compressed version if Step 3 ran).

**REPORT:** "✅ Spotify upload complete: draft saved"

If upload fails → **STOP**.

---

## Step 5 — Schedule summary generation (2 hours later)

YouTube captions take ~1–2 hours to generate after upload. Schedule summary generation:

```bash
echo "Run /lotechni-summary with VIDEO_ID=[VIDEO_ID]" | at now + 2 hours 2>/dev/null || \
  echo "⚠️ 'at' not available — remind Tal to run /lotechni-summary in ~2 hours"
```

**REPORT:** "⏳ Summary scheduled in 2 hours (video ID: [ID])"

---

## Step 6 — Generate summary (runs after 2 hours)

Use `lotechni-summary` skill with the video ID from Step 2.

This will:
1. Download Hebrew captions from YouTube
2. Read RSS feed for style reference
3. Generate HTML + YouTube description versions
4. Send both to Tal for review

**REPORT:** "📄 Summary ready for review"

**WAIT for Tal's approval** before updating the YouTube description. **NEVER update Spotify** — descriptions managed separately.

---

## Options

Pass these when triggering the workflow:
- `--skip-youtube` — Spotify only
- `--skip-spotify` — YouTube only
- `--privacy public|unlisted|private` (default: unlisted)

---

## Reference

- Spotify show ID: `331GnnQsHxjU7SjS1bFJnS`
- Upload times: YouTube ~10–15 min/10 GB, Spotify ~3–5 min/10 GB
- YouTube quota: ~6 uploads/day on free tier
- Credentials: `/workspace/extra/credentials/` (youtube-tokens.json, spotify-auth.json)
