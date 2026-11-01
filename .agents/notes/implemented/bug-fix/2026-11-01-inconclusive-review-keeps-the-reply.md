# Agent Note: A self-check that produces no verdict keeps the reply

Status: implemented

English | [中文](2026-11-01-inconclusive-review-keeps-the-reply.zh.md)

## Problem

`turn-review` runs one auxiliary model call when a turn stops, and when that call failed — a truncated verdict, a request for a tool, a transport error, a timeout — the plugin failed the whole turn whenever an earlier round had recorded findings. The reader saw a generic "Aeven couldn't finish this reply. Please try again." for a reply that was already written, and retrying reproduced it: across sixty sessions the turn failed sixteen times, twelve of them on `review output reached maxOutputTokens`.

The failure was attributed to the reply, but it happened in the reviewer. A truncated review says nothing about the work being reviewed.

## Decision

A review call that produces no verdict appends `turn-review/failure` with the reason, logs a warning, and returns: the turn keeps the answer it already has and ends normally. Cancellation still propagates. A turn whose findings persist after `maxReviewsPerTurn` records the same failure with the unresolved findings and also ends with its reply, so no review outcome can fail a turn at all.

The reviewer is also told to name at most five issues, each under 200 characters, and to quote no tool output. That keeps a verdict readable as a list of what to fix.

Finally, the review call requests `reviewReasoningEffort` (default `low`) instead of inheriting the route's default effort. Thinking is what carried the verdict to `maxOutputTokens`: `llm-aeven` defaults to `high`, the cap bounds completion including reasoning, and a sixty-thousand-character transcript gives a reviewer plenty to deliberate about before it writes four words of JSON. The effort is resolved against the route's own reasoning metadata and dropped when the route does not advertise it, so an unusual route runs the review on its default rather than failing it — a request that names an unsupported effort is rejected by the service.

## Alternatives considered

**Raise `maxOutputTokens` to 12000** — it moves the failure threshold rather than the cause, and every recorded scenario pins the request's `maxTokens`, so eleven fixtures would have to be re-derived for no change in what a reader sees when the cap is still hit. Bounding the effort spends fewer tokens than raising the cap.

**Treat every failed review as a failed turn** — that is the behaviour being removed: it tells the reader the reply failed when only the check did.

**Retry the review call** — a retry that succeeds hides a reviewer that repeatedly cannot answer, and it delays the reply the reader is waiting for.

## Consequences

A broken or overloaded reviewer costs a warning and a `turn-review/failure` record, never the user's reply, and neither does a finding the turn could not settle within its rounds. What remains is the part that helps: a finding arrives as a steering message while rounds are left, and the agent can still fix what it missed.

Unreviewed turns are observable rather than silent: every failure is logged and durable, so a reviewer that stops answering is visible in the session log even though it no longer interrupts anyone.
