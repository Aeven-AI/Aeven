---
description: "Automatic capability learning: the background learner, recall of learned procedures, execution evidence, and the capability_manage tool."
kind: "package-reference"
---

# @aeven/tool-capability

## Summary

`avn-tool-capability` makes Aeven learn reusable procedures for the session's owner without asking anyone.

- **Learner.** A turn that completed with at least `minSteps` tool calls (skill, capability, memory, and todo bookkeeping excluded), whose last call succeeded, is held until the user's next message. A correction discards it; any other message, `settleMs`, or the session's end releases it. A background model call on the session's route (or the configured `provider`/`model`) then decides to skip it, create a candidate capability, or merge it into an existing one, and writes the procedure with "When to use", "Requirements", "Steps", "Verification", and "Recovery". A new capability records its origin: the request, the tools used, and the turn's duration, tool calls, failures, and tokens as the baseline. Work that followed a learned capability without failures teaches nothing new; its execution is evidence instead. A retired capability is never recreated.
- **Reuse.** At the start of a direct-user turn, executable capabilities whose name, description, or originating request share at least two words with the request are pointed out once per session.
- **Evidence.** Every turn that loaded an executable capability records one execution with its tools, retries, tokens, and the model's `report`; a correction in the next turn and a rating on the reply are attached afterwards. The registry's rules turn that evidence into status changes.
- **Tool.** `capability_manage` offers `learn` (when the user asks), `view`, `list`, `update`, `write_file`, `report`, `retire`, and `restore`. None of them asks the user; deletion is left to Settings → Memory.

## Use this package

Mount it per agent beside a host `capability` registry (the `standard`, `cordis`, and `ptc` presets include it).

| Field | Default | Meaning |
|---|---|---|
| `promptOrder` | `116` | Order of the capability guidance section |
| `maxRecalled` | `3` | Maximum learned procedures pointed out for one request |
| `learn` | `true` | Whether completed work is learned from automatically |
| `minSteps` | `3` | Tool calls a turn needs before its work is learned from |
| `settleMs` | `300000` | Wait for a correction before learning without one |
| `timeoutMs` | `120000` | Budget of one learning model call |
| `maxOutputTokens` | `4000` | Output limit of one learning model call |
| `provider`, `model` | — | Explicit learning route; absent uses each session's route |

## Model Experience

### Capability guidance

#### What the model sees

In sessions with an owner, one system-prompt section: learned capabilities appear in the skill catalog; load a fitting one and follow it; report the outcome and fix wrong steps with `update`; save with `learn` when the user asks; never ask the user whether to save, keep, or update a procedure, and do not announce it.

#### Token effect

About 170 tokens per request in owned sessions; none elsewhere.

#### KV Cache effect

Static per session.

### Procedure recall

#### What the model sees

```text
<learned_procedures>
Procedures learned from earlier work that may fit this request. Load a fitting one with the skill tool and follow it.
- <name>: <description>
</learned_procedures>
```

#### Token effect

Only when a capability matches; at most `maxRecalled` lines, each capability once per session.

#### KV Cache effect

Append-only after the user's message.

### Learning call

The learner's model call is a separate request outside the session; the session model never sees it. What it writes reaches a session only when the skill tool loads the capability, as a logged tool result.

## Known Limitations and Deferred Work

- **Keyword matching** — recall and related-capability lookup match words, not meaning.
- **Corrections are recognized by phrasing** — a correction must open with a phrase such as "that's wrong" or "it didn't work" to count against the previous turn.
- **One sample baseline** — the "first time" metrics come from the single turn a capability was learned from.

## Dev Note

None.
