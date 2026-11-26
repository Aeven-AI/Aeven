# Agent Note: cloud usage reports waited for a page to renew its token

Status: implemented

English | [中文](2026-11-26-cloud-meter-presents-a-stored-refresh-token.zh.md)

## Problem

On 2026-11-26 the hosted Host logged `cloud usage reports of <owner> wait: the Aeven API answered 401` once a minute for seven accounts since 2026-11-14, up to 1,440 times a day per account. The API logged 7,988 `cloud.meter.charge_failed` lines with `the Æven credential is invalid or expired` since 2026-11-20. `cloud-meter` presented `AEVEN_TOKEN`, and on a hosted Host that reference resolves only to the access token the connection publishes from the account's last request. The access token expires two hours after the page last renewed it, so once an account had no page open, its sandbox and storage reports queued in memory until the account returned. A restart dropped them, and a funding quote answered by a 401 admitted the account's cloud work.

Separately, storage was rarely billed for four accounts. `du -sk` exits 1 when it cannot enter a directory, and confined commands create `0700` directories owned by `aeven-sandbox`, such as `mkdtemp` folders under `chats/.aeven-previews` and `chats/.cache/libreoffice-kit`. The meter treated that exit as a failed measurement and queued no storage report, so one 3.8 GB account was billed for storage on one day since 2026-11-11.

## Decision

- `UserResolver.unattendedCredential` lets an authority declare a long-lived credential it reads from a request. `identity-user-aeven` reads the `refreshToken` cookie under `unattendedCredentialRef` (`AEVEN_REFRESH_TOKEN`) when it verifies as the same user as the request.
- On a credential provider with account storage, the connection stores that credential in the caller's account credential file whenever its value changes. A Host without account storage stores nothing, because its credential file is shared by every caller.
- `cloud-meter` takes `credentialRefs` in place of `credentialRef` and presents each in order until the API stops answering 401. The hosted bundle states `[AEVEN_REFRESH_TOKEN, AEVEN_TOKEN]`. The API accepts a refresh token as the bearer of `/api/cloud/meter` while the account has any live session (`INFERENCE_ALLOW_REFRESH_CREDENTIAL`, `sessionMatch: any`), so a token the browser has since rotated still works.
- `cloud-meter` takes the total `du` prints when it exits 1, leaving the unreadable directories out of the figure.

## Alternatives considered

- **Let the Host renew the access token.** Rejected: `/refresh-token` rotates the refresh token and refuses the one it replaced, so a Host exchange would sign the browser out.
- **Publish the refresh token as `AEVEN_TOKEN`.** Rejected: the other consumers of that reference call endpoints that accept only access tokens, and the session-credential handoff to the account's desktop would carry a year-long token.
- **Persist the report queue.** Deferred: with a credential that outlives the page, reports wait only while the API is unreachable or the account has signed out everywhere.
- **Measure storage as the jail user.** Rejected: the Host user cannot switch users, and the unreadable directories are temporary folders and caches.

## Consequences

A hosted account's credential file holds its refresh token from its first request after this change. The file is mode `0600` under the Host's private account folder, is left out of account exports, and is removed when the account is erased. A sign-out does not remove it; the API refuses it while the account has no live session. Model requests through `llm-aeven` still present only `AEVEN_TOKEN`.
