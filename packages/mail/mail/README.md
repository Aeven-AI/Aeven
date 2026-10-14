---
description: "The mail capability service (ctx.mail): account sources, owner-scoped IMAP/POP3/SMTP operations, limits, and failure categories."
kind: "package-reference"
---

# @aeven/mail

English | [中文](README.zh.md)

## Summary

`@aeven/mail` registers `ctx.mail`, which runs mail operations for one owner's accounts: list accounts and folders, search envelopes, read a message, read an attachment, change message state, send or save a draft, and probe new account settings. Accounts come from registered `MailAccountSource`s; every operation resolves the named account address against the sources for the given owner before a socket opens, so a missing, disabled, removed, or foreign account is refused here rather than by tool visibility. Providers use maintained libraries — `imapflow`, `node-pop3`, `nodemailer`, and `mailparser` — and nothing is cached beyond one pooled IMAP connection per account.

## Table of Contents

- [Use this package](#use-this-package)
- [Behavior](#behavior)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

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

### Account refusals

#### What the model sees

This service renders no prompt or tool text of its own; the model reads its results and errors through [`@aeven/tool-mail`](../tool-mail/README.md), which owns the tool schemas and the result text. Every operation resolves the named account address against the sources of the calling owner's accounts before a socket opens, so a missing, disabled, removed, or foreign account is refused here rather than by tool visibility. The model then reads one of `No mail account is connected. Add one in Settings → Connectors → Email.`, `No connected mail account is ${address}. Connected accounts: ${known}.`, `More than one connected account uses ${address}.`, or `This account was removed. Add it again in Settings.`, passed on verbatim by the calling tool.

#### Token effect

A refused call adds one of these fixed sentences to the transcript and no result body; it stays until compaction.

#### KV Cache effect

Append-only; the sentence arrives as a tool result after the reusable request prefix.

### Failure messages

#### What the model sees

A failure this service raises or re-raises is a `MailError` carrying one fixed sentence and a category code, and the calling tool returns the sentence verbatim. Server response text is discarded, because it can echo credentials or message content, so the model never reads it. The fixed sentences include `The incoming mail server rejected the username or password.`, `The incoming mail server could not be reached. Check the host, port, and security setting.`, `A secure connection to the outgoing mail server could not be verified. Check the host name and security setting.`, `The folder does not exist.`, `The outgoing mail server rejected the sender or every recipient.`, `The message is ${size} bytes, above the ${max}-byte limit.`, `This account has no archive folder; move the messages to a folder instead.`, `This account has no trash folder; use delete instead.`, `This account has no Drafts folder.`, `POP3 accounts support delete only; they have no flags or folders.`, `POP3 accounts have only the INBOX folder.`, `${from} is not an address of this account. Use ${addresses}.`, and `This account reached its limit of ${sendsPerHour} messages per hour.` An authentication failure also calls the source's `authenticationFailed`, and the source stops listing the account until it is replaced.

#### Token effect

Only a failing call adds one of these sentences, once per call, retained until compaction.

#### KV Cache effect

Append-only; the sentence arrives as a tool result after the reusable request prefix.

### Result bounds

#### What the model sees

A search returns at most `searchMaxResults` newest-first envelopes and a `truncated` flag; a search across every account adds one `${account} could not be searched: ${error}` line per account that failed, and fails as a whole only when every account failed. A read returns the headers and at most `bodyMaxChars` characters of plain-text body with a `truncated` flag, and its attachment list carries index, name, content type, and size. A message above `messageMaxBytes` is refused instead of returned, and a POP3 search reads the newest `pop3ScanLimit` headers only.

#### Token effect

These are the per-call ceilings on what the tool can put in the transcript: `searchMaxResults` envelopes, `bodyMaxChars` body characters, `pop3ScanLimit` scanned headers. The service adds no text of its own beyond the fixed notices above.

#### KV Cache effect

Append-only; each result is a tool result after the reusable request prefix.

## Known Limitations and Deferred Work

- Password and app-password authentication only; XOAUTH2 for Gmail and Outlook is deferred.
- Sent messages are not appended to the Sent folder; most hosted providers save submitted mail themselves.
- No server autodiscovery or IMAP IDLE notifications.
- The send rate window is held in memory and resets when the plugin restarts.
- **No invariant companion** — No runtime invariant companion is published because the mutable state this service owns — the source registry, the pooled IMAP connection per account, and the rolling send window — is written only by the operations that read it, so a listener would repeat the call it claims to verify; what the service promises is the socket conversation with each mail server, which no in-process observation replaces.

### Dev Note

None.
