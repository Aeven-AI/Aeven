# Agent Note: a message to a subagent loads its parent

Status: implemented

English | [中文](2026-11-18-subagent-messages-load-their-parent.zh.md)

## Problem

`subagent.prompt` accepted a browser message only while the child's direct parent Agent was live, and the catalog's `parentAvailable` reported exactly that. A Host loads a Session's Agent when someone sends that Session a message, not when a browser shows it, so after every Host start each continuable child of an unopened parent showed "This subagent is read-only for now — The parent session is offline; reopen it to continue sending messages". Opening the parent did not change this, so the copy named an action that did not help.

## Decision

- `SubagentRuntime.registerPromptPreparer(preparer)` takes one effect-scoped preparer that routes each browser message to a continuable child: `local` with the live parent, `forwarded` to another device of the account, or `unavailable`. `subagent.prompt` calls it for every message; a local message then passes the existing ownership check and delivery, and a forwarded one returns a receipt without `messageId`.
- `@aeven/api-session-controller` registers the preparer as `SessionCommandController.prepareSubagentPrompt()`, routed by the parent like a prompt to the parent. On Æven Cloud a chat runs on the user's desktop, so when another device runs the parent it forwards the message through the account inbox as the `subagent-prompt` operation, which that device applies with `subagents.prompt()`; a device that does not know the operation refuses it, and the input fallback runs it where it was sent. When this device runs the parent, it claims the child's Session: after a Host start every Session, the child's included, is a read-only synced copy until this device claims it, and resuming an unclaimed child fails as `subagent/not-resumable`. The parent is claimed and loaded with the same ownership rules, preset, and setup as a message sent to the parent itself. A child another device runs while this one runs the parent, or a parent the Session API cannot load, such as one owned by another account or itself a subagent, answers `subagent/parent-unavailable`, and the Host logs the reason.
- With a preparer registered, the catalog reports `parentAvailable: true` for every parent, so a continuable child always shows the regular composer. The read-only composer remains for one-shot children and for deployments without a preparer.

## Alternatives considered

- **Load the parent when its child's thread opens.** Rejected: every view of a child would load a Session the reader may never message.
- **Only reword the banner.** Rejected: the reader would still have to send a message elsewhere before replying to the child.
- **Call the Session API from `@aeven/subagent` directly.** Not possible: `@aeven/api-session-controller` already depends on `@aeven/subagent`, so the dependency runs through a registration instead.

## Consequences

The first message to a child of an unloaded parent waits for the parent's Agent to load. A send to a child whose parent cannot be loaded fails through the composer's ordinary error behavior instead of being blocked in advance. A parent's model-authored `send_message` to a child that is not live takes no claim, so it does not gain this behavior.
