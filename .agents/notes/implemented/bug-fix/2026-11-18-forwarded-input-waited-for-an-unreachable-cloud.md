# Agent Note: a desktop's input waited for an Æven Cloud that could not reach the account

Status: implemented

English | [中文](2026-11-18-forwarded-input-waited-for-an-unreachable-cloud.zh.md)

## Problem

On 2026-11-18 a desktop user's messages in one conversation showed "Ævening…" with no stop button and were gone after a refresh. The relay showed the desktop enqueuing them in the synced inbox at 07:38:26 and 07:51:45, addressed to the hosted Host. That Host had not synced the account since 2026-11-16 (the account key is passkey-protected, and the Host held no grant), so it never saw them. It took all queued inputs at 07:53:31, 1.6 seconds after the user opened Aeven Web and the Host received a grant.

Two rules produced the wait. `homeOf` kept a conversation on the always-on device whenever that device ran its latest turn, without asking whether it could reach the account. `consumePass` never let the typing desktop run an input it had forwarded while the account had an always-on device, with no timeout and no expiry.

## Decision

- The always-on device stamps `seenAt` on its device entry every `presenceMs` too, which it can do only while it holds the account key and a relay connection.
- `homeOf` keeps a conversation on the always-on writer only while that stamp is within `presenceWindowMs`; otherwise the desktop runs the conversation itself.
- The device an input was typed on runs it after `remoteFallbackMs` (10 seconds) when the device it was sent to has not taken it, whether or not the account has an always-on device. The runner lease arbitrates a late take by the target.

## Alternatives considered

- **Expire forwarded inputs.** Rejected: the message would still not run, only disappear later.
- **Run every desktop input locally.** Rejected: a conversation the cloud runs keeps its files and background jobs there.

## Consequences

The always-on device writes one presence update per account per `presenceMs`. Desktops on builds before this change still forward to the always-on device without checking its stamp. A forwarded input is still kept only in the synced inbox, so the client cannot show it after a refresh; showing waiting inputs is separate work.
