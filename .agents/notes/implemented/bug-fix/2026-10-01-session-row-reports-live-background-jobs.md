# Agent Note: A Session row reports its live background jobs

Status: implemented

English | [中文](2026-10-01-session-row-reports-live-background-jobs.zh.md)

## Problem

The Workspace browser's Session rows ([`@aeven/client-ui-workspace`](../../../../packages/client/ui-workspace/README.md)) described a Session's activity from two facts: `SessionSummary.running`, which the Host computes as `ctx.agents.get(session.id)?.status === 'running'` ([`session-controller/list.ts`](../../../../packages/api/session-controller/src/list.ts)), and the count of running descendants along subagent-origin lineage. Neither sees background jobs.

A job outlives the turn that started it. `run_in_background` bash and pwsh runs, background pty sends, and background subagents all stay registered while the owning Agent goes idle at `turn/end`. Between turns the row therefore showed the neutral circle, or the green finished reminder the ended turn armed, while the job kept working. In the reported Session the header's job action read `1 job active` beside its spinner while the Session's own row read `Idle` with no spinner: the same work, two answers, and the row was the wrong one.

The failure is visible only in the window between a turn ending and its jobs settling, which is exactly the window a reader uses the list for — deciding whether a Session still needs them.

## Decision

A Session row carries its own live-job count. `SessionNode.runningJobCount` and `SearchResultNode.runningJobCount` are derived in [`tree.ts`](../../../../packages/client/ui-workspace/src/client/tree.ts) from `SessionListState.jobsBySession`, the per-Session job rows the client list state already mirrors from Session Controller's control stream, and `sessionStatuses` in [`Rows.tsx`](../../../../packages/client/ui-workspace/src/client/rows/Rows.tsx) reports every non-zero count as an `ongoing` status beside the primary one.

The derivation is client-only. Session Controller's control baseline and its `jobs` frames already carry each Session's visible jobs to every connected browser, so the fact is on the wire before this change; the row derivation was the only place that ignored it. `runningJobCount` counts `running` and `stopping` records, the same predicate the header list applies to its own rows, so a job that is being killed keeps the mark until it settles.

The row's status now resolves in this order: a pending interaction is still primary, a running Agent is still primary, and a live job ranks above the finished reminder but below both. A Session whose Agent runs and whose job also runs reports `Running` with the job count beside it, matching how a running descendant is already reported. The label reuses the header list's own wording — `{n} job active` in [`ui-jobs`](../../../../packages/client/ui-jobs/src/client/locales.ts) — so one fact reads the same in both surfaces.

`SessionSummary.running` keeps its Agent-only meaning. It is the fact the composer's Stop control, the queue-or-steer submission policy, and `conversationPhase` read, and a live job is not a running turn: nothing is listening for the human's next message, and no turn exists to stop or steer. Folding jobs into it would have queued the next message into a Session that has nothing running.

## Alternatives considered

**Extend the Host's `running` bit to include jobs.** This would have needed no new field on the row. Rejected: `running` means "the Agent is executing a turn" at every other consumer ([`submission-policy.ts`](../../../../packages/client/ui-conversation/src/client/input/submission-policy.ts) queues or steers a submission while it is set, [`InputBar.tsx`](../../../../packages/client/ui-conversation/src/client/input/InputBar.tsx) offers Stop for it), so a background job would silently swallow the reader's next message into a queue for a turn that never starts.

**Open one job roster per listed Session in the sidebar.** `ctx.jobs.watchRows(sessionId)` already serves the selected Session's header list. Rejected: the sidebar lists every Session the reader owns, and a Gateway stream per row buys a fact the always-open control stream has already delivered.

**Read the rosters the client jobs model keeps.** `ClientJobsModel` holds the same rows for the Sessions whose header list is watching them. Rejected: those rosters exist only while their own list is mounted, so the sidebar's answer would depend on which Session the reader had open.

**Report a plain `Running` label instead of the job count.** Rejected: it states a fact about the Agent that is not true, and the count is what tells the reader why an idle-looking Session is still marked in flight. The visually hidden status text is the row's only status report, so it has to name the work.

## Consequences

A Session between turns with a live job keeps the loading mark in the list until its last job settles, then falls back to the reminder the Agent's idle edge armed, so nothing is lost by the mark holding the slot. A job that settles while the Session is not selected therefore still ends at the green reminder; the reminder itself is unchanged.

The row costs one map lookup per listed Session per derivation, over rows the client already holds. Sessions with no jobs report `0` and render exactly as before.

Per [registry `list` semantics](../../../../packages/jobs/jobs/README.md), the control stream's per-Session rows include unowned jobs in every Session, so an unowned job marks every row. That is the same set each Session's header list already shows, and unowned jobs exist only for producers that start work outside an Agent; no shipped producer does.

## Testing

[`packages/client/ui-workspace/tests/tree.client.spec.ts`](../../../../packages/client/ui-workspace/tests/tree.client.spec.ts) pins the derivation: a Session with a running and a stopping job reports `2` while one holding only completed and killed jobs reports `0`, through both the flat list and search results. [`packages/client/ui-workspace/tests/rows.client.spec.tsx`](../../../../packages/client/ui-workspace/tests/rows.client.spec.tsx) pins the presentation: a job-only Session reports the job status, is not described as running, and does not report the completed reminder, while a running Session reports both its running status and the job count.

The reported case was reproduced and the fix verified against the running app: a Session whose Agent went idle mid-job read `Idle` with no spinner before the change and `1 job active` with the mark after it, on the same live job.
