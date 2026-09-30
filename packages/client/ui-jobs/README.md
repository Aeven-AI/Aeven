---
description: "Web background-job surface: the session-header action listing the jobs this session can see; for users and maintainers of the background-job experience."
kind: "package-reference"
---

# @aeven/client-ui-jobs

English | [中文](README.zh.md)

## Summary

This package renders the background-job surface of the Web GUI: a session-header action that opens a popover listing the jobs this session can see. Rows, live output, the human stop, and Clear arrive through the client jobs service (`ctx.jobs`) — the roster stream the host's job controller mirrors, one observation stream per open row, and the kill and dismissal calls — and the component holds no transport state of its own. The trigger appears only when the session has at least one job, with a badge counting running and stopping jobs; settled rows stay visible until the registry drops them. The model's own view of the same jobs belongs to `avn-tool-jobs`; this package is the human's projection of it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside the runtime; the job action then appears in the session header whenever the session has at least one job. A click opens the popover: live rows first (newest start first), then settled rows (newest finish first), each showing the producer kind or title, its status, and an elapsed duration that ticks once per second while live and freezes at completion.

Every row folds out into its facts, its command, and its output. A settled row is as openable as a running one, because a job that printed nothing — a background subagent, a command that redirected its output to a file — is recorded nowhere else: what is left of it is when it ran, how it ended, and the command that started it. Opening a row that still has output (a live job, or a settled one with retained bytes) also follows its output stream; the output card stays quiet for a job with nothing to read. A running row offers a stop, and the settled section offers Clear.

### Dismissal and limits

Escape closes the list and returns focus to the trigger, as does a pointer press outside it. The list shows what one session can see through the wire view, so a job owned by another session never appears here; a process restart empties the list while the transcript keeps the `run_in_background` cards that started those jobs.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package contributes one entry to `conversation.session.header.actions` (`JobListAction`). Rows come from `ctx.jobs`, the client half of [job controller](../../api/job-controller/README.md): one reference-counted roster stream per watched session, one observation stream while a row with output is open, and the kill and dismissal calls behind the stop and Clear. Expanding a row starts its observation stream only when there is output to read; collapsing, closing the popover, or unmounting releases it, so output flows only while someone is watching. The badge counts `running` plus `stopping` and is omitted at zero. Rows order live first by newest start, then settled by newest finish, with a same-millisecond tie broken on the newer start; a settled row missing `finishedAt` reads as its start rather than as a negative figure, and a duration past an hour stays in hours. Settled rows stay visible because a failed job's `detail` is the only place its failure is legible, and every row folds out because a job that printed nothing has no other record. The display decisions are specified by the [Web background-job display note](../../../.agents/notes/implemented/feature/2026-08-08-web-background-job-display.md) and the [fold-out note](../../../.agents/notes/implemented/bug-fix/2026-09-30-background-job-list-folds-out-every-row.md).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the job surface is not enough. They move from the browser list to the registry and the model-facing tool.

- [avn-tool-jobs](../../jobs/tool-jobs/README.md) — the model-facing jobs tool over the same registry.
- [Session Controller](../../api/session-controller/README.md) — folds the `jobsBySession` mirror this package reads.
- [ui-subagent](../ui-subagent/README.md) — the subagent catalog, where a running one-shot background subagent also appears.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders host-computed registry state for a human and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current job list. They are current package constraints, not a general job-management comparison or a task backlog.

- **A row shows only what the job's own streams carried** — a background subagent keeps no output of its own (its child session owns that detail), and a command that redirects everything to a file leaves the ring empty. Such a row folds out into its facts and command with an empty output card; nothing mirrors the child's transcript or the redirected file into it.
- **The list is not the registry's own set** — it shows what one session can see through the wire view, so a job owned by another session never appears here, and a process restart empties the list while the transcript keeps the `run_in_background` cards that started those jobs. An unowned job (one started without a live `Agent`) reaches every session's list, matching what `list(caller)` reports to every caller.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package is a read-only projection of the client jobs service's rosters and observations onto one header slot entry. It emits no cordis events, owns no cross-plugin mutable state, and its single slot registration proves disposal through the HMR-safety spec.
