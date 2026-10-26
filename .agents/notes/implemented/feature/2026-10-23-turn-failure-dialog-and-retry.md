# Agent Note: Turn failure dialog and retry

Status: implemented

English | [中文](2026-10-23-turn-failure-dialog-and-retry.zh.md)

## Problem

A turn that ended in a terminal failure printed one inline row in the transcript: a generic title, the provider's message, and the failure code — `AUTH`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE` — in a `<code>` element. The code is the gateway's vocabulary, not something a person can act on, and the row offered no way to continue the turn. The failed turn also stayed in the transcript, so the person's next attempt read below a record of the failure.

## Decision

`TurnErrorNodeView` in `packages/client/ui-chat/src/client/chat/MessageItem.tsx` opens `TurnErrorDialog` for the latest turn's terminal failure instead of rendering a row. `turnFailureKind` groups the recorded `turn/end` code into one of six copy groups — quota (`QUOTA`), context too long (`CONTEXT_WINDOW_EXCEEDED`, `MESSAGE_COUNT_EXCEEDED`), signed out (`AUTH`, `MISSING_CREDENTIAL`, `INVALID_CREDENTIAL`), busy (`RATE_LIMIT`, `RATE_LIMITED`, `CONCURRENCY_LIMITED`), connection (`TRANSPORT`, `TIMEOUT`, `SERVER`, `INTERNAL`, `PROVIDER_ERROR`, `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`), and other for every remaining or absent code — and `TURN_FAILURE_COPY` names the title and body keys of that group in the locale dictionary.

The dialog carries three actions. Dismiss closes it and records the failure key, which is the node key, sequence, and time, in a module-level set consulted at mount, so a dismissed failure stays dismissed for the page's lifetime and returns after a reload. Retry calls `retryTurn`, which reaches the Host's `sessionController.retry` command; the Host checks that the Session's latest turn ended in an `error` with no later turn or rewind, then admits a `notice`-form message from `api-session-controller` as the next turn, telling the model that the recorded work stands and to continue from where it stopped. Nothing is rewound, so the failed turn's transcript, model history, and file changes stay. Retry is offered only when the owner supplies `retryTurn`; a refusal from the Host leaves the dialog open for another attempt. A quota failure adds a button that closes the dialog and calls `openPlans`, which `apply.ts` wires to `settings/open` for the `account` section, and the retried request then uses the plan chosen there.

Only the latest turn's failure shows: `TurnErrorNodeView` renders nothing when the node's turn is not the last in the timeline, because a later turn already answered it. The failure code remains recorded on the `turn/end` event; the dialog does not display it.

## Alternatives considered

**Keep the inline row with the failure code.** The code names the transport's classification rather than the situation the reader is in, and the row carried no retry, so the person had to retype the request from memory while the failed turn stayed visible.

**Retry by re-running the prompt through `editMessage`.** The edit rewinds to the failed turn's `turn/start`, which discards every completed step of that turn: a 135-step turn that failed on its last request lost its whole transcript on retry, while its file edits stayed on disk and the re-run started over on already changed files.

**Retry by sending the same prompt again as a new message.** The transcript would hold two copies of the request, and the model would repeat finished work.

**Offer the plan picker on every failure group.** A connection failure or a signed-out session is fixed by retrying or signing in, and a plan change does not affect either; the button appears with the quota copy, which names the remedy.

## Consequences

- The transcript no longer prints a failure code; the structured code stays on the durable `turn/end` event for the log and for any later reader.
- A failure the person dismissed stays hidden until the page reloads, and a failure from a turn the conversation has moved past never opens.
- A transcript with `retryTurn` omitted offers Dismiss alone, and a host without `openPlans` offers no plan button.
- The dialog is modal, so the composer behind it is unavailable until the person dismisses it, retries, or opens the plans.
- The copy is locale-owned: six title/body pairs and the `turnError.plans`, `turnError.retry`, `turnError.dismiss`, and `turnError.close` labels in the English, Chinese, and Spanish dictionaries.
- `packages/client/ui-chat/tests/chat-view.client.spec.tsx` pins the copy group of each code, the dialog's title and body, the plan button's absence outside quota, the retry call through `retryTurn` without an edit, the plan picker call after the dialog closes, dismissal, and the suppression of a past turn's failure.
