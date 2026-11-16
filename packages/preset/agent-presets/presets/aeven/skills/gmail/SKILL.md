---
name: gmail
description: Send Gmail messages and manage Gmail labels through the enabled Gmail connector; read and search Gmail mail through the user's email account tools.
---

# Gmail

Use the current tool catalog to find the connected Gmail tools named `mcp__gmail_<id>__<tool>`. Use only tools belonging to the Gmail connection. If no Gmail tools are available, ask the user to connect and enable Gmail in Settings → Connectors.

The Gmail connection can send messages and create, rename, and delete labels. It cannot read, search, draft, or change existing messages: those calls fail with an insufficient-permission error. To read or search the user's Gmail, use the `mail_accounts`, `mail_search`, `mail_read`, and `mail_update` tools when `mail_accounts` lists the Gmail address. Otherwise tell the user to add Gmail as an email account in Settings → Connectors → Email with a Google app password.

Search and read relevant messages before preparing a reply, and keep the thread and message identifiers from those results. Send only the content the user asked for, preserving the recipients and attachments they supplied; honor tool approvals. Report only results the tools returned.
