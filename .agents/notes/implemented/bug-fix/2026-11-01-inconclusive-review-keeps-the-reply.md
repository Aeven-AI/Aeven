# Agent Note: A self-check that produces no verdict keeps the reply

Status: implemented

English | [中文](2026-11-01-inconclusive-review-keeps-the-reply.zh.md)

## Problem

`turn-review` runs one auxiliary model call when a turn stops, and when that call failed — a truncated verdict, a request for a tool, a transport error, a timeout — the plugin failed the whole turn whenever an earlier round had recorded findings. The reader saw a generic "Aeven couldn't finish this reply. Please try again." for a reply that was already written, and retrying reproduced it: across sixty sessions the turn failed sixteen times, twelve of them on `review output reached maxOutputTokens`.

The failure was attributed to the reply, but it happened in the reviewer. A truncated review says nothing about the work being reviewed.

## Decision

A review call that produces no verdict appends `turn-review/failure` with the reason, logs a warning, and returns: the turn keeps the answer it already has and ends normally. Cancellation still propagates, and a turn whose findings persist after `maxReviewsPerTurn` still fails, now with `TURN_REVIEW_UNRESOLVED` so the client can say that Aeven's own check held the reply back instead of showing a generic error.

The reviewer is also told to name at most five issues, each under 200 characters, and to quote no tool output. That keeps a verdict inside the existing `maxOutputTokens: 4000` cap — measured truncation came from long prose, not from a budget that was set too small — and keeps the findings readable as a list of what to fix.

## Alternatives considered

**Raise `maxOutputTokens` to 12000** — it moves the failure threshold rather than the attribution, and every recorded scenario pins the request's `maxTokens`, so eleven fixtures would have to be re-derived for no change in what a reader sees when the cap is still hit.

**Treat every failed review as a failed turn** — that is the behaviour being removed: it tells the reader the reply failed when only the check did.

**Retry the review call** — a retry that succeeds hides a reviewer that repeatedly cannot answer, and it delays the reply the reader is waiting for.

## Consequences

A broken or overloaded reviewer costs a warning and a `turn-review/failure` record, never the user's reply. The remaining fatal path is a genuine unresolved finding after the review rounds are spent, and it now carries its own code and its own copy.

Unreviewed turns are observable rather than silent: every failure is logged and durable, so a reviewer that stops answering is visible in the session log even though it no longer interrupts anyone.
