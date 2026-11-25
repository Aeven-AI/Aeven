# Agent Note: synced sessions did not show their todo list on other devices

Status: implemented

English | [中文](2026-11-25-synced-sessions-project-todos-and-plan.zh.md)

## Problem

On 2026-11-25 a desktop conversation (`session-45df5e4a…`) wrote its todo list three times, and the desktop dock showed it. The same conversation opened on chat.aeven.io showed no dock at all. Aeven Web holds that conversation as a synced copy: events arrive through session sync and `session-persistence/append`, and no agent runs it there. Two faults kept the projected state from reaching the browser.

- `session-handoff/imported` rebuilt the list summary, which carries every projection value, and emitted `api-session/added` without the session owner. The forwarded-event audience resolves an owner from a live Session or an earlier owner-tagged `api-session/added`; a synced copy has neither after a Host restart, and a Host that enforces accounts delivers an event with an unknown owner to no one. Every update to the todo list, goal, plan, and title of a conversation running elsewhere was dropped.
- The projection table is process-wide, and `todos` and `plan` were registered only by the `tool-todo` and `plan-mode` rows of the agent preset. A Host following a synced copy has no agent for it, so those keys existed only while some other agent happened to be mounted, and the opening snapshot and every rebuilt summary omitted them otherwise. Goals already reached other devices once delivered, because `goal` stays on the Host plane.

## Decision

- The import handler emits `api-session/added` with the owner the import names.
- `@aeven/tool-todo/projection` and `@aeven/plan-mode/projection` register the `todos` and `plan` units by themselves, and the Web bundle mounts both on the Host plane. The preset rows still register the same definitions; registrations of one key share one reference-counted unit.
- Approvals and questions already reach every device through the session controller's interaction relay and are unchanged.

## Alternatives considered

- **Mount `tool-todo` and `plan-mode` on the Host plane.** Rejected: both register model-facing tools, prompt sections, and step listeners that belong to the agents whose preset mounts them.
- **Push projection frames from the follow stream for imported events.** Rejected: the import handler already folds the whole projection table for the list summary, and the client applies summary projections under the same higher-seq-wins rule, so a second path would duplicate it.

## Consequences

Every client-visible projection a Host-plane plugin registers now follows a conversation onto the account's other devices as each synced batch lands. A projection registered only from a preset still reaches other devices only while that preset is mounted on the following Host, and the same Host-plane split applies to it. The todo list's content still depends on the model calling `todo_write`; the conversation above went 27 tool calls without a write after two staleness notices.
