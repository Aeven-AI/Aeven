# Agent Note: Turn review and the bash edit guard

Status: implemented

English | [中文](2026-10-21-turn-review-and-bash-edit-guard.zh.md)

## Problem

In a nine-turn CSS session the agent changed `ProducedFiles.module.css` and `ProducedFiles.tsx` through 28 Python heredocs run with `bash` after its `edit` calls were refused for unread files. `str.replace` changes nothing when its text is absent and reports success, so several requested values never landed. The edits left no `tool/call` that the produced-files card reads, so turns 3–9 showed no edited files. The final replies claimed "done", "verified", and "matches the table" while the turn's own tool results showed the opposite: a DevTools read that found the reference header transparent before the reply called the opaque header "the way the table card works", a pill observed invisible before the reply called it "blurred", and a bundle search that matched `-webkit-backdrop-filter` presented as proof of `backdrop-filter`. One request ("the font weight of the header is 400 instead of 500") was applied inverted.

## Decision

`@aeven/bash-edit-guard` registers a `tools.guard` that refuses a `bash` command which names an existing file with a source extension and edits it in place (`sed -i`, `perl -i`), writes through a scripting call (`open(…, 'w')`, `write_text`, `writeFileSync`, …), or redirects into it (`>`, `>>`, `tee`). Paths resolve against the call's `workdir`, the session cwd, and every `cd` target in the command. Creating a file, writing under the system temporary directories, and running programs are not refused, so scaffolding a new project with `cat > package.json` still works. Replayed against the CSS session the guard refuses exactly its 28 edit scripts; replayed against a one-turn website build it refuses none of the 12 commands as they ran.

`@aeven/turn-review` listens on `agent/turn-stopping`. When a turn ends on a text reply and a `write`, `edit`, or `str_replace_editor` call succeeded in it, one auxiliary call on the turn's own route reads the turn as JSON (user messages, tool calls, clipped tool results, replies) and answers `{"complete", "issues"}` for three problems only: a request not done or done differently than asked, a claim no tool result supports or one contradicts — including a claim that something does not exist or is not supported when the result behind it read only a filtered, truncated, or partial view — and a change presented as working without an observation after the last edit. Issues steer the agent into another step through a `plugin`-sourced user message; a clean verdict, a failed or timed-out call, or the `maxReviewsPerTurn` budget (2) lets the turn close. `turn-review/request` records the exact request, `turn-review/verdict` the parsed outcome, and `turn-review/failure` a call that produced neither, with its reason.

Selected final replies containing English action commitments also receive review. The reviewer checks unsupported progress claims and unfinished authorised work even when the reply discloses that it is incomplete; see [execution efficiency](../bug-fix/2026-10-26-agent-execution-efficiency.md).

Findings identify themselves as internal draft review. The agent completes requested work or states its blocker, removes unsupported optional promises, and revises the full answer while preserving supported results. It does not acknowledge the review as a user message. An invented promise does not authorize extra work.

## Alternatives considered

**A rule in the persona or system prompt.** Rejected: the session's prompt already told the model to use `edit` for targeted changes, and the model routed around it after a refusal. A guard in the operation is enforcement; prose is not.

**Snapshot the workspace around every bash call.** Rejected for now: a `git status` per call costs time on every command and still cannot tell a formatter run from a hand edit.

**Review every turn.** Rejected: the extra call adds latency to ordinary conversation. Selected action commitments also receive review under the [execution-efficiency decision](../bug-fix/2026-10-26-agent-execution-efficiency.md).

## Consequences

- A file-changing turn spends one extra model call before it closes, two when the first review finds gaps.
- The guard reads command text, so a write it does not recognise (for example a custom script that writes a path it computes) passes.
- A command that reads an existing source file inside a scripting call that also writes elsewhere is refused; the model reads the file with `read` instead.
