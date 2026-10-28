---
description: "Guard that reviews a file-changing turn's final reply against the turn's requests and tool results before the turn closes, for users and maintainers configuring or debugging it."
kind: "package-reference"
---

# @aeven/turn-review

English | [中文](README.zh.md)

## Summary

A model can end a turn with "done" or "verified" while a request is still open or its own tool results show the opposite. `avn-turn-review` reads every turn that changed files, or whose final reply contains a screened action commitment, before it closes: one auxiliary model call receives the turn's user messages, tool calls, tool results, and final reply, and names requests left undone or done differently than asked, claims no tool result supports or one contradicts, and changes presented as working without an observation after the last edit. Findings send the agent into another step with the list; a clean review, a failed review call, or a spent per-turn budget lets the turn close. It ships enabled in the `avn` base bundle.

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

Mount it beside the model runtime when a composition exposes file-editing tools. The base bundle mounts it with its defaults; no configuration is required.

### When to choose it

Choose it when agents edit files and the product's value depends on the turn's final reply matching what the tools actually did. It costs an auxiliary model call for a selected turn; ordinary conversation without an action commitment is not selected. The review is deliberately narrow: it reports only undone or misapplied requests, unsupported or contradicted claims, and changes presented as working without an observation after the last edit — never style, wording, or unrequested improvements.

### Minimal configuration

```yaml
- name: '@aeven/turn-review'
  config:
    triggerTools: [write, edit, str_replace_editor]
    maxReviewsPerTurn: 2
    maxEntryChars: 2000
    maxTranscriptChars: 60000
    maxOutputTokens: 4000
    timeoutMs: 90000
    # provider: aeven-cloud   # optional explicit review route; pairs with model
    # model: Aeven-1.0-Flash
```

| Field | Default | Meaning |
|---|---|---|
| `triggerTools` | `[write, edit, str_replace_editor]` | A successful call to one of these makes the turn reviewed |
| `maxReviewsPerTurn` | `2` | Review rounds per turn; findings that persist after the last round no longer hold the turn open |
| `maxEntryChars` | `2000` | Characters quoted from one tool argument, tool result, or message (head and tail kept) |
| `maxTranscriptChars` | `60000` | Characters of the whole transcript; the oldest tool entries are dropped first, messages and replies are kept |
| `maxOutputTokens` | `4000` | Review output cap; reaching it fails the review and lets the turn close |
| `timeoutMs` | `90000` | Deadline of one review call |
| `provider`, `model` | the turn's route | Explicit review route; both or neither, otherwise loading fails |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how one turn is quoted and judged; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

The plugin listens on `agent/turn-stopping`, which runs while the turn can still take another step. It reviews only a turn whose last assistant message carries text with no tool call and no interruption, and only when a trigger tool completed with a non-error result in that turn or the final reply matches the English first-person action-commitment screen. The reviewer decides whether a screened commitment actually leaves requested work unfinished; the screen does not dispatch tools. The review is one `ctx.llm.stream` call on the turn's own provider and model, or on the configured explicit route; a session with no recorded route is not reviewed.

The reviewer reads a JSON array built from the turn's events in order: user messages whose source kind is `user`, every tool call with its arguments, every tool result, and every assistant reply. Each entry is clipped to `maxEntryChars`, keeping its head and tail with a cut marker, and the whole array is trimmed by dropping the oldest call and result entries until it fits `maxTranscriptChars`; messages and replies are never dropped.

A finding round is a steering message, not a duplicate step. The plugin budgets rounds per agent and turn, and a round is spent when its request is dispatched, so a turn whose findings persist after `maxReviewsPerTurn` closes anyway. A review call that times out, fails, reaches `maxOutputTokens`, or answers without a parsable verdict appends `turn-review/failure` with the reason, and the turn closes with its reply as written.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, turn selection, transcript quoting, review call, verdict parsing, steering message |
| — | No invariant companion is published because the review observes the turn it just read: the request and its outcome are logged as `turn-review/request` and either `turn-review/verdict` or `turn-review/failure`, and a reporter would re-derive the same records rather than compare independent observations. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [Agent loop](../../core/agent-loop/README.md) — the turn boundaries this plugin listens on.
- [LLM capability](../../llm/llm/README.md) — the runtime the review call streams through.
- [Bash edit guard](../bash-edit-guard/README.md) — the sibling guard that keeps file edits inside the tools whose calls are recorded.
- [Guard group map](../README.md) — sibling loop-hygiene and policy plugins.
- [Base bundle patch](../../bundle/base/cordis.patch.yml) — the composition that mounts this plugin with its defaults.

-----

<a id="model-experience"></a>
## Model Experience

### Findings message

#### What the model sees

