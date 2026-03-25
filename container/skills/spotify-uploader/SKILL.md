---
name: spotify-uploader
description: Upload a podcast episode to Spotify for Podcasters as a draft. Use when asked to upload to Spotify.
---

# Spotify Uploader

Upload podcast episodes to Spotify for Podcasters using the browser.

## Authentication

Session cookies are stored at `/workspace/extra/credentials/spotify-auth.json`.

Before navigating to Spotify, inject the cookies from that file into the browser session. If the cookies are expired and login is required, complete the login flow and save the updated cookies back to `/workspace/extra/credentials/spotify-auth.json`.

## Steps

1. Use `agent-browser` to open `https://creators.spotify.com`.
2. Inject cookies from `/workspace/extra/credentials/spotify-auth.json` if not already authenticated.
3. Navigate to your podcast show and click "New episode" (or equivalent).
4. Upload the audio file provided.
5. Fill in the episode title and description as provided.
6. **Save as draft — do not publish.**
7. Report the draft episode URL.

## Notes

- Podcast show ID: `331GnnQsHxjU7SjS1bFJnS` (visible in the show URL).
- Always save as draft, never publish directly — Tal reviews before publishing.
- If upload fails due to file size, check available space and retry.
