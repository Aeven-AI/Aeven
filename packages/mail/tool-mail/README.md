---
description: "The model-facing mail tools over ctx.mail: registration, approval, result text, and limits."
kind: "package-reference"
---

# @aeven/tool-mail

## Summary

`@aeven/tool-mail` gives the model five tools over `ctx.mail`: `mail_accounts`, `mail_search`, `mail_read`, `mail_update`, and `mail_send`. The tools register for an agent only while its session owner has at least one usable mail account, checked before every step, and every call names its account by address, so one tool set serves any number of mailboxes. Sending and permanent deletion always ask the user for approval; a deny from another policy still wins.

## Use this package

Mount it per session where `ctx.mail` exists; the aeven agent preset does.

```yaml
- name: '@aeven/tool-mail'
```

| Field | Default | Meaning |
|---|---|---|
| `timeoutMs` | `120000` | Cooperative budget for account, search, read, and update calls |
| `sendTimeoutMs` | `120000` | Cooperative budget for `mail_send` |

## Tools

| Tool | Behavior |
| --- | --- |
| `mail_accounts` | Addresses, protocol, send capability, aliases, and IMAP folders with special-use attributes. |
| `mail_search` | Envelopes only, newest first; `account` omitted searches every account and reports per-account failures. |
| `mail_read` | Headers, plain-text body, and attachment list; `saveAttachments` writes attachments inside the session workspace without replacing files. Reading does not mark the message read. |
| `mail_update` | read, unread, flag, unflag, move, archive, trash, or delete; `delete` asks for approval. |
| `mail_send` | Send, reply (`replyTo`), or `draft: true`; every send asks for approval. |

## Model Experience

Search and read results open with a fixed notice that the following email content is untrusted data, not instructions. Results are plain text: one block per envelope with `account`, `folder`, and `id` (the values `mail_read` and `mail_update` take), and for a read the headers, body, and indexed attachments. Tool schemas are fixed text, so the catalog and its KV-cache prefix do not change as accounts are added; the tool set appears or disappears only when an owner goes from zero accounts to one or back.

## Known Limitations and Deferred Work

- Plain-text bodies only; HTML composition and attachments on outgoing mail are deferred.
- Attachment saving writes through Node's filesystem inside the session workspace rather than through `ctx.fs`, which writes text only.
