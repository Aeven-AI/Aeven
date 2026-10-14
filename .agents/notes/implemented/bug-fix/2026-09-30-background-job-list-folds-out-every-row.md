# Agent Note: Every background-job row folds out

Status: implemented

English | [中文](2026-09-30-background-job-list-folds-out-every-row.zh.md)

## Problem

The session-header background-job list ([`@aeven/client-ui-jobs`](../../../../packages/client/ui-jobs/README.md)) offered a row's details only when the row had something to read. `isObservable(job)` was `isLive(job) || job.output.total > 0`, and a row that failed it rendered as a static span: no chevron, no handler, no panel.

A running job satisfied the first half; once it settled, only the second half was left. A job that never wrote to its own output ring therefore became unopenable at the moment it settled, one second after the same row had opened. Two producers settle with an empty ring as a matter of course. A one-shot background subagent keeps no output at all — [`tool-subagent`](../../../../packages/subagent/tool-subagent/src/index.ts) registers its job without an output source, because the child session owns that detail. A bash or pwsh command that redirects its streams to a file leaves the ring empty because every byte went to the file.

The gate was meant to avoid offering a panel with nothing in it. But the panel also carries the facts — started, ended, ran for, result — and the command that started the job, and for these jobs that is the whole record: the transcript's `run_in_background` card says nothing after `started background job bash-5`. In the reported session the list showed seven settled jobs, four with a chevron and three — the ones whose commands redirected into a log file — without one.

## Decision

Every row folds out. `hasOutputStream(job)` — still `isLive(job) || job.output.total > 0` — now gates the observation stream alone: expanding a row opens its `job.follow` stream exactly when there is output to read, and the output card of a job with nothing to read says so. The row's button, chevron, details, and facts no longer depend on that test.

The panel keeps its shape. A live row shows the waiting copy in its output card, a settled one shows the no-output note, and the command card always carries `job.label`, which is the command for a shell job and the description for a subagent. The list's placement, channel, and settled-row visibility belong to the [Web background-job display note](../feature/2026-08-08-web-background-job-display.md); this note owns which rows fold out.

Three parts of the panel became unconditional with the row:

- `dotState` takes `Exclude<JobView['status'], 'running'>`. The marker's running branch renders the loading mark and never asked the map for `'running'`, so that arm had no caller.
- The stop dialog's confirm button calls `confirmKill(job)` with the job it was rendered for, instead of reading the `confirmJob` state behind a guard no render could reach.
- The dialog's `className` reads `css.confirm as string`, the idiom [`DevicePane`](../../../../packages/client/ui-sidebar-device/src/client/DevicePane.tsx) and ``AgentPresetSection`` already use for a Modal class: the `?? ''` fallback it replaces is unreachable while the per-file gate reads it as an uncovered branch.

## Alternatives considered

**Give the output-less producers an output source.** A background subagent job could narrate its child's phases into the ring, and a shell job could mirror the file it redirected into. Rejected: the child's transcript already owns the subagent detail, a redirected file is the caller's own artifact, and either version adds a pump to every such job to populate a card nobody asked to see filled. What was missing was the facts and the command, both of which already existed behind the gate.

**Keep the gate, and move a settled row's facts into the closed row.** The status word is already there, so a second line or a longer tooltip could carry the rest. Rejected: the missing facts are when the job started, how long it ran, and how it ended, which read as a list rather than as a line; every row would grow, including the many rows nobody opens; and a tooltip is not selectable or copyable the way the panel's command card is.

**Open the observation stream for every expanded row.** Rejected: `job.follow` on a settled job with an empty ring yields one anchor, one terminal status, and then closes — a stream and a round trip per expanded row that can only confirm what the empty card already says.

**Keep the gate for rows with nothing to read, and drop the chevron from every row that fails it.** This is the shipped defect stated as a rule. Rejected because the affordance was not wrong about the data: the details exist for every row.

## Consequences

A settled job is as openable as a running one, so the three rows in the report now show their facts and command, and the list no longer withdraws an affordance one second after it offered it. Output still flows only while someone watches: opening a row with nothing to read opens no stream.

The details of a job that printed nothing stay sparse — facts, the command, and an empty output card. Nothing mirrors a child subagent's transcript or a redirected file into the panel, and `job.follow` reads the job's own ring only.

## Testing

[`packages/client/ui-jobs/tests/job-list-action.client.spec.tsx`](../../../../packages/client/ui-jobs/tests/job-list-action.client.spec.tsx) pins the behavior through the rendered surface: a settled job with an empty ring folds out into its facts, command, and no-output card while opening no stream (the reported case); a settled row with retained output folds out and follows its stream, including the gap marker, a stream failure, and release on collapse and on popover close; a live row waits for output; plus ordering, both duration vocabularies, the settled tail's fold, Clear, Escape and outside-press dismissal, the two-press stop with its pending, refused, and row-settled-first paths, and the viewport fit. [`browser-plugin.client.spec.ts`](../../../../packages/client/ui-jobs/tests/browser-plugin.client.spec.ts) boots the real slot registry over a stubbed jobs service, asserts the header entry appears and leaves with its fiber, and drives the injected face's watch, observe, kill, and dismiss calls. Every file in the package is inside the per-file 100% coverage gate.
