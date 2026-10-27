# Agent Note: Several files in one read or edit call

Status: implemented

English | [中文](2026-10-27-multi-file-read-and-edit.zh.md)

## Problem

A recorded session ran 161 tool calls in 161 model steps. The model's reasoning planned "3 read calls in one message" and "three edits in one message", but each response stopped after the first call, so reading and editing three files cost six model round trips of about three seconds each. Across recent sessions the routed model batched native calls in about one step in six, almost all `bash` or web calls; `read` was batched twice and `edit` never, although the persona already asked for grouped calls.

## Decision

`read` and `edit` accept a `files` list, so batching no longer depends on the model emitting several calls. Each entry has the single-file arguments: `read` entries take `file_path`, `offset`, and `limit`; `edit` entries take `file_path` with `old_string`/`new_string`/`replace_all` or an `edits` list. The single-file form, its result text, and its presentation metadata are unchanged.

A several-file `read` runs its files concurrently, reports a failed file in place, and fails only when every file fails. A several-file `edit` resolves every path first, rejects a repeated file, then applies files in order with each file's own observation guard; a failure stops at that file and its error names the files already changed. The tool descriptions, prompt guidance, and persona point the model at both lists.

Consumers that read `file_path` from call arguments follow the list: nested agent instructions load for every touched path, turn deliverables record every edited file with its own line counts, and the Web diff card and row summary cover every file. The diff card and deliverables also accept the single-file `edits` list, which they previously skipped.

## Alternatives considered

Prompt wording alone already existed and was ignored for file tools. A cross-file atomic edit would need a filesystem transaction that no backend offers. A separate multi-file tool would duplicate guards, presentation, and consumers.

## Consequences

A several-file `read` has no read card; the Web shows it as a generic row with the envelopes. A partially applied several-file `edit` reports an error, so the Web shows no diff for its applied files. `scripts/bench/agent-efficiency.ts` measures calls and steps per task to compare before and after.
