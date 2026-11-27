# Agent Note: Goal and command inputs on synced copies

Status: implemented

English | [中文](2026-11-27-goal-and-command-inputs-on-synced-copies.zh.md)

## Problem

On 2026-11-27 clearing a goal on chat.aeven.io failed with `session/agent-busy`: "session … is replicated from another device; fork it to continue". The conversation ran on the user's desktop, so the hosted Host held a read-only synced copy of it. `goals.clear` and the other goal Remote methods, and `commands.execute`, took an `Agent` parameter, which the Typert `agent` lookup resolves by resuming the Session; resuming a synced copy throws `SessionPersistenceReadOnlyError`. Prompts, edits, retries, queue changes, cancellation, model selection, and renames did not fail, because the Session Controller claims the Session or forwards the input to the device that writes it before it resolves the Agent. The task list was not affected: only the model changes it, inside a turn that a prompt starts.

## Decision

The Session Controller owns two more routed inputs, `session.goal` and `session.command`, and they are the only client entries for goal changes and slash-command lines. Pausing, completing, and clearing a goal take the change route of a model selection: claim the Session and write here, or forward to the device that runs a turn of it. Creating, editing, and resuming a goal and running a command line can start turns, so they take the route of a prompt: the Session's home device first, else a local claim. Every local apply ends with `endChange`, which gives back the runner lease when no turn runs; a goal round that starts afterwards claims the Session again in `agent/pre-step`. A forwarded input is applied by the receiving Session Controller through the `goal` and `command` cases of its forwarded-input switch. `GoalService` no longer has Remote methods, and `commands.execute` is no longer a Remote method, so no client path resolves an Agent for these inputs without routing.

## Alternatives considered

**Claiming inside the Typert `agent` lookup** was rejected: the lookup receives only the Session id, so reads such as the `@` file picker would claim a Session that another device runs, and a goal round armed this way would run on the hosted Host rather than on the desktop. **Typert method metadata that marks writing endpoints** would need generator and registry changes for one routing rule. **Keeping the old goal Remote methods next to the routed verb** would leave a second path that fails on synced copies.

## Consequences

A forwarded command reports no execution to the client; its logged `command/run` and `command/done` events render the outcome. A desktop on a build without the `goal` and `command` cases declines the forwarded input, and the always-on device applies it after the input fallback. The agent-preset switch, the browser open action, Cordis panel actions, and the `@` file and session pickers still resolve an Agent through the lookup and fail on a synced copy; none of them changed here.
