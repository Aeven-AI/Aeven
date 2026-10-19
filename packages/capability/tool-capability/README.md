---
description: "Automatic learning: the background learner that distills completed work into procedures kept in long-term memory (or, opt-in, capability files), and the capability_manage tool."
kind: "package-reference"
---

# @aeven/tool-capability

English | [中文](README.zh.md)

## Summary

`avn-tool-capability` makes Aeven learn reusable procedures for the session's owner without asking anyone. With `store: memory` (the default) each learned procedure is one long-term memory: its full Markdown is the stored text and its summary is the procedure condensed, so the memory recall at the start of a turn already carries the steps, and `memory_get` reads the rest. Before each distillation the learner lists every procedure the session's workspace can see (`ctx.memory.procedures`), so work of a kind it already knows is merged into that procedure; the result replaces every memory stored under its name and every procedure it names as covered. Above `consolidateAbove` distinct procedures, the learner also groups the procedures of one kind of task and merges each group in the background, once per owner and workspace per process. Nothing is written as a skill or a capability file. With `store: capabilities` the learner writes candidate capabilities instead, recalled as `<procedure_context>`, as described below.

- **Learner.** A turn that completed with at least `minSteps` tool calls (skill, capability, memory, todo, tool-search, and job-output bookkeeping excluded), whose last call succeeded, is learned from as soon as it ends. A background model call on the session's route (or the configured `provider`/`model`) decides to skip it, create a procedure, or merge it into an existing procedure of the same kind of task, and writes it with "Fast path" (the fewest calls and the time sinks to avoid), "When to use", "Requirements" (including the user's stated preferences), "Steps", "Verification", and "Recovery". The call sees each tool call's thinking and running time and the turn's split between thinking and tools, so the fast path cuts what took the time. When the user's next message corrects the turn or complains that it was slow, the same work is learned from again with that message, replacing the procedure it produced. Distillations of one owner run one at a time. A new capability records its origin: the request, the tools used, and the turn's duration, tool calls, failures, and tokens as the baseline. Work that followed a learned capability without failures teaches nothing new; its execution is evidence instead. A retired capability is never recreated.
- **Reuse.** At the start of a direct-user turn, a bounded model call scores eligible procedure summaries by intent, outcome, and constraints. Candidates and retired procedures are excluded. Up to `maxRecalled` matches above `recallMinScore` are read into bounded advisory context; none is returned when nothing qualifies.
- **Evidence.** Only a turn that reports actually using a recalled or deliberately viewed procedure records an execution with its tools, retries, tokens, and the model's `report`; a correction in the next turn and a rating on the reply are attached afterwards. The registry's rules turn that evidence into status changes.
- **Tool.** `capability_manage` offers `learn` (when the user asks), `view`, `list`, `update`, `write_file`, `report`, `retire`, and `restore`. None of them asks the user; deletion is left to Settings → Memory.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount it per agent beside a host `capability` registry (the `standard`, `cordis`, and `ptc` presets include it).

| Field | Default | Meaning |
|---|---|---|
| `promptOrder` | `116` | Order of the capability guidance section |
| `maxRecalled` | `3` | Maximum procedures recalled per turn |
| `recallTimeoutMs` | `15000` | Foreground intent-selection deadline |
| `recallMinScore` | `0.8` | Minimum intent relevance score; this score does not measure trust |
| `recallMaxChars` | `6000` | Character limit of the complete advisory context |
| `store` | `memory` | Where learned procedures are kept: `memory` (long-term memory, recalled by memory recall) or `capabilities` (capability files) |
| `learn` | `true` | Whether completed work is learned from automatically |
| `minSteps` | `3` | Tool calls a turn needs before its work is learned from |
| `timeoutMs` | `120000` | Budget of one learning model call |
| `maxOutputTokens` | `16000` | Output limit of one learning model call; a reasoning model spends part of it thinking before it answers |
| `maxInputTokens` | `32000` | Input budget of one learning model call, estimated at four characters per token; a longer transcript is condensed, then cut |
| `consolidateAbove` | `40` | Memory store: distinct procedures a session sees above which procedures of one kind of task are merged in the background; `0` never merges |
| `provider`, `model` | — | Explicit learning route; absent uses each session's route |

## Model Experience

### Capability guidance

#### What the model sees

In owned sessions, learned procedures are untrusted historical reference. The current request takes precedence; procedures never authorize actions, expand the task, or require following steps. Only actual use is reported as evidence. New candidates require deliberate validation before automatic recall.

#### Token effect

The static guidance is included per request in owned sessions; none elsewhere.

#### KV Cache effect

Static per session.

### Procedure recall

#### What the model sees

The consumer appends a durable `<procedure_context>` message containing advisory framing and JSON records with name, revision, status, resource directory, description, and procedure text. Truncated records are marked. A separate selector call sees bounded summaries and returns name/score pairs; only names from the eligible input are accepted. Deliberate reads use `capability_manage` with action `view`, with the same advisory framing.

#### Token effect

The selector uses the learning input/output limits and its own foreground deadline. Recalled text is bounded by `recallMaxChars`; the model may incur this selection call at each direct-user turn with eligible procedures.

#### KV Cache effect

Append-only after the user's message.

### Learning call

#### What the model sees

The learner's model call is a separate request outside the session; the session model never sees it. Its system prompt is fixed text stating what to learn, the sections every written procedure has, and the JSON reply form; its user message is the assembled transcript, holding the turn's request, its timing, its tool calls with their thinking and running seconds and results, the answer, the user's correction or complaint when the work is learned from again, the existing procedure list, and the full procedures of up to two related capabilities (with the memory store, up to 120 listed procedures ranked by memory recall and shared words, and the full text of three). The background merge sends the same route two more kinds of call: one lists up to 150 procedure names and descriptions and asks which are one kind of task, and one sends a group's full procedures, newest first, and asks for the merged procedure. What the call writes reaches a session only when the skill tool loads the capability, as a logged tool result.

#### Token effect

One separate request per learned turn, outside the session's own requests. Its input is bounded by `maxInputTokens`, estimated at four characters per token rather than the provider's own tokenizer and counting the fixed prompt, and its output by `maxOutputTokens`. Past the input budget the learner first shortens every tool call's arguments and result, so the whole run stays visible, then drops the oldest tool calls and names how many it left out, and text still above the budget keeps its beginning and ends with a cut marker, so the newest evidence survives and no request is ever unbounded.

#### KV Cache effect

None for the session: the call is a request the session log does not carry, sent once with its own fixed prompt, so it neither reads nor extends the conversation's reusable prefix.

## Known Limitations and Deferred Work

- **Selection adds latency and cost** — recall uses a model relevance score, not a calibrated confidence estimate. Related-capability lookup in the background learner still uses keyword overlap.
- **Candidates need deliberate validation** — automatic learning stores candidates without making them eligible for recall.
- **Exposure is not use** — execution evidence requires a model report; viewing or ignoring a procedure records no successful use.
- **Instruction precedence is behavioral** — advisory framing does not prove that a model will always reject conflicting historical text; conflict regression tests are deferred.
- **Corrections are recognized by phrasing** — a correction must open with a phrase such as "that's wrong" or "it didn't work" to count against the previous turn.
- **One sample baseline** — the "first time" metrics come from the single turn a capability was learned from.
- **Invariant omission** — No invariant companion is published because the learner owns no durable fact of its own: with `store: memory` a procedure is one memory the long-term memory service supersedes, with `store: capabilities` it is a capability file the registry owns, and an execution becomes evidence through `ctx.capabilities.recordExecution`, so the only learner-held relation is the in-process queue that distills one owner's work at a time.

### Dev Note

None.
