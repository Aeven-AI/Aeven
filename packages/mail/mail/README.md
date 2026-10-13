---
description: "The mail capability service (ctx.mail): account sources, owner-scoped IMAP/POP3/SMTP operations, limits, and failure categories."
kind: "package-reference"
---

# @aeven/mail

## Summary

`@aeven/mail` registers `ctx.mail`, which runs mail operations for one owner's accounts: list accounts and folders, search envelopes, read a message, read an attachment, change message state, send or save a draft, and probe new account settings. Accounts come from registered `MailAccountSource`s; every operation resolves the named account address against the sources for the given owner before a socket opens, so a missing, disabled, removed, or foreign account is refused here rather than by tool visibility. Providers use maintained libraries — `imapflow`, `node-pop3`, `nodemailer`, and `mailparser` — and nothing is cached beyond one pooled IMAP connection per account.

## Use this package

Mount the service in the host composition and register an account source; `@aeven/host-account-integrations` does so for Email connectors.

```yaml
- name: '@aeven/mail'
```

| Field | Default | Meaning |
|---|---|---|
| `timeoutMs` | `30000` | TCP, TLS, and greeting budget per connection |
| `socketTimeoutMs` | `120000` | Socket inactivity budget |
| `idleTimeoutMs` | `300000` | How long an unused IMAP connection stays open |
| `searchMaxResults` | `50` | Upper bound on envelopes one search returns |
| `bodyMaxChars` | `20000` | Upper bound on body characters one read returns |
| `messageMaxBytes` | `26214400` | Largest message read or attachment saved |
| `pop3ScanLimit` | `200` | Newest POP3 messages whose headers one search reads |
| `sendsPerHour` | `30` | Messages one account may send per rolling hour |

## Behavior

- **Security.** Bindings use implicit TLS or mandatory STARTTLS; certificates are always verified and plaintext authentication is never offered. POP3 supports implicit TLS only.
- **Errors.** Failures are `MailError`s with a fixed message per category (`MAIL_AUTHENTICATION`, `MAIL_CONNECTION`, `MAIL_TLS`, `MAIL_LIMIT`, …). Server response text is discarded because it can echo credentials or message content. An authentication failure calls the source's `authenticationFailed`, and the source stops listing the account until it is replaced.
- **IMAP.** Search reads envelopes only, newest first, within `searchMaxResults`; reading fetches the source without setting `\Seen`. Archive, trash, and drafts resolve RFC 6154 special-use folders and are refused when the server has none.
- **POP3.** The mailbox is `INBOX` only. Search scans the newest `pop3ScanLimit` headers and supports from, to, subject, since, and before; `delete` is the only update and commits at QUIT. Drafts are refused.
- **SMTP.** The sender must be the account address or an alias. A reply sets `In-Reply-To` and `References` from the original message and defaults the subject to `Re: …`. Sends beyond `sendsPerHour` are refused.
- **Probe.** `probe(settings, secret)` connects, authenticates, and lists folders on the receive server, then connects and authenticates on the send server; the thrown `MailError.step` names the failed step.

## Model Experience

This package renders nothing for the model; [`@aeven/tool-mail`](../tool-mail/README.md) owns the tool schemas and result text. Its error messages reach the model verbatim through those tools.

## Known Limitations and Deferred Work

- Password and app-password authentication only; XOAUTH2 for Gmail and Outlook is deferred.
- Sent messages are not appended to the Sent folder; most hosted providers save submitted mail themselves.
- No server autodiscovery or IMAP IDLE notifications.
- The send rate window is held in memory and resets when the plugin restarts.
