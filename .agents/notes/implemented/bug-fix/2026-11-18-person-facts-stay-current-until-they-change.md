# Agent Note: person facts stay current until they change

Status: implemented

English | [中文](2026-11-18-person-facts-stay-current-until-they-change.zh.md)

## Problem

On 2026-11-18 two turns of one desktop conversation went without recalled memory: "recall did not finish within 5000ms". Both came after idle time, and the recall judgment audit holds no row for either, so retrieval itself ran past the deadline. Each turn reads the profile alongside recall on the account's one memory core worker, and the profile's person-memory listing expired after `profile.refreshMs` (10 minutes). An expired listing made the read wait for a new one, 1,253 facts listed page by page on the same worker as the recall's search. Measured on the dev Host, recall took 436 ms alone and 2,154 ms beside that listing; on a Mac swapping 8 GB, retrieval after idle took about 3 s more.

## Decision

- A listing stays current until the owner's person memories change. A captured turn, a remembered memory, or another device's `traces` rows mark it stale; a read then serves it at once, and it is listed again in the background after the owner's turn-start recalls settle.
- An edit or forget still drops the listing, and the next read waits for a new one, so a changed or forgotten memory is never served.
- `profile.refreshMs` no longer bounds the listing; it keeps bounding how often the distilled profile checks for newer memories.

## Alternatives considered

- **A longer TTL.** Rejected: facts about a person do not age, and any expiry still makes some turn wait.
- **Serve the expired listing and list again at once.** Rejected: the listing would still run beside that turn's recall.
- **Raise `recallTimeoutMs`.** Deferred: it hides the stall instead of removing it.

## Consequences

A memory learned in one turn reaches the profile once its background listing finishes, usually before the next turn. Retrieval after idle on a swapping Mac stays slower than warm retrieval; that is separate work.
