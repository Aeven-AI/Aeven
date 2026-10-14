# Agent Note: Capability lifecycle

Status: implemented

English | [中文](2026-09-29-capability-lifecycle.zh.md)

## Problem

A confirmed capability is trusted instructions for every later session of its user. Procedures go stale: a tool changes, a machine differs, or the procedure was never right. Trust has to follow what happens when the capability runs, without a model-generated confidence number deciding anything.

## Decision

`@aeven/capability` keeps every revision's procedure (`versions/<revision>.md`) and an append-only evidence log (`executions.jsonl`) per capability. `@aeven/tool-capability` records one execution for each turn that loaded a confirmed capability: revision, model route, environment, tools called after the load, provider retries, tokens, turn end reason, and the model's `report` (outcome and verification). A direct-user correction in the next turn and a rating on the turn's reply are appended as amendments.

A deterministic policy judges each execution and derives the status after every write:

- **Verdicts.** A correction, a negative rating, a failed report or verification, or a failed turn fails an execution. A positive rating verifies it, and so does a reported passed verification together with a successful tool call; a report alone is never verification.
- **Statuses.** Only the user makes a capability executable or retires it. Among executable statuses, `trusted` needs `trustAfter` successes of the current revision with at least one verified and no failure last; `degraded` follows `degradeAfter` consecutive failures; `needs-validation` holds after a trusted procedure changes until a verified run of the new revision exists; otherwise `learned`.
- **Model view.** Trusted and learned capabilities load unchanged. Degraded, needs-validation, and capabilities that never succeeded in the current environment load with a short evidence note asking the model to verify and report.

## Alternatives considered

**Let a model-generated confidence number set trust.** Rejected because a deterministic policy judges each execution and derives the status after every write, so trust follows recorded evidence and a model's number alone never promotes a capability.

**Keep asking the user to save each learned procedure.** Rejected because it made the learning layer a feature the user maintains; learning is now automatic and silent, with the first successful execution making a candidate `learned` and `degradeAfter` failed executions retiring it.

**Keep the memory manager as the MemOS Viewer.** Rejected because Settings → Memory is an Aeven surface whose Remote acts only for the caller of the running request, while the Viewer remains a development stopgap.

## Consequences

- A browser run took `check-node-toolchain` from learned to trusted after three verified runs, back to learned after one correction, and to needs-validation after a confirmed edit; a new session loaded it with the validation note, ran the new step, and asked the user before touching the environment.
- Corrections are recognized by opening phrases, the same approach turn capture uses; implicit dissatisfaction is not detected.
- Evidence stays on the Host where the capability ran; portability decides later what of it syncs.

## Settings → Memory (PR9)

The memory manager is an Aeven page, not the MemOS Viewer: `@aeven/api-memory-manager` serves a `memoryManager` Remote that acts only for the caller of the running request, and `@aeven/client-ui-settings-memory` renders it as Settings → Memory. `MemoryProvider.list`, `edit`, and `forget` take an `owner` instead of a session scope, because the page runs outside any session. Capability provenance entries now carry a session only when a change came from one; evidence settlement and changes made from the page record none. `@aeven/memory` and `@aeven/capability` publish `./types` so Remote boundary types come from a public non-root type subpath, and `@aeven/memory/types` reads `SessionId` from `@aeven/session/types` so the Client face never merges the Host `ctx.sessions` declaration.

## Automatic learning without questions

Asking the user whether to save a procedure made the learning layer a feature the user maintains, so learning is now automatic and silent. `@aeven/tool-capability` runs a learner: a turn that completed with at least `minSteps` real tool calls is held until the user's next message, dropped on a correction, and otherwise distilled by a background model call into a new candidate or merged into an existing capability. Candidates are published at once with a note to check each step; the first successful execution makes them `learned`, `degradeAfter` failed executions retire them, and a candidate never executed in `candidateTtlDays` leaves the catalog. An unreported execution whose turn completed with a successful last tool call counts as `succeeded`. Each learned capability stores its origin (request, tools, and the turn's cost), and Settings → Memory compares that baseline with the median of recent successful runs. The model is told never to ask about or announce saving; `capability_manage` lost `delete` and every confirmation, and deletion stays in Settings. Learning a procedure grants nothing: every tool call it leads to still passes the session's access mode and approvals, which remain the consent boundary. In a browser check, a storage-report request (7 tool calls, 27 s, 28.6K tokens) produced `aeven-storage-report` after the follow-up message; a reworded request in a new session was pointed to it, loaded it, finished in 4 tool calls, 20 s, and 10.8K tokens, and promoted it to `learned`.

## Learning benchmark

`pnpm run benchmark:learning` measures whether learning makes a fixed task faster and better. It runs the same inventory task (sizes, largest files, `.log` count, CSV rows, with hidden directories, CSV headers, and look-alike file names as traps) through the shipped `headless` profile, in a throwaway `$AVN_HOME` per condition: `baseline` mounts the capability registry with learning off, `learning` with it on; memory stays off in both, so the only difference is capability learning. Every run gets a freshly generated fixture with the same structure and new values, so it cannot pass by repeating earlier numbers; the script compares `inventory.json` with truth computed from the fixture, and reads time, tool calls, failures, and tokens from the session log. Two product changes made it possible: the headless runner takes an `owner` (`$AVN_OWNER`), the configured-owner slice of roadmap step 11, and awaits the new `session/settle` checkpoint before exiting, which the learner uses to finish learning from the run, because a one-shot process otherwise exits within the five-second shutdown grace while the learning call is still running.

First measurement (2026-09-29, `--task release --runs 5`, aeven-cloud/Aeven-1.0-Flash, high effort): all ten runs produced a correctly verified artifact. Baseline, with no capability layer mounted, took a median of 18 s and 18 tool calls. With learning, the first run learned the procedure; runs 2–5 took 19, 15, 12, and 10 s with 12, 15, 7, and 7 tool calls (median 13 s and 9.5 calls), and the capability revised itself once and reached `trusted`. The first `inventory` measurement showed no difference, because a cold run already solved it without mistakes. Two benchmark defects were found and fixed along the way: mounting the capability tool in the baseline let the model save the procedure itself, so baseline now mounts no capability layer; and the learner treated smooth first runs as one-offs, so it now learns from the first successful multi-step operational task.
