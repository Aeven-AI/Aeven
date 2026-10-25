# Agent Note: Learning from evidence

Status: proposed

English | [中文](2026-10-25-learning-from-evidence.zh.md)

## Problem

Aeven's learner writes procedures from completed work, but several of its decisions rest on weak evidence. A recalled `candidate` becomes `active` when the turn it was recalled into called any tool and the next message was no correction, so a procedure the turn never followed is promoted. A procedure's "Recovery" advice reaches the model only at turn start, inside a summary clipped to 950 characters, not when the matching failure happens. A rule the user states in prose, such as "no code changes", is advice the model can skip. The learner reads tool calls clipped to between 80 and 1,500 characters, so the error text and facts it should record are often cut before it sees them.

## Proposal

Each item below ships behind its own `Config` switch, off by default, and is turned on only after the acceptance criteria hold.

- **Promote by use** (`@aeven/memory-context`). A recalled candidate becomes `active` only when the turn's tool-call arguments contain a command, path, or quoted name that the procedure's summary gives. A procedure whose summary gives none stays `candidate` and ages out through `candidateTtlDays`.
- **Recovery at the failure** (`@aeven/tool-capability`). When a tool call fails, its error text is matched against the "Recovery" entries of the owner's learned procedures, and a matching fix is appended to that tool result. Matching is text comparison on failed results only, with no model call.
- **Read-only turns** (guard). A request the user marks as making no changes runs with write tools refused by the executor, instead of relying on an invariant.
- **Screenshots in the reply** (turn review). A turn that captured images and whose reply embeds none receives one reminder before it ends.
- **Complete learning input** (`@aeven/tool-capability`). The learner reads untruncated tool output from the session log within its input budget, keeping error text and the values the work found.

## Alternatives considered

**Shipping these on by default** changes promotion, tool results, and turn endings before anyone has measured them. **Recalling every procedure in full at turn start** carries recovery advice without a hook, but grows every request. **Running several attempts per request and choosing one** gives contrastive evidence directly, but multiplies cost and latency for every turn.

## Acceptance criteria

`scripts/benchmark-learning.ts` mounts memory in its learning condition and detects recall from `<memory_context>`. With a switch on, the benchmark shows equal or better correctness and equal or lower median time, tool calls, and tokens on runs two and later than with it off, on both the `release` and `inventory` tasks. Promote by use additionally keeps the share of recalled procedures that reach `active` within the share that a manual review of the same sessions judges as actually followed.

## Risks

Promote by use can strand useful procedures whose summaries name no concrete command, which then age out. Recovery hints can match the wrong procedure and steer a retry the wrong way. A read-only turn misread from the request blocks work the user wanted. Complete learning input spends more background tokens per distillation.
