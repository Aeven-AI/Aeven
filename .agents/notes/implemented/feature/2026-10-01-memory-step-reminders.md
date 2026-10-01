# Agent Note: Memory reminders before later requests

Status: implemented

English | [中文](2026-10-01-memory-step-reminders.zh.md)

## Problem

Relevant recalled preferences and task lessons can be ignored after they enter a turn. Turn-start delivery alone leaves subsequent requests separated from recalled context by tool output, and guidance describing historical data does not explicitly ask the agent to apply relevant lessons.

## Decision

The existing `memory-context` Consumer performs one provider recall per accepted direct-user turn and retains a bounded reminder in its turn state. Each later accepted pre-step appends that reminder through `decision.messages` as a plugin-sourced `user/message` with form `recall`. The existing session log records the delivered text; no new event type or loop change is required. The system guidance asks the agent to apply relevant remembered preferences and lessons before choosing actions or answering, with the current request taking precedence and memory never authorizing additional work.

Each reminder repeats the complete delivered turn-start block, retaining the existing `contextMaxChars` and item limits without a separate clipping budget. User and project items spend the shared budget before experience and general knowledge. Turn-state disposal at `turn/end` prevents a reminder from leaking into another turn. Recall failure, absence, rejected steps, and cancellation add no reminder. The [memory-provider decision](2026-09-28-long-term-memory-memos.md) and [long-term memory roadmap](../../proposed/feature/2026-09-28-long-term-memory-roadmap.md) retain their independent scope.

## Alternatives considered

- Tool restrictions and execution guards are excluded because the user requires every tool to remain available.
- Recalling at every step adds retrieval latency and repeats provider work without a new user query.
- A smaller reminder budget can drop relevant memories; live validation uses the complete delivered block.
- Promoting learned text into binding policy gives historical conversation and tool output authority they do not possess.

## Consequences

Delivery is reconstructable from the trajectory, and live model runs can demonstrate whether the agent applies remembered preferences. Reminder delivery does not guarantee compliance. Later steering takes precedence without a fresh recall, and reminders accumulate in long turns until compaction. Within-domain ranking, provenance, storage formats, and tool execution remain unchanged. Automated behavioral suites are excluded by the user's requested validation scope; TypeScript, the build, and live browser observations provide the recorded evidence.

## Verification

Live Chrome runs against the rebuilt server at `127.0.0.1:3080` cover three completed turns with 3, 4, and 6 requests. The persisted trajectory contains an identical recalled block before every request within each turn. The first run performs exactly two requested reads. A fresh session retrieves the user's explanation-only preferences through memory tools; its subsequent ordinary question about build commands receives read/search operations and an answer without builds, typechecks, or edits. These observations establish delivery and observed preference use, without attributing a token reduction or a universal compliance guarantee.
