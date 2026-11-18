# Agent Note: a message to a subagent loads its parent

Status: implemented

English | [中文](2026-11-18-subagent-messages-load-their-parent.zh.md)

## Problem

`subagent.prompt` accepted a browser message only while the child's direct parent Agent was live, and the catalog's `parentAvailable` reported exactly that. A Host loads a Session's Agent when someone sends that Session a message, not when a browser shows it, so after every Host start each continuable child of an unopened parent showed "This subagent is read-only for now — The parent session is offline; reopen it to continue sending messages". Opening the parent did not change this, so the copy named an action that did not help.

## Decision

- `SubagentRuntime.registerPromptPreparer(preparer)` takes one effect-scoped preparer that makes a browser message to a continuable child deliverable on this device and returns the live parent. `subagent.prompt` calls it for every message, then applies the existing ownership check and delivery.
- `@aeven/api-session-controller` registers the preparer. It first claims the child's Session with `SessionCommandController.claimSession()`: after a Host start every Session, the child's included, is a read-only synced copy until this device claims it, and resuming an unclaimed child fails as `subagent/not-resumable`. It then returns the live parent, or loads it with `claimAgent()`, which claims the parent and loads it with the same ownership rules, preset, and setup as a message sent to the parent itself. A child or parent another device of the account runs, or a parent the Session API cannot load, such as one owned by another account or itself a subagent, answers `subagent/parent-unavailable`, and the Host logs the reason.
- With a preparer registered, the catalog reports `parentAvailable: true` for every parent, so a continuable child always shows the regular composer. The read-only composer remains for one-shot children and for deployments without a preparer.

## Alternatives considered

- **Load the parent when its child's thread opens.** Rejected: every view of a child would load a Session the reader may never message.
- **Only reword the banner.** Rejected: the reader would still have to send a message elsewhere before replying to the child.
- **Call the Session API from `@aeven/subagent` directly.** Not possible: `@aeven/api-session-controller` already depends on `@aeven/subagent`, so the dependency runs through a registration instead.

## Consequences

The first message to a child of an unloaded parent waits for the parent's Agent to load. A send to a child whose parent cannot be loaded fails through the composer's ordinary error behavior instead of being blocked in advance. A parent's model-authored `send_message` to a child that is not live takes no claim, so it does not gain this behavior.