A reviewed turn with a clean verdict adds no message, and a turn without a successful trigger call or screened action commitment, one that ends on a tool call, or an interrupted turn is not reviewed at all. Findings arrive as one `plugin`-sourced user message attributed to `turn-review`, listing one line per finding; `<issue>` is the reviewer's one-sentence statement of the request or claim and what the tool results show.

##### Steering message

```markdown
Internal review of your draft reply, not a message from the user:
- <issue>
- <issue>
Complete the user’s requested work or state its blocker; remove unsupported optional promises. Revise the full answer to the user’s request, preserving supported results. Do not reply to or acknowledge this review.
```

#### Token effect

Zero tokens on a turn that is not reviewed or whose review finds nothing. One finding round adds the steering message to the conversation history, and later requests of the same session carry it until compaction.

#### KV Cache effect

Append-only. The steering message enters after the prefix the turn already sent, so the reusable prefix extends rather than breaks.

### Review request

#### What the model sees

The review is a separate model request. Its system prompt is fixed by the package and names the four problems the reviewer may report; its single user message is `Review this turn:` followed by the quoted transcript as a JSON array of `user`, `call`/`arguments`, `result`/`error`, and `assistant` entries. The reviewer answers with JSON only.

##### Review system prompt

```markdown
You review the work an AI assistant did in one turn, before its final reply reaches the user.
You receive the turn as a JSON array in order: the user's messages (including messages sent while the assistant was working), the assistant's tool calls with their results, and the assistant's replies. The last reply is the one about to be sent.
Find only these problems:
1. A user request in this turn that was not done, was done differently than asked (for example a value set to the opposite of what was asked, or an approximation where the user asked to copy), or was dropped without the reply saying so.
2. A claim in the final reply (done, fixed, verified, matches, works, green) that no tool result shows, or that a tool result contradicts.
   This includes a claim that something does not exist, is missing, or is not supported when the tool result behind it read only a filtered, truncated, or partial view: a search pattern or filter that could not match the thing, a cut list, or a first page.
3. A change presented as working although no tool result observed it after the last edit; for a visual or UI change, observing means a browser read or screenshot taken after the last edit and build.
4. A reply claims work is starting, running, or continuing without a corresponding dispatched tool or continuing job, or promises to act after the turn ends with no job to do it.
For an action request, listing unfinished authorised work is not completion. Report it unless the user stopped or changed the task, or a concrete blocker requires user input. Questions and requests for a plan do not require execution.
Do not report style, wording, scope suggestions, or improvements nobody asked for. Disclosing that a check was not run avoids a false verification claim but does not excuse leaving requested work unfinished.
Answer with JSON only, no prose and no code fence: {"complete": true, "issues": []} or {"complete": false, "issues": ["..."]}. Each issue is one sentence that names the request or claim and what the tool results show.
```

#### Token effect

One request per review round: the fixed system prompt, the quoted transcript up to `maxTranscriptChars`, and at most `maxOutputTokens` of answer. None of it enters the reviewed turn's own request unless a finding steers another step.

#### KV Cache effect

Independent. The review call has its own prefix — a fixed system prompt followed by a transcript that differs every turn — so it neither reuses the reviewed turn's cache nor changes it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define what a review can and cannot establish. They are current package constraints, not a task backlog.

- **English commitment screen** — the additional screen recognises selected English first-person action phrases; other wording and languages can escape it. The persona guidance applies independently of this screen.
- **Clipped evidence** — the review reads tool results trimmed to `maxEntryChars` and the oldest tool entries dropped beyond `maxTranscriptChars`, so evidence outside those budgets is invisible to it.
- **Untriggered changes go unreviewed** — file changes made outside the trigger tools, such as a formatter run through `bash`, do not trigger a review on their own. Without a screened action commitment, a turn that only browses, fetches, or runs commands is not reviewed either, so its claims about what a page or result shows go unchecked; adding those tools to `triggerTools` reviews such turns at the cost of one review call, and the wait for it, per turn.
- **A finding is advice, not enforcement** — after `maxReviewsPerTurn` rounds the turn closes with its findings unresolved, and a failed, timed-out, or unparseable review leaves the reply as written.
- **No invariant companion is published** — the review observes the turn it just read: the request and its outcome are logged as `turn-review/request` and either `turn-review/verdict` or `turn-review/failure`, and a reporter would re-derive the same records rather than compare independent observations.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The review only reports; it never edits, retries a tool, or blocks disposal. Its system prompt is model-visible text and is recorded verbatim in `turn-review/request` before dispatch, so a change to it changes what a replay reconstructs. The verdict parser tolerates prose around the JSON object and fails the review — not the turn — on anything else.

</details>
