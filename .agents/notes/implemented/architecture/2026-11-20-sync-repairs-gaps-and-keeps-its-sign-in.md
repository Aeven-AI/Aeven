# Agent Note: Sync repairs copies stuck behind a lost update and keeps its sign-in until sign-out

Status: implemented

English | [中文](2026-11-20-sync-repairs-gaps-and-keeps-its-sign-in.zh.md)

## Problem

A desktop never showed a bot the cloud Host had created, nor three removals the cloud Host made on 11 and 19 November, while the desktop's own changes reached the cloud Host. The desktop's copy of the account's `automations` document held the cloud Host's later updates as Yjs pending structs: they built on an update the desktop never received. Two mechanisms made that permanent:

- `SyncStore.isNewCounter` is a high-water mark. A frame whose sender counter is not above the highest one seen from that sender was dropped as a replay, even when it arrived late, after a later frame over a local-network link or within a relay backlog, and its content was never applied.
- A snapshot's `covers` makes the relay delete every frame of the document up to that sequence number, other devices' frames included. A copy with a gap still snapshots, so the relay deleted the frame that carried the missing update, and only its writer held it.

Separately, sync authenticated with the access token a client last presented to the Host, an in-memory session value. Access tokens are short-lived while the sign-in rests on a year-long refresh cookie, so the app stayed signed in while the relay refused the token every five seconds, logged only at debug level. A Host with `keepConnected` held a sync grant for this case, but a resolvable, refused token always took precedence over it.

## Decision

- A frame at or below the high-water mark is applied when its update reaches past the stored copy's state vector (`addsTo`); a recent-counter memory skips true duplicates without the check. Fragmented late frames stay dropped and rely on repair.
- Maintenance reports each writer's first missing clock (`compactWithMissing`) and queues no snapshot while any is missing.
- A copy with missing clocks writes `{ doc, device, missing, at }` to the account's `sync/repair` document and removes it once complete. Every device that stores the document answers each request once by running the `docs.get` comparison that `reconcileOnce` runs once per store, which publishes whatever the relay's copy lacks. The writer of the lost update always holds it, so the copy heals without relay changes.
- The relay (servers/node `fix/sync-grant-bound-to-session`) binds a grant to the sign-in session behind the access token that requested it and redeems it only while that session exists. Logout deletes the session, so signing out ends the grant and nothing else does.
- Every Host takes a grant, not only one with `keepConnected`, which now only marks an always-on Host. A refused access token is never presented again; the grant is the fallback; with no usable credential the status carries `error: 'sign-in'`, shown in Settings → Sync.

## Alternatives considered

- **Replace the high-water mark with a set of seen counters.** Rejected: the set grows without bound per sender and document, and content comparison answers the actual question.
- **Have the stuck device fetch the document's frames again.** Insufficient alone: the frame it needs can be deleted from the relay; only a device holding the update can supply it.
- **Refresh the access token on the Host from the mirrored refresh cookie.** Deferred: the grant already gives the Host a credential that only sign-out ends.

## Consequences

- A gap heals once the stuck device and one device holding the missing update run this build; the relay change must deploy before Hosts take grants, or a grant issued by the old relay is not bound to a session.
- Grants issued before this change carry no session and are honored until they expire or are revoked.
- A copy that is never opened or maintained does not notice its gap until either happens.
