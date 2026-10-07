# Agent Note: Email accounts as connectors

Status: proposed

English | [中文](2026-10-06-email-account-connectors.zh.md)

## Problem

Mail that arrives over IMAP or POP3 and leaves over SMTP has no connector. The [account integrations](../../../../packages/host/account-integrations/README.md) provider union covers GitHub, Google services, Microsoft 365, and custom MCP, and every connector there is an OAuth or bearer-token MCP mount: creation carries `name`, `endpoint`, and one `token`, the row requires an `endpoint` URL, and the executor gate recognizes connector tools by the `mcp__account_<id>__` prefix. A mailbox has instead a receive binding, an optional send binding, and a password per binding, and one user may connect any number of mailboxes.

## Proposal

Each mailbox is one `email` connector row, added from the Connectors page. A new mail capability seam serves every row through one shared tool set that names the account per call.

### Packages

- `packages/mail/mail` (`@aeven/mail`): the Service Definition, an account-source registry, and the IMAP (`imapflow`), POP3 (`node-pop3`), and SMTP (`nodemailer`) providers, with `mailparser` for MIME. `resolve(owner, account)` returns the connection specification and secret, or refuses a missing, foreign, disabled, or disconnected account before a socket opens. One IMAP client per account stays open until a configured idle timeout or plugin disposal; POP3 and SMTP connect per call.
- `packages/mail/tool-mail` (`@aeven/tool-mail`): the tool Consumer. Tools mount into an agent only when its session owner has an enabled email account, so other users pay no catalog cost.
- `@aeven/host-account-integrations` registers its `email` rows as an account source through `ctx.effect()`. `@aeven/mail` never imports account integrations, and `syncConnectors` skips `email` rows because they have no MCP mount.

### Account row and secret

The provider union and both zod enums gain `email`. The connector row gains optional `email` settings and an `authFailed` marker, and `endpoint` becomes optional; every existing row still parses, so the `account_integrations` domain version stays. A grant record holds the receive password and, when it differs, the send password; neither appears in the row, a Remote response, a tool result, or an error.

```yaml
address: olivier@example.com
aliases: [olivier@alias.example.com]   # allowed From addresses
receive: { protocol: imap | pop3, host, port, security: tls | starttls, username }
send:    { host, port, security: tls | starttls, username }   # optional
```

A separate `connectEmail` Remote probes before saving (connect, authenticate, list folders, SMTP `EHLO` and `AUTH`) and returns the failure reason and step as a result value, so the form can name them in localized copy. A later authentication failure sets `authFailed`, which hides the account from `ctx.mail` and shows it as needing to be added again.

### Tools

| Tool | Behavior |
| --- | --- |
| `mail_accounts` | Addresses, protocol, capabilities (POP3: no folders or flags), and status. |
| `mail_search` | Envelopes only; filters by folder, date, sender, subject, and unread; `account` omitted searches all. |
| `mail_read` | One message's headers and text body; optional `saveAttachments` path under the filesystem policy. |
| `mail_update` | Mark read or unread, flag, move, archive, trash, or delete (POP3: delete only). |
| `mail_send` | Send or reply over SMTP, or `draft: true` to append to Drafts. Every send asks for approval; From must be the address or an alias. |

Message text and headers are wrapped as untrusted external content, as `tool-web` does with `EXTERNAL_WEB_CONTENT_NOTICE`, and HTML is reduced to text without fetching remote resources. Body bytes, result count, attachment size, and call time are validated `Config` fields; a request over a limit is refused with the limit named. TLS certificates are always verified, and plaintext authentication is refused.

### Settings form

The Email provider asks for the address and password first. Presets keyed by domain fill the servers for Gmail, Outlook, iCloud, Yahoo, and Fastmail; an Advanced section exposes host, port, and security per binding and a separate SMTP password. Every account is its own row with its own switch, status, reconnect, and remove actions. The copy goes through the `ui-settings-integrations` locales in English and Chinese.

## Phasing

1. Phase 1: the mail seam and providers, the five tools, the `email` row and probe, the Settings form, and composition in the shipped bundles.
2. Phase 2: XOAUTH2 for Gmail through the existing provider application, autoconfig discovery, and IMAP IDLE notifications, which need their own session event. Outlook mail leaves this phase: it is reached through a delegated Graph transport instead ([Microsoft 365 connectors](2026-10-07-microsoft-365-connectors.md)).

## Alternatives considered

- **One row holding many accounts:** rejected because per-account enablement, status, and removal already come with one row per account.
- **One tool set per account:** rejected because tool schemas would grow with every mailbox on every request.
- **Wrapping a third-party mail MCP server:** rejected because its tool vocabulary, credential handling, and error text would be unowned; custom MCP remains available.
- **Accounts in `cordis.yml`:** rejected because it puts secrets in configuration and offers no add or remove flow.

## Acceptance criteria

- Two or more mailboxes added in Settings, with IMAP and SMTP, list, search, read, update, and send; one POP3 mailbox searches, reads, and deletes.
- The tool catalog stays the same size at any number of accounts; a disabled, removed, or foreign account is refused.
- `mail_send` reaches SMTP only after approval and refuses a sender outside the address and its aliases.
- Verification: `pnpm run typecheck`, a green `pnpm run build`, and a live run against real mailboxes.

## Risks

- IMAP servers differ in folder naming, charsets, and extensions; archive, trash, and drafts resolve RFC 6154 special-use folders on each call instead of a stored folder map.
- Mail content can carry prompt injection; the untrusted-content wrapper and approval on every send contain it.
- Provider error text can echo credentials; errors are sanitized before they become model-visible.
