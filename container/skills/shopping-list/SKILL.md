---
name: shopping-list
description: Manage Tal's Notion shopping list. Add items to the top of the current list, or create a new weekly list. Triggers on "add to shopping list", "צרף לרשימת הקניות", "create weekly shopping list", "צור רשימת קניות שבועית", or similar.
---

# Shopping List Manager

Manage the family shopping list in Notion using the Notion MCP.

## Database

- **Database ID:** `309ee1e2-7af9-8023-bea0-f0b59520044a`
- **Page title format:** `רשימת קניות DD/MM/YYYY` (Hebrew, day/month/year)
- **Block type:** `to_do` blocks for all items

---

## Operation 1: Add Items to Top

Use when: user wants to add items to the shopping list.

### Steps

1. Query the database sorted by `created_time` descending, `page_size: 1` to get the latest page.
2. Fetch all existing blocks from that page (`/blocks/{page_id}/children`).
3. Delete every existing block (`DELETE /blocks/{block_id}`).
4. Build the new list: new items first (as unchecked `to_do` blocks), then all old blocks in their original order.
5. Append everything back to the page in batches (`PATCH /blocks/{page_id}/children`).
6. Report back: list name found, items added, and the page URL.

### Notes

- Notion has no native prepend — delete-and-rebuild is the correct approach.
- Items may arrive comma-separated or newline-separated — split and trim each one.
- Preserve the `checked` state of existing to-do blocks when rebuilding.
- Page URL format: `https://www.notion.so/tmosko/page-{page_id_no_hyphens}`

---

## Operation 2: Create Weekly Shopping List

Use when: user asks to create a new weekly list (typically on Saturday).

### Steps

1. Build today's title: `רשימת קניות DD/MM/YYYY`.
2. If a non-archived page with that title already exists, archive it first.
3. Query the DB for the most recent non-archived page that does **not** have today's title — this is the previous week's list.
4. Create a new page in the database with today's title.
5. Append the following blocks to the new page in this order:
   - Empty `to_do` block (content: single space ` `)
   - Empty `to_do` block (no content)
   - Empty `paragraph` block
   - `paragraph` block: `// הרשימה הקודמת - <previous date>` (extract date from previous title)
   - `paragraph` block with a link to the previous page: text = previous page title, URL = `https://www.notion.so/tmosko/page-{previous_id_no_hyphens}`
   - Copy all `to_do` and `paragraph` blocks from the previous page, but **only blocks that appear before the first `// הרשימה הקודמת` comment** — skip everything after it. Skip empty trailing blocks.
6. Report back: new page title and URL.
