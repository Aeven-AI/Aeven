# Agent Note: Stop from the agents list

Status: implemented

English | [中文](2026-11-07-subagent-catalog-stop.zh.md)

## Problem

A running agent could be stopped only from its own composer, which meant opening it first. A one-shot agent elects a read-only composer, so it had no Stop anywhere: its only cancellation channel was the delegating tool call's signal, that is, the parent's whole turn.

## Decision

Each running row of the session header's agents list carries an `ActivityRowButton` Stop ([`SubagentHeaderLineage.tsx`](../../../../packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx)). It calls `sessions.interruptSubagent(address)`, which sends `subagents/interruptByParent` with the row's own mode and then refreshes that catalog. The row reads Stopping until the catalog reports the child idle, then Stopped while the list stays mounted, and turns the icon red when the Host refuses.

`interruptByParent` accepts `mode: 'one-shot'` ([`packages/subagent/subagent/src/index.ts`](../../../../packages/subagent/subagent/src/index.ts)). `SubagentRuntime.start()` records each live one-shot run with its parent session id and forgets it when the run settles or is disposed. A one-shot stop checks the parent address, then cancels a local child's turn with `{ kind: 'user' }` or disposes a remote run. The in-process driver then resolves the run `aborted`, and the parent's delegation call returns as it does for a parent-signal cancel. An unknown or settled one-shot is an accepted no-op, as for a continuable target.

## Alternatives considered

**Disposing every one-shot run** lost for local children. Disposal releases the child handle as well as stopping the turn; cancelling the turn leaves teardown to the run's holder, which already owns it.

**Stopping a whole subtree from one row** was deferred. The authority model is one edge down, and a subtree stop needs a Host-side tree operation rather than one call per row.

## Consequences

A Stop ends the current turn only. A continuable child keeps its parked inbox and its own running children, and the parent's own Stop still leaves continuable children running. A one-shot child's partial answer reaches the parent as an `aborted` result.
