# Agent Note: Subagent tree coordination

Status: implemented

English | [中文](2026-11-04-subagent-tree-coordination.zh.md)

## Problem

Delegated work can require communication between siblings or with a deeper descendant. Direct-parent messaging forces intermediates to relay messages and remain online. Unbounded child startup can exhaust model and Host resources, while polling agent lists spends requests without waiting for useful input.

## Decision

The existing continuation manager routes model-authored messages throughout one tree. Each Activation captures its exact live root. Cold delivery validates persisted subagent ancestry, restores only the target, preserves its durable parent, and attributes input to the actual sender. Ordinary forks form independent roots. Browser Queue delivery retains direct-parent authorization; interruption retains ancestor authorization.

One service-owned capacity pool counts continuable startup, residency, and teardown alongside one-shot runs until their callers dispose them. The root consumes no slot. Admission fails rather than queues, and rollback and disposal release slots. The default and base bundle limit are 16 to accommodate the reported 15-child workload.

`list_agents` presents the root and continuable members to every managed caller. `wait_agent` observes next-step input without consuming it or starting another agent, and removes its timer and subscriptions on every exit. Existing relay presentation displays the sender session id.

Tree-wide model authority and discovery supersede the direct-only portions of [continuable conversations](2026-07-28-continuable-subagent-conversations.md) and [durable discovery](2026-07-22-durable-subagent-catalog-and-list-agents.md). Those notes retain descriptor, lifecycle, and read-path rationale. Child composition, provider interfaces, worktrees, nesting policy, and the current UI remain independently owned; the [shared task board](2026-11-04-shared-task-board.md) builds on this tree identity.

## Alternatives considered

Replacing the complete upstream runtime imports child-preset selection and unrelated session changes. Extending the current manager preserves the existing providers and composition. Relaying through creators couples delivery to their residency. Queueing at capacity can deadlock an ancestor that occupies a slot while awaiting descendants.

## Consequences

Siblings can exchange messages but cannot interrupt each other. A live root remains necessary, and capacity is process-local. Stored sessions consume no slots. One-shot callers retain responsibility for disposal. No new UI controls or panels accompany coordination.

## Verification

Focused runtime tests cover sibling attribution, unrelated-tree rejection, target-only cold restoration, nested and one-shot capacity, and slot reuse. Tool tests cover pending input, steering, cancellation, and unload. Recorded SDK sessions pin discovery and the assembled control schemas.
