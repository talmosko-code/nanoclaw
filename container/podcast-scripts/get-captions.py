#!/usr/bin/env python3
"""Download captions from YouTube video using Data API v3."""
import json, argparse, sys, os
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from urllib.error import HTTPError

TOKEN_FILE = "/workspace/extra/credentials/youtube-tokens.json"
CLIENT_SECRET_FILE = "/workspace/extra/credentials/youtube-client-secret.json"
SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/youtube.force-ssl"
]

def refresh_token():
    """Refresh the access token using refresh token."""
    with open(TOKEN_FILE) as f:
        tokens = json.load(f)
    with open(CLIENT_SECRET_FILE) as f:
        creds = json.load(f)["installed"]
    
    data = {
        "client_id": creds["client_id"],
        "client_secret": creds["client_secret"],
        "refresh_token": tokens["refresh_token"],
        "grant_type": "refresh_token"
    }
    req = Request(
        "https://oauth2.googleapis.com/token",
        data=urlencode(data).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    resp = urlopen(req)
    new_tokens = json.loads(resp.read().decode())
    tokens["access_token"] = new_tokens["access_token"]
    tokens["expires_in"] = new_tokens.get("expires_in", 3600)
    with open(TOKEN_FILE, "w") as f:
        json.dump(tokens, f, indent=2)
    return tokens["access_token"]

def get_access_token():
    with open(TOKEN_FILE) as f:
        tokens = json.load(f)
    return tokens["access_token"]

def get_captions_list(video_id, access_token, retry=True):
    """Get list of available caption tracks."""
    req = Request(
        f"https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId={video_id}",
        headers={"Authorization": f"Bearer {access_token}"}
    )
    try:
        resp = urlopen(req)
        return json.loads(resp.read().decode())
    except HTTPError as e:
        if e.code == 401 and retry:
            # Token expired, refresh and retry
            print("Token expired, refreshing...", file=sys.stderr)
            new_token = refresh_token()
            return get_captions_list(video_id, new_token, retry=False)
        raise

def download_caption(caption_id, access_token, fmt="sbv", retry=True):
    """Download caption content by track ID."""
    params = {"tfmt": fmt}
    url = f"https://www.googleapis.com/youtube/v3/captions/{caption_id}?{urlencode(params)}"
    req = Request(url, headers={"Authorization": f"Bearer {access_token}"})
    try:
        resp = urlopen(req)
        return resp.read().decode()
    except HTTPError as e:
        if e.code == 401 and retry:
            # Token expired, refresh and retry
            print("Token expired, refreshing...", file=sys.stderr)
            new_token = refresh_token()
            return download_caption(caption_id, new_token, fmt, retry=False)
        raise

def parse_sbv(content):
    """Parse SBV format to plain text lines."""
    lines = []
    for block in content.strip().split("\n\n"):
        parts = block.split("\n", 1)
        if len(parts) > 1:
            text = parts[1].strip()
            # Remove duplicate lines
            if text and (not lines or text != lines[-1]):
                lines.append(text)
    return "\n".join(lines)

def parse_vtt(content):
    """Parse VTT format to plain text lines."""
    lines = []
    for line in content.split("\n"):
        line = line.strip()
        if not line or line.startswith("WEBVTT") or line.startswith("Kind:") or line.startswith("Language:") or "-->" in line or line.isdigit():
            continue
        # Remove HTML tags
        import re
        clean = re.sub(r'<[^>]+>', '', line)
        if clean and (not lines or clean != lines[-1]):
            lines.append(clean)
    return "\n".join(lines)

def get_channel_info(access_token):
    """Get current channel info."""
    req = Request(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
        headers={"Authorization": f"Bearer {access_token}"}
    )
    resp = urlopen(req)
    return json.loads(resp.read().decode())

def main():
    parser = argparse.ArgumentParser(description="Download YouTube captions")
    parser.add_argument("video_id", nargs="?", help="YouTube video ID or URL")
    parser.add_argument("--lang", default="iw", help="Language code (default: iw)")
    parser.add_argument("--format", choices=["txt", "srt", "vtt", "sbv"], default="txt", help="Output format")
    parser.add_argument("--list", action="store_true", help="List available caption tracks")
    parser.add_argument("--channel", action="store_true", help="Show channel info")
    args = parser.parse_args()

    try:
        access_token = get_access_token()
    except Exception as e:
        print(f"Token error: {e}. Refreshing...")
        access_token = refresh_token()

    if args.channel:
        data = get_channel_info(access_token)
        if data.get("items"):
            ch = data["items"][0]["snippet"]
            stats = data["items"][0]["statistics"]
            print(f"Channel: {ch['title']}")
            print(f"ID: {data['items'][0]['id']}")
            print(f"Subscribers: {stats.get('subscriberCount', 'N/A')}")
            print(f"Videos: {stats.get('videoCount', 'N/A')}")
        return

    if not args.video_id:
        parser.print_help()
        return

    # Extract video ID from URL
    vid = args.video_id
    if "youtube.com" in vid or "youtu.be" in vid:
        import re
        m = re.search(r"(?:v=|/)([\w-]{11})", vid)
        if m:
            vid = m.group(1)

    # List or download (functions handle token refresh internally)
    try:
        data = get_captions_list(vid, access_token)
    except HTTPError:
        # Token was refreshed by get_captions_list, get new token
        access_token = get_access_token()
        data = get_captions_list(vid, access_token)
    
    tracks = data.get("items", [])
    
    if not tracks:
        print(f"No captions found for video {vid}")
        return

    if args.list:
        for t in tracks:
            s = t["snippet"]
            print(f"  {s['language']}: {s.get('name', '')} (id: {t['id']})")
        return

    # Find requested language track
    track = next((t for t in tracks if t["snippet"]["language"] == args.lang), None)
    if not track:
        print(f"No captions for language '{args.lang}'")
        print(f"Available: {[t['snippet']['language'] for t in tracks]}")
        return

    print(f"Downloading captions: {track['snippet'].get('name', args.lang)}...")
    
    # Download in sbv format (best for conversion)
    try:
        content = download_caption(track["id"], access_token, fmt="sbv")
    except HTTPError:
        # Token was refreshed by download_caption, get new token and retry
        access_token = get_access_token()
        content = download_caption(track["id"], access_token, fmt="sbv")
    
    if args.format == "txt":
        output = parse_sbv(content)
    elif args.format == "srt":
        # Convert sbv to srt
        output = sbv_to_srt(content)
    else:
        output = content

    outfile = f"/workspace/group/transcript_{vid}.{args.format}"
    with open(outfile, "w") as f:
        f.write(output)
    
    lines = output.split("\n")
    print(f"✅ Saved {len(lines)} lines to {outfile}")
    print(f"\nFirst 300 chars:\n{output[:300]}")

def sbv_to_srt(sbv):
    """Convert SBV subtitle format to SRT."""
    srt_blocks = []
    idx = 1
    for block in sbv.strip().split("\n\n"):
        lines = block.split("\n")
        if len(lines) >= 2:
            # Convert timestamp
            ts = lines[0]
            ts = ts.replace(",", ".")
            parts = ts.split(".")
            if len(parts) == 2:
                # Add milliseconds padding
                ts_srt = f"{parts[0]},{parts[1].ljust(3, '0')}"
            else:
                ts_srt = ts
            # SBV uses start,end on same line
            time_parts = ts_srt.split(",")
            if len(time_parts) >= 4:
                start = f"{time_parts[0]},{time_parts[1].ljust(3,'0')}"
                end = f"{time_parts[2]},{time_parts[3].ljust(3,'0')}"
                text = "\n".join(lines[1:])
                srt_blocks.append(f"{idx}\n{start} --> {end}\n{text}\n")
                idx += 1
    return "\n".join(srt_blocks)

if __name__ == "__main__":
    main()
