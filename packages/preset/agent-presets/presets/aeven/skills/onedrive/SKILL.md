---
name: onedrive
description: Find, upload, organize, and share the connected account’s OneDrive files.
---

# OneDrive

Use the current tool catalog to find the connected OneDrive tools named `mcp__account_<id>__<tool>`. Use only tools belonging to that connection, matching the account shown in Settings → Connectors. If they are unavailable, ask the user to connect and enable OneDrive there.

List the account's drives, then use returned drive and item IDs to browse or search. Preserve file names, paths, and content supplied by the user. Uploading, renaming, moving, copying, deleting, creating folders, changing permissions, and sharing require approval. Read back completed changes and report the resulting item or sharing link. This connector serves the account's own drive; SharePoint libraries use the SharePoint connector. Excel editing and tenant-wide searches are unavailable. Report only observed results; a tool name in the catalog does not prove a call succeeded.
