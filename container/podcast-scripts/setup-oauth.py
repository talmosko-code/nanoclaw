#!/usr/bin/env python3
"""
YouTube Data API v3 OAuth setup script.

Run this ONCE from inside the podcast container (or on the host with /workspace/extra/credentials/ accessible)
to generate youtube-tokens.json. After that, upload-video.py and get-captions.py auto-refresh the token.

Credentials are read/written at /workspace/extra/credentials/ (mounted from /root/Documents/credentials/).
"""
import json, os, sys, urllib.parse
from urllib.request import urlopen, Request
from urllib.parse import urlencode

CLIENT_SECRET_FILE = "/workspace/extra/credentials/youtube-client-secret.json"
TOKEN_FILE = "/workspace/extra/credentials/youtube-tokens.json"

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/youtube.force-ssl"
]

def main():
    if not os.path.exists(CLIENT_SECRET_FILE):
        print(f"❌ Client secret not found: {CLIENT_SECRET_FILE}")
        print("Download it from Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs")
        sys.exit(1)

    with open(CLIENT_SECRET_FILE) as f:
        creds = json.load(f)["installed"]

    client_id = creds["client_id"]
    client_secret = creds["client_secret"]

    auth_params = {
        "client_id": client_id,
        "redirect_uri": "http://localhost",
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent"
    }

    auth_url = f"https://accounts.google.com/o/oauth2/auth?{urllib.parse.urlencode(auth_params)}"

    print("=" * 60)
    print("YouTube OAuth Setup")
    print("=" * 60)
    print()
    print("1. Open this URL in your browser:")
    print()
    print(auth_url)
    print()
    print("2. Log in with your Google account (the one with your YouTube channel)")
    print("3. Approve the permissions")
    print("4. You'll be redirected to localhost — copy the FULL URL")
    print("5. Paste it here")
    print()

    redirect = input("Enter the redirect URL (or just the code= value): ").strip()

    if "code=" in redirect:
        code = redirect.split("code=")[1].split("&")[0]
    else:
        code = redirect

    token_data = {
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": "http://localhost",
        "grant_type": "authorization_code"
    }

    req = Request(
        "https://oauth2.googleapis.com/token",
        data=urlencode(token_data).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"}
    )

    resp = urlopen(req)
    tokens = json.loads(resp.read().decode())

    os.makedirs(os.path.dirname(TOKEN_FILE), exist_ok=True)
    with open(TOKEN_FILE, "w") as f:
        json.dump(tokens, f, indent=2)

    print()
    print(f"✅ Tokens saved to {TOKEN_FILE}")
    print(f"   Access token:  {tokens['access_token'][:20]}...")
    print(f"   Refresh token: {tokens.get('refresh_token', 'N/A')[:20]}...")
    print()
    print("Test with:")
    print("  python3 /app/podcast-scripts/get-captions.py --channel")

if __name__ == "__main__":
    main()
