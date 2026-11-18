# Agent Note: the other devices refused a device's updates after its counters restarted

Status: implemented

English | [中文](2026-11-18-refused-sync-frames-and-lost-index-entries.zh.md)

## Problem

On 2026-11-18 a Mac held conversations the hosted Host did not list, and the Host held older copies of conversations the Mac had continued. The Mac's sender counter for the session index was 162 while the Host had accepted counter 84,489 from the same device id: the Mac's store had dropped and taken back the same account key, and the wipe that comes with dropping a key deleted the `counters` table. Document ids derive from the key, so they stayed the same; every document update the Mac sent afterwards (session index entries, forwarded input, workspaces) failed every other device's replay check. A snapshot from the Host later made the relay delete those frames, so only the Mac still held them. Stream batches carry no counter check, so conversation bodies reached the relay.

The session index also lost entries in two ways a counter does not explain. Ten conversations were stored on the Mac as copies that no index entry listed, and a copy is never published. Three conversations held events past their index entry on a copy: the settle pass skipped a settled copy, so a tail written before a release finished publishing stayed local, and an entry left behind the stream never rose.

## Decision

- A sender counter is one past the stored counter and never below the current time in microseconds (`counterFloor`), on the Host and on the sync worker. Dropping the account key keeps counters.
- Once per store, after catch-up, the vault compares each document it wrote with the relay's copy and publishes what the other devices never received (`missingFrom`). The relay's copy is the other devices' frames, plus this device's own frames when no other device snapshotted the document, up to the first own frame whose counter does not exceed an earlier one.
- The session settle pass publishes a copy the index does not list from its start, publishes the tail of a copy whose stored log runs past its entry, and raises an entry behind the stream head. History publication republishes a conversation the index does not list even at a recorded revision.

## Alternatives considered

- **Snapshot every written document once.** Rejected: the hosted Host would resend about 500 MB for 3,665 documents it never lost.
- **Fetch refused frames from the relay on the receiving side.** Rejected: the relay deleted them once a snapshot covered them.
- **Pick the devices to repair by key mode.** Rejected: hosted accounts use passkey mode too.

## Consequences

The first connection after the update downloads the relay's copy of each document the device wrote; the hosted Host reads it from the relay on the same machine. A device whose own frames before a restart were pruned while refused ones remain counts the refused ones as received when no other device snapshotted the document; that document heals at its next snapshot. The conversation `c5caed39`, whose index lists 18,466 events while both devices store one, is not explained by this change.
