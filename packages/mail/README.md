---
description: "Package map for the mail capability family: the IMAP/POP3/SMTP service and the model-facing mail tools."
kind: "package-group"
---

# mail/ — mail capability family

## Summary

The `mail/` group gives agents access to a user's own mailboxes over IMAP or POP3 for receiving and SMTP for sending. Accounts are not configured here: an account source registered on `ctx.mail` supplies them per signed-in owner, and [account integrations](../host/account-integrations/README.md) is that source for Email connectors added in Settings. One tool set serves every account, so the model's tool catalog stays the same size at any number of mailboxes. The plan and rejected alternatives live in the [email account connectors Agent Note](../../.agents/notes/proposed/feature/2026-10-06-email-account-connectors.md).

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`mail/`](mail/README.md) | Account-source registry plus IMAP, POP3, and SMTP providers | `ctx.mail` |
| [`tool-mail/`](tool-mail/README.md) | `mail_accounts`, `mail_search`, `mail_read`, `mail_update`, `mail_send` | — |
