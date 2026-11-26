# Agent Note: every device uploaded its own snapshot of the same document

Status: implemented

English | [中文](2026-11-26-one-device-snapshots-a-synced-document.zh.md)

## Problem

On 2026-11-26 a document two devices rewrote in turn (see [one holder describes a synced repository](2026-11-26-one-holder-describes-a-synced-repository.md)) reached 4.7 MB, and the desktop Host's relay connection carried 395 MB in and 200 MB out within 48 minutes. Four properties of `AccountVault` turned one rewritten document into that traffic, and none of them reported it.

- Every device counted the frames of a document since its last snapshot, received frames included, so all devices passed `snapshotAfter` at the same frame and each uploaded the whole document, which the relay then sent to every other device.
- A received snapshot counted as one more frame and did not reset the receiver's count.
- The count resets when the sync worker seals the snapshot. Each update stored before that queued another snapshot of the same document.
- Nothing logged that one document took about 7 updates a second for days.

## Decision

- A device queues a snapshot when its own update passes `snapshotAfter`. Received frames queue one only past `RECEIVER_SNAPSHOT_FACTOR` (2) times that count, which keeps the relay's backlog bounded when the writer cannot snapshot, as while its copy waits for a missing update.
- A snapshot from another device resets this device's count; frames after it in the same batch count from zero.
- A document with a snapshot queued queues no second one until the first is sealed.
- A document that takes more than `churnUpdates` (default 10 000) updates within `churnWindowMs` (default one hour) is reported once per window through the vault's warning sink, by its logical name when a Consumer named it in this run and by its opaque id otherwise. The loop above ran at about 25 000 updates an hour.

## Alternatives considered

- **Snapshot less often for large documents.** Rejected: a device that joins would replay more frames of exactly the documents that are slowest to open.
- **Pick the snapshotting device by a lease on the relay.** Rejected: the writer's own update already singles out one device without a round trip.

## Consequences

A document that only receiving devices hold complete snapshots after twice `snapshotAfter` frames instead of once. The warning does not stop a writer; it names the document so the loop is found in the first hour.
