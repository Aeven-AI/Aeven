# Agent Note: A Refused Edit Presents as a Notice, Not an Alarm

Status: implemented

English | [中文](2026-09-11-refused-edit-presents-as-a-notice.zh.md)

## Problem

`@aeven/fs-observation-policy` refuses an `edit` of a target the session has not read with `FS_NOT_OBSERVED`, and `@aeven/tool-fs` renders that refusal as `cannot modify "<path>": file has not been read — read the file, then retry`. The refusal is routine by design: it is the gate working, and the read the message names is the entire remedy. The chat row nevertheless wore the whole error treatment — an error-colored state dot and the failure line in the error color — so a step the session clears by itself scanned exactly like an incident. A session that edits before reading produces several such rows in a row, and each one read as a defect in the harness rather than as a policy doing its job. Suppressing them is the other temptation, and the worse one: the transcript is what the model saw, and a hidden refusal would remove the one explanation for the read that follows it.

## Decision

A settled tool failure whose remedy is a documented next step presents as a notice rather than an alarm. `toolRowModel` classifies one from the structured error code and never from the message text: the tools normalize every unread source to one sentence, so a text match would also claim failures this classification does not. Code-based classification has the further virtue that a provider-side refusal and a policy refusal land in the same class, which is correct — the same next step clears either. `NOTICE_ERROR_CODES` holds `FS_NOT_OBSERVED` and, since [the stale-target note](2026-09-12-stale-target-refusal-presents-as-a-notice.md), `FS_STALE_VERSION`, whose own diagnostic states the same re-read remedy.

The row keeps everything that made it a failure. Its state stays `error`, so the run-state contract, the row chrome, and the assistive-technology status ("failed") are unchanged; the message stays the collapsed summary; the expanded output keeps its error styling. Exactly two things soften — the leading indicator becomes `StateDot`'s `warning` state, and the collapsed line carries `.noticeSummary` (secondary label color) instead of `.errorSummary` (error color). `data-notice` on the row carries the distinction to CSS and to tests.

`ToolRow.notice` is optional and defaults to the ordinary error row. Only the rows that can report this failure forward it: `FileMutationRow`, which owns `edit` and `write`, and `GenericToolCard`, the keyed-dispatch fallback those calls land on when that view is not registered. Rows for tools that cannot report an unread target stay unwired rather than forwarding a field that is always false.

## Alternatives considered

**Suppress the row in the chat view.** The complaint that prompted this was noise, and a filter over the normalized sentence would be the smallest way to answer it. Rejected: the rendered transcript is the model's own context, so a hidden refusal makes the view disagree with what the agent acted on — the read that follows the refusal would appear unmotivated — and a filter keyed on that sentence would also hide failures the classification never claimed.

**Read the target on the model's behalf and retry the edit.** Rejected: it removes the discipline the gate exists to impose rather than the noise. The model would still author `old_string` blind, and a literal that happens to match uniquely somewhere unintended would be applied silently. A general "read and retry" would additionally swallow `FS_STALE_VERSION` — the case where the model's picture of the file is certainly outdated and re-reading the content, not merely bumping a version, is the point. Narrowed to `FS_NOT_OBSERVED` only, it would fix the rarer cause and leave the common one (a session that never read the file at all) untouched.

**Collapse the row once the same path is successfully read or edited.** Rejected as an empty gesture: a tool row is already collapsed until the reader expands it, so "recovered" would change nothing visible, while detecting it needs sibling-call context threaded through the tool-slot contract for every row in the turn.

**Introduce a `notice` value on `ToolRowState`.** Rejected: the state drives the run-state contract and the accessible status, and this change deliberately alters neither. Presentation is what softens, so presentation is what carries the flag.

## Consequences

A routine refusal now reads as information: the row is visible, expandable, and still announced as failed, but it no longer competes with real failures for attention. The cost is one more presentation dimension on the row and a classification list that must be maintained deliberately — the next code added to it makes an alarm quieter for every reader, so each addition needs the same argument this one had. Nothing about the gate itself changed: an unread target is still refused, and the filesystem tools still report the same code, message, and state.

A reader who wants the old emphasis still gets it one click away, in the expanded output, which keeps its error styling.

## Verification

`packages/client/ui-tool/tests/tool-row.client.spec.tsx` pins the classification: an `FS_NOT_OBSERVED` result is a notice, a failure with any other code is not, and running or successful calls never are. `packages/client/ui-tool/tests/diff-card.client.spec.tsx` pins the rendered row: the refusal keeps `data-state="error"` while gaining `data-notice` and the `.noticeSummary` class, its message stays readable while collapsed, and a failure whose recovery nothing states keeps the error presentation. The client lib and web artifacts were rebuilt, and the served bundle at the running Web URL carries the `warning`/`error` dot branch, the notice class, and `data-notice`.
