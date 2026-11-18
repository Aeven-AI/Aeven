# Agent Note: input typed on a desktop runs on that desktop

Status: implemented

English | [中文](2026-11-18-forwarded-input-waited-for-an-unreachable-cloud.zh.md)

## Problem

On 2026-11-18 a desktop user's messages in one conversation showed "Ævening…" with no stop button and were gone after a refresh. The relay showed the desktop enqueuing them in the synced inbox at 07:38:26 and 07:51:45, addressed to the hosted Host. That Host had not synced the account since 2026-11-16 (the account key is passkey-protected, and the Host held no grant), so it never saw them. It took all queued inputs at 07:53:31, 1.6 seconds after the user opened Aeven Web and the Host received a grant.

Two rules produced the wait. `homeOf` kept a conversation on the always-on device whenever that device ran its latest turn (a rule of 2026-11-10, so the cloud kept a conversation with its files and background jobs); the desktop-first routing of the same day covered only input typed on Aeven Web. `consumePass` never let the typing desktop run an input it had forwarded while the account had an always-on device, with no timeout and no expiry.

## Decision

- Input typed on a desktop runs on that desktop. On a desktop, `homeOf` no longer names the always-on writer; the desktop takes the conversation over. It still names another desktop the conversation was moved to while that desktop is present, and input for a turn running on another device still goes to its runner.
- The device an input was typed on runs it after `remoteFallbackMs` (10 seconds) when the device it was sent to has not taken it, whether or not the account has an always-on device. The runner lease arbitrates a late take by the target.

## Alternatives considered

- **Keep the cloud's conversations on the cloud while it can reach the account.** Rejected by the owner: typing on the desktop runs there.
- **Expire forwarded inputs.** Rejected: the message would still not run, only disappear later.

## Consequences

A conversation whose turns used files that exist only in the account's cloud folder runs on the desktop without them until they sync. Desktops on builds before this change still forward to the always-on device. A turn that loses its device mid-run is separate work.
