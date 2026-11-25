---
name: gmail
description: Read, search, draft, send, and organize Gmail messages, threads, and labels through the enabled Gmail connector.
---

# Gmail

Use the current tool catalog to find the connected Gmail tools named `mcp__gmail_<id>__<tool>`. Use only tools belonging to the Gmail connection. If no Gmail tools are available, ask the user to connect and enable Gmail in Settings → Connectors.

Search with Gmail's own query syntax (`from:`, `to:`, `subject:`, `has:attachment`, `newer_than:7d`, `is:unread`), then read whole threads rather than single messages when a reply needs context. Labels have ids that differ from their names, so list them before applying one. Archive, mark read, and other triage go through label changes.

Search and read relevant messages before preparing a reply, and keep the thread and message identifiers from those results. Draft first; send a draft only when the user asked for it to be sent, preserving the recipients and attachments they supplied; honor tool approvals. Report only results the tools returned.
