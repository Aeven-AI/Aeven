# Agent Note: Session activation starts Chat at the live tail

Status: implemented

English | [中文](2026-09-08-session-activation-chat-tail.zh.md)

## Problem

Chat stores a semantic reading position per Session so switching to another view and returning to Chat preserves the reader's place. The same map also survived an A → B → A Session switch. A stale position could therefore detach a revisited transcript from its live tail and show Back to bottom even when the reader had left both Sessions at the end. Content-search navigation has a different destination: it must reveal the indexed event instead of the tail.

## Decision

The Chat plugin observes the Session Controller's current selection. When the selected Session identity changes, it deletes the destination Session's saved Chat position unless `uiConversation` already holds a pending event-navigation request for that Session. The remounted Chat view consequently reads no saved position and claims the live tail, then reapplies that tail position on the next animation frame after the resident shell's composer has settled. Content search publishes its event request before selecting the Session, so Chat retains that navigation and lands the exact event after its row commits without scheduling the tail correction. A view switch inside the same Session does not change the selected identity and continues to restore the semantic anchor defined by the [tool-row and Inspect decision](../feature/2026-07-30-web-tool-row-unified-expand-and-inspect.md).

## Alternatives considered

**Remove Chat scroll memory on every remount.** Rejected because switching from Chat to Trajectory and back inside one Session must preserve the reader's place.

**Clear positions only in sidebar row click handlers.** Rejected because address navigation, browser Back and Forward, breadcrumbs, and other Session selectors reach the same Session Controller state without sharing that handler.

**Send every Session switch to the tail.** Rejected because a content-search result owns an exact durable event destination; tail navigation would discard the result the reader selected.

## Consequences

Ordinary Session navigation starts Chat at the latest loaded content, including revisiting a Session whose last scroll sample retained an older anchor. Content-search navigation keeps its event destination. Scroll memory is limited to remounts that do not change the selected Session, and the policy depends on content search publishing `navigateToEvent` before `sessions.open`.
