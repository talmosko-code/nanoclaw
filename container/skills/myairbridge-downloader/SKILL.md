---
name: myairbridge-downloader
description: Download files from MyAirBridge (mab.to) shared links. Use when given a mab.to URL to download an MP3, MP4, or other file.
---

# MyAirBridge Downloader

Download files from MyAirBridge shared links using the browser.

## Steps

1. Use `agent-browser` to navigate to the mab.to shared link.
2. Wait for the page to load fully. Look for a download button or direct file link.
3. Intercept or locate the direct download URL (usually found in the network requests or as a direct href on the download button).
4. Use `curl -L -o <filename> "<download-url>"` to download the file to `/workspace/group/`.
5. Report the local filename, file size, and full path.

## Notes

- MyAirBridge links expire — download promptly.
- Large files (1GB+) may take several minutes. Show progress with `curl --progress-bar`.
- Default save location: `/workspace/group/` (writable group folder).
