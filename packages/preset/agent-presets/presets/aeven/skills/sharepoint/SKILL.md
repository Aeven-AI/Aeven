---
name: sharepoint
description: Read and manage site libraries and list items through the enabled work-account SharePoint connector.
---

# SharePoint

Use the current tool catalog to find the connected SharePoint tools named `mcp__sharepoint_<id>__<tool>`. Use only tools belonging to that connection, matching the account shown in Settings → Connectors. If they are unavailable, ask the user to connect and enable SharePoint there.

Find the requested site, then list its libraries or lists. Use returned site, drive, list, and item IDs; do not guess identifiers or act on a similarly named site. File uploads, moves, copies, renames, deletions, sharing, permission changes, and list-item creation, edits, or deletion require approval. Read back completed changes. This connector needs a work account and may require administrator consent. Site administration and tenant-wide directory tools are unavailable. Report only observed results; a tool name in the catalog does not prove a call succeeded.
