---
name: telegram-screenshot
description: Take a screenshot of a URL or current browser state and send it to Tal via Telegram. Use when asked to "send screenshot", "תשלח לי screenshot", or for visual debugging.
---

# Telegram Screenshot

Take a screenshot and send it to Tal directly via Telegram.

## Steps

1. Use `agent-browser` to navigate to the target URL (or capture the current state).
2. Take a screenshot and save it to `/tmp/screenshot.png`.
3. Send it to Tal:

```bash
node /workspace/extra/podcast-tools/telegram-screenshot/send.js /tmp/screenshot.png "optional caption"
```

## Notes

- Token is read from `/workspace/extra/credentials/telegram-bot-token`.
- Sends directly to Tal's chat (ID `465482646`) — not to the current group.
- Supports PNG, JPG, GIF, WEBP. Max 50 MB.
- Caption is optional.
