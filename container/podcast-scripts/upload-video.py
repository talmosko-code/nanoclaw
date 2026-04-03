#!/usr/bin/env python3
"""Upload video to YouTube using Data API v3."""
import json, argparse, os, sys, time, mimetypes
from urllib.request import urlopen, Request
from urllib.parse import urlencode

TOKEN_FILE = "/workspace/extra/credentials/youtube-tokens.json"
CLIENT_SECRET_FILE = "/workspace/extra/credentials/youtube-client-secret.json"

def get_access_token():
    with open(TOKEN_FILE) as f:
        tokens = json.load(f)
    return tokens["access_token"]

def refresh_token():
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
    new = json.loads(resp.read().decode())
    tokens["access_token"] = new["access_token"]
    with open(TOKEN_FILE, "w") as f:
        json.dump(tokens, f, indent=2)
    return tokens["access_token"]

def get_resumable_url(access_token, metadata, file_size):
    """Initiate resumable upload and get upload URL."""
    import json as j
    req = Request(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        data=j.dumps(metadata).encode(),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "X-Upload-Content-Length": str(file_size),
            "X-Upload-Content-Type": "video/*"
        },
        method="POST"
    )
    resp = urlopen(req)
    return resp.headers.get("Location")

def upload_file(upload_url, filepath, file_size):
    """Upload the video file using chunked resumable upload."""
    import ssl
    mime = mimetypes.guess_type(filepath)[0] or "video/*"
    CHUNK_SIZE = 5 * 1024 * 1024  # 5MB chunks
    
    # Create SSL context that doesn't verify (for some VPS setups)
    ctx = ssl.create_default_context()
    
    with open(filepath, "rb") as f:
        start = 0
        while start < file_size:
            chunk = f.read(min(CHUNK_SIZE, file_size - start))
            end = start + len(chunk) - 1
            content_range = f"bytes {start}-{end}/{file_size}"
            
            req = Request(
                upload_url,
                data=chunk,
                headers={
                    "Content-Type": mime,
                    "Content-Range": content_range,
                    "Content-Length": str(len(chunk))
                },
                method="PUT"
            )
            
            pct = (end + 1) / file_size * 100
            print(f"  Uploading: {pct:.1f}% ({(end+1)/(1024*1024):.0f}/{file_size/(1024*1024):.0f} MB)")
            
            try:
                resp = urlopen(req, context=ctx)
                # If we get here and it's 200/201, upload is complete
                return json.loads(resp.read().decode())
            except Exception as e:
                # 308 Resume Incomplete is expected for chunks
                code = getattr(e, 'code', None)
                if code in (308, 300):
                    start = end + 1
                    continue
                elif code in (200, 201):
                    return json.loads(e.read().decode() if hasattr(e, 'read') else '{}')
                else:
                    raise
    
    # Final PUT with no content to complete
    req = Request(
        upload_url,
        data=b'',
        headers={
            "Content-Type": mime,
            "Content-Range": f"bytes */{file_size}"
        },
        method="PUT"
    )
    resp = urlopen(req, context=ctx)
    return json.loads(resp.read().decode())

def add_to_playlist(access_token, video_id, playlist_id):
    """Add video to a playlist."""
    import json as j
    body = {
        "snippet": {
            "playlistId": playlist_id,
            "resourceId": {
                "kind": "youtube#video",
                "videoId": video_id
            }
        }
    }
    req = Request(
        "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet",
        data=j.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        },
        method="POST"
    )
    resp = urlopen(req)
    return json.loads(resp.read().decode())

def main():
    parser = argparse.ArgumentParser(description="Upload video to YouTube")
    parser.add_argument("--file", required=True, help="Video file path")
    parser.add_argument("--title", required=True, help="Video title")
    parser.add_argument("--description", default="", help="Video description")
    parser.add_argument("--privacy", choices=["public", "unlisted", "private"], default="unlisted")
    parser.add_argument("--tags", default="", help="Comma-separated tags")
    parser.add_argument("--playlist", default=None, help="Playlist ID to add to")
    args = parser.parse_args()

    filepath = args.file
    if not os.path.exists(filepath):
        print(f"❌ File not found: {filepath}")
        sys.exit(1)

    file_size = os.path.getsize(filepath)
    print(f"📹 Uploading: {os.path.basename(filepath)} ({file_size / (1024*1024):.1f} MB)")

    try:
        access_token = get_access_token()
    except:
        print("Refreshing token...")
        access_token = refresh_token()

    metadata = {
        "snippet": {
            "title": args.title,
            "description": args.description,
            "tags": [t.strip() for t in args.tags.split(",") if t.strip()]
        },
        "status": {
            "privacyStatus": args.privacy,
            "selfDeclaredMadeForKids": False
        }
    }

    print("Getting upload URL...")
    upload_url = get_resumable_url(access_token, metadata, file_size)

    print("Uploading video...")
    result = upload_file(upload_url, filepath, file_size)

    video_id = result.get("id")
    title = result.get("snippet", {}).get("title", "")
    print(f"\n✅ Uploaded!")
    print(f"   Title: {title}")
    print(f"   ID: {video_id}")
    print(f"   URL: https://www.youtube.com/watch?v={video_id}")

    if args.playlist:
        add_to_playlist(access_token, video_id, args.playlist)
        print(f"   Added to playlist: {args.playlist}")

if __name__ == "__main__":
    main()
