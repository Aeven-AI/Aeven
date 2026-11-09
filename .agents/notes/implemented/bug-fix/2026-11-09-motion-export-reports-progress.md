# Agent Note: A motion export reports its progress and reuses an unchanged film

Status: implemented

English | [中文](2026-11-09-motion-export-reports-progress.zh.md)

## Problem

Exporting a film to MP4 from the Motion card showed only a busy button until the file arrived. The 100 s film of session `04b4db03` takes about 37 s to render on an M-series Mac at every quality tier (draft 36 s, standard 36 s, high 37 s, measured on that film), and an export queued behind the agent's own review renders waited longer still, so the export looked broken. The folder export was also one long request, and every export rendered the whole film again even when nothing had changed.

## Decision

- **Both export routes report progress.** [`avn-api-motion`](../../../../packages/motion/api-motion/README.md) runs one render per folder or call; each request waits at most `exportWaitMs` (now 1500 ms) and otherwise answers 202 with `{ fraction, queued }`. The card polls and shows "Exporting MP4… n%", "Exporting MP4…" while a renderer has reported nothing, or "Waiting for another render to finish…".
- **A render behind another one says so.** `ctx.motion` names a `MOTION_QUEUED_STAGE`, which the HyperFrames renderer reports while a render waits its turn.
- **An unchanged film is not rendered again.** `ctx.motion` records each render's quality and modification time in a sidecar beside it (`recordRender`, `currentRender`). An export returns the last export, else the agent's last `review_motion` render copied into place, while its sidecar matches the export quality and no file outside `renders/` is newer. `review_motion` renders at `reviewQuality` (default `high`, the export quality), so the review the agent makes before showing a film is the export the user then asks for.
- **The export quality stays `high`**, since it costs no measurable time over `draft` on that film.

## Alternatives considered

**Lowering the export quality** was rejected: the three tiers rendered the same film within a second of each other. **Keeping draft reviews** was rejected for the same reason: a draft review could not stand in for the export, and it saved no time. **Letting a user export jump ahead of queued agent renders** was deferred: a running render cannot be preempted, and the queued state now tells the user why the export waits. **Streaming progress over a server-sent event** was rejected for the existing 202 polling, which the call export already used and which stays inside a proxy's read timeout.

## Consequences

The sandboxed renderer on hosted reports no progress, so there the card shows "Exporting MP4…" without a number. A folder edited only inside `renders/` reuses its export. The freshness walk stops after 10,000 entries and then renders again.
