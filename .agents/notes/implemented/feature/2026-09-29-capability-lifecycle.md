# Agent Note: Capability lifecycle

Status: implemented

## Problem

A confirmed capability is trusted instructions for every later session of its user. Procedures go stale: a tool changes, a machine differs, or the procedure was never right. Trust has to follow what happens when the capability runs, without a model-generated confidence number deciding anything.

## Decision

`@aeven/capability` keeps every revision's procedure (`versions/<revision>.md`) and an append-only evidence log (`executions.jsonl`) per capability. `@aeven/tool-capability` records one execution for each turn that loaded a confirmed capability: revision, model route, environment, tools called after the load, provider retries, tokens, turn end reason, and the model's `report` (outcome and verification). A direct-user correction in the next turn and a rating on the turn's reply are appended as amendments.

A deterministic policy judges each execution and derives the status after every write:

- **Verdicts.** A correction, a negative rating, a failed report or verification, or a failed turn fails an execution. A positive rating verifies it, and so does a reported passed verification together with a successful tool call; a report alone is never verification.
- **Statuses.** Only the user makes a capability executable or retires it. Among executable statuses, `trusted` needs `trustAfter` successes of the current revision with at least one verified and no failure last; `degraded` follows `degradeAfter` consecutive failures; `needs-validation` holds after a trusted procedure changes until a verified run of the new revision exists; otherwise `learned`.
- **Model view.** Trusted and learned capabilities load unchanged. Degraded, needs-validation, and capabilities that never succeeded in the current environment load with a short evidence note asking the model to verify and report.

## Consequences

- A browser run took `check-node-toolchain` from learned to trusted after three verified runs, back to learned after one correction, and to needs-validation after a confirmed edit; a new session loaded it with the validation note, ran the new step, and asked the user before touching the environment.
- Corrections are recognized by opening phrases, the same approach turn capture uses; implicit dissatisfaction is not detected.
- Evidence stays on the Host where the capability ran; portability decides later what of it syncs.

## Settings → Memory (PR9)

The memory manager is an Aeven page, not the MemOS Viewer: `@aeven/api-memory-manager` serves a `memoryManager` Remote that acts only for the caller of the running request, and `@aeven/client-ui-settings-memory` renders it as Settings → Memory. `MemoryProvider.list`, `edit`, and `forget` take an `owner` instead of a session scope, because the page runs outside any session. Capability provenance entries now carry a session only when a change came from one; evidence settlement and changes made from the page record none. `@aeven/memory` and `@aeven/capability` publish `./types` so Remote boundary types come from a public non-root type subpath, and `@aeven/memory/types` reads `SessionId` from `@aeven/session/types` so the Client face never merges the Host `ctx.sessions` declaration.
