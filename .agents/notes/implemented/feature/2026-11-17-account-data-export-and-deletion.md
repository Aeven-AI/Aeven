# Agent Note: account data export and deletion

Status: implemented

English | [中文](2026-11-17-account-data-export-and-deletion.zh.md)

## Problem

A person had no way to take a copy of their Aeven data or to delete their account, both of which the GDPR requires (articles 15, 17 and 20). Their data is spread over the Aeven API (account, plan, wallet, usage, connectors, sync relay, file cloud) and over every Host that served them: session logs, attachments, memories, recordings, preferences, the Aeven folder, connector stores.

## Decision

Settings → Account ends with a "Your data" group: Export data, then Delete account as the page's last row. Each row has a one-line description and a question icon that opens the longer explanation.

**Export.** `@aeven/host-account-data` streams a zip from `GET /api/account-data/export` on the Host the page talks to: the desktop Host for the desktop app, the hosted Host for Aeven Web. The response starts at once and the archive is written as it is read, so a local export begins in milliseconds whatever its size; on 2026-11-17 a 1.8 GB export of a real account (1,292 chats, 3,711 attachments, 45,561 memories) streamed in 41 seconds with the Host's heap flat. Each plugin that keeps per-account data registers an `AccountDataSource` that exports and erases one account. The Aeven API's copy comes from `GET /api/account/export` with the user's own token. Passwords, tokens and key material never enter the export.

**Deletion.** `POST /api/account/delete` on the Aeven API needs the account's email typed again and, with two-factor protection on, an authenticator or recovery code. It disables the account at once: every session is signed out, a live plan is set to end at its period end, and every API except `/api/account` refuses the account. Signing in during the 30-day grace period shows only a restore screen; restoring resumes the plan. After the grace period an hourly job purges the account and every record keyed to it, cancels the plan immediately, removes file cloud and upload files, and leaves a tombstone holding only `sha256(userId)`. Hosts name each account's home directory by that digest, so each Host asks `POST /api/account/deleted` about the accounts it holds and erases the purged ones.

**Hosted limits.** Each account streams one export at a time. The hosted bundle allows two exports at once across accounts, each capped at 25 MB/s; the export holds one chunk and at most one chat log in memory.

## Alternatives considered

- **Immediate deletion.** The owner chose a 30-day grace period with restore by signing in.
- **A server-built export, mailed as a link.** Rejected: the readable data lives on the devices, the server holds only encrypted sync frames, and the owner wanted the download to start immediately.
- **fflate's streaming `Zip`.** Rejected: it writes no ZIP64, and a real account passes 4 GiB. `yazl` streams with backpressure and switches to ZIP64 on its own.
- **One generic storage-unit source.** Rejected: storage domains are opened per plugin with typed specs, so each owning plugin registers its own source.

## Consequences

Remaining purchased credit is forfeited at deletion, which the dialog states; Stripe keeps payment records. A Host that never comes online again keeps that account's local data. Session recovery copies are not attributed to an account and stay.
