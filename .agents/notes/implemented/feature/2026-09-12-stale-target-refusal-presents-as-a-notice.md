# Agent Note: A Stale-Target Refusal Presents as a Notice, Not an Alarm

Status: implemented

English | [中文](2026-09-12-stale-target-refusal-presents-as-a-notice.zh.md)

## Problem

A guarded mutation whose target changed between the session's read and its write fails with `FS_STALE_VERSION`, which `@aeven/tool-fs` renders as `cannot write "<path>": file changed since it was read — re-read the file, then retry`. [The refused-edit note](2026-09-11-refused-edit-presents-as-a-notice.md) introduced the notice presentation for this kind of refusal and deliberately left this code out, reading a file that changed under the reader as "a fact to weigh rather than a step the session takes". The row does not read that way to the person watching it. A stale read is the ordinary result of a file another process, a formatter, a second session, or the reader's own editor touched, and it is the failure a session clears most mechanically: re-read, retry, done. Wearing the full error treatment — an error-colored state dot, the failure line in the error color, and the tool registry's `Error: ` prefix leading it — it is read as a defect in the harness rather than as the version guard doing its job, which is the complaint the notice presentation exists to answer.

## Decision

`NOTICE_ERROR_CODES` holds `FS_NOT_OBSERVED` and `FS_STALE_VERSION`. Both are guarded-mutation refusals whose model-facing message names the read that clears them: `remediateFsError` appends `— re-read the file, then retry` to every `FS_STALE_VERSION` a guarded mutation raises, the version guard's missing-target case (`file no longer exists`) included. Classification stays on the structured error code and never on the message text, so a provider-side refusal and a policy refusal land in one class and a text the tools normalize cannot claim a failure this list never checked.

The row keeps everything that made it a failure: its state stays `error`, the message stays the collapsed summary, the expanded output keeps its error styling, and the assistive-technology status stays "failed". The same two things soften as for the other code — the leading indicator becomes `StateDot`'s `warning` state, and the collapsed line carries `.noticeSummary` instead of `.errorSummary`; `data-notice` marks the row for CSS and for tests. No wiring changed: `FileMutationRow` owns `edit` and `write`, the two tools that can report this code, and already forwards the flag.

## Alternatives considered

**Strip the tool registry's `Error: ` prefix from a notice row's line.** The prefix is the loudest word in the row, and it is what a reader reacts to before reading the remedy. Rejected: the collapsed line is the settled result's own first line, and a row that softens its chrome while editing the text it quotes would disagree with the expanded output one click away and with the session log the transcript stands for. The prefix also carries a fact the styling does not — this call failed rather than succeeded with an odd summary — and the state dot, not this word, is what the alarm was made of.

**Keep this code an alarm and soften only its copy.** Rejected: the presentation dimension already exists, and spending it on one guarded-mutation refusal while the other states the identical next step leaves readers to learn which refusals the harness expects them to take in stride.

**Match the stated remedy in the message text instead of listing codes.** Rejected for the reason [the refused-edit note](2026-09-11-refused-edit-presents-as-a-notice.md) records: a text match also claims failures the classification never checked, and the structured code already separates a stated remedy from an unstated one at the source.

**Re-read the target and retry the mutation automatically.** Rejected: the version guard exists to refuse a write based on a version the session never saw. Retrying on the model's behalf would apply its authored content over whatever the other writer produced, turning a refusal the model can reason about into a silent overwrite.

## Consequences

Both guarded-mutation refusals now read as information: visible, expandable, still announced as failed, and no longer competing with real failures for attention. The cost is narrower alarm coverage — a stale target can be the symptom of a competing writer a reader would want to notice, and that row is quieter than it was. The detail survives the softening: the message and its remedy are on the row, and the expanded output keeps its error styling. The classification list remains the maintenance point, because every added code makes an alarm quieter for every reader of the transcript.

## Verification

`packages/client/ui-tool/tests/tool-row.client.spec.tsx` pins the classification: an `FS_NOT_OBSERVED` result and an `FS_STALE_VERSION` result are notices, a failure with any other code is not, and running or successful calls never are. `packages/client/ui-tool/tests/diff-card.client.spec.tsx` pins the rendered `write` row: `data-state="error"` with `data-notice` and `.noticeSummary`, no `.errorSummary`, and the message with its remedy readable while collapsed.
