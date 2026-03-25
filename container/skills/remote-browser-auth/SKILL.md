---
name: remote-browser-auth
description: Re-authenticate with websites (Spotify, etc.) when sessions expire. Guides the user through exporting fresh session cookies from their local browser to the server. Use when Spotify uploader fails with auth errors.
---

# Remote Browser Auth

When a site session expires (e.g. Spotify for Podcasters), use this to export fresh cookies from the user's local machine to the server.

## How It Works

1. User runs the export script on their local machine (with a GUI browser)
2. They log in manually
3. Cookies are saved and sent to the server's credentials directory

## Spotify Re-Auth

Tell the user to run this on their **local machine**:

```bash
cd /path/to/podcast-tools/remote-browser-auth/examples
node spotify-podcasters-auth.js
# Log in manually when the browser opens, then press Enter
# This saves spotify-auth.json locally
```

Then copy the output file to the server:
```bash
scp spotify-auth.json root@<server>:/root/Documents/credentials/spotify-auth.json
```

The scripts are at: `/workspace/extra/podcast-tools/remote-browser-auth/`

## Generic Re-Auth

For other sites, use the general flow:
```bash
# On server
node /workspace/extra/podcast-tools/remote-browser-auth/start-auth-server.js --url https://example.com --port 9222

# User connects via SSH tunnel and logs in manually
# Then export with:
node /workspace/extra/podcast-tools/remote-browser-auth/export-auth-local.js
```
