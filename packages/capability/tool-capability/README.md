---
description: "Automatic learning: the background learner that distills completed work into procedures kept in long-term memory (or, opt-in, capability files), and the capability_manage tool."
kind: "package-reference"
---

# @aeven/tool-capability

## Summary

`avn-tool-capability` makes Aeven learn reusable procedures for the session's owner without asking anyone. With `store: memory` (the default) each learned procedure is one long-term memory: its full Markdown is the stored text and its summary is the procedure condensed, so the memory recall at the start of a turn already carries the steps, and `memory_get` reads the rest. A procedure the work improves replaces the older memory instead of piling up beside it. Nothing is written as a skill or a capability file. With `store: capabilities` the learner writes candidate capabilities instead, recalled as `<procedure_context>`, as described below.

- **Learner.** A turn that completed with at least `minSteps` tool calls (skill, capability, memory, todo, tool-search, and job-output bookkeeping excluded), whose last call succeeded, is learned from as soon as it ends. A background model call on the session's route (or the configured `provider`/`model`) decides to skip it, create a procedure, or merge it into an existing procedure of the same kind of task, and writes it with "Fast path" (the fewest calls and the time sinks to avoid), "When to use", "Requirements" (including the user's stated preferences), "Steps", "Verification", and "Recovery". The call sees each tool call's thinking and running time and the turn's split between thinking and tools, so the fast path cuts what took the time. When the user's next message corrects the turn or complains that it was slow, the same work is learned from again with that message, replacing the procedure it produced. Distillations of one owner run one at a time. A new capability records its origin: the request, the tools used, and the turn's duration, tool calls, failures, and tokens as the baseline. Work that followed a learned capability without failures teaches nothing new; its execution is evidence instead. A retired capability is never recreated.
- **Reuse.** At the start of a direct-user turn, a bounded model call scores eligible procedure summaries by intent, outcome, and constraints. Candidates and retired procedures are excluded. Up to `maxRecalled` matches above `recallMinScore` are read into bounded advisory context; none is returned when nothing qualifies.
- **Evidence.** Only a turn that reports actually using a recalled or deliberately viewed procedure records an execution with its tools, retries, tokens, and the model's `report`; a correction in the next turn and a rating on the reply are attached afterwards. The registry's rules turn that evidence into status changes.
- **Tool.** `capability_manage` offers `learn` (when the user asks), `view`, `list`, `update`, `write_file`, `report`, `retire`, and `restore`. None of them asks the user; deletion is left to Settings → Memory.

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

The learner's model call is a separate request outside the session; the session model never sees it. Its request holds the turn's request, its timing, its tool calls with their timing and results, the answer, the user's correction or complaint when the work is learned from again, the existing procedure list, and the full procedures of up to two related capabilities (three related memories with the memory store). The learner bounds that request with `maxInputTokens`, estimated at four characters per token rather than the provider's own tokenizer: past the budget it first shortens every tool call's arguments and result, so the whole run stays visible, then drops the oldest tool calls and names how many it left out, and text still above the budget keeps its beginning and ends with a cut marker, so the newest evidence survives and no request is ever unbounded. What the call writes reaches a session only when the skill tool loads the capability, as a logged tool result.

## Known Limitations and Deferred Work

- **Selection adds latency and cost** — recall uses a model relevance score, not a calibrated confidence estimate. Related-capability lookup in the background learner still uses keyword overlap.
- **Candidates need deliberate validation** — automatic learning stores candidates without making them eligible for recall.
- **Exposure is not use** — execution evidence requires a model report; viewing or ignoring a procedure records no successful use.
- **Instruction precedence is behavioral** — advisory framing does not prove that a model will always reject conflicting historical text; conflict regression tests are deferred.
- **Corrections are recognized by phrasing** — a correction must open with a phrase such as "that's wrong" or "it didn't work" to count against the previous turn.
- **One sample baseline** — the "first time" metrics come from the single turn a capability was learned from.

## Dev Note

None.
