# Agent Note: Pointer Send follows the busy-Enter preference

Status: implemented

English | [中文](2026-11-19-pointer-send-follows-busy-enter.zh.md)

## Problem

During a running Turn the ordinary composer's primary button becomes Send when the draft has content ([running drafts take the primary Send action](2026-08-20-running-draft-primary-send.md)). That button always used the Queue path, while plain Enter used the `ui-conversation.busyEnter` preference, which defaults to Steer. Each queued message waits for its own Turn, so a person who sends several follow-ups with the button during a long Turn gets replies to messages they sent minutes earlier. Session `08b945fd…` on 2026-11-19 shows this: nine button sends queued behind one another, and the reply to "THEN SHARE!!!" started 40 s after it was sent, behind three older messages, although the account's preference was Steer.

## Decision

`InputBar` submits the Send button through the same `resolveSubmitMode(running, 'enter', subagent === null)` call as plain Enter, so the button delivers by Queue or Steer according to `busyEnter`, and the Cmd/Ctrl chord keeps the other mode. Sessions without steering support (subagent continuations) still queue, because `resolveSubmitMode` returns Queue when steering is unavailable. This replaces the earlier rule that pointer Send never inherits the keyboard preference; the Stop/Send seat switching from the earlier note is unchanged.

## Verification

`input-bar.client.spec.tsx` covers a running draft sent with the button under the Steer preference (delivered as Steer) and an attachment-only draft under the Queue preference (delivered as Queue). The keyless Web scenario in `apps/web/tests/live-interactions.e2e.ts` that queues a follow-up during a hung stream seeds `busyEnter: queue` in its harness home so the click still reaches the queue dock.

## Alternatives considered

**Keep pointer Send on Queue.** This is the behavior that produced the backlog above; the person's Steer preference had no effect on the control they used.

**Show separate Queue and Steer buttons.** This spends composer space on a choice the person already made in Settings, and the chord already offers the other mode to keyboard users.

## Consequences

With the default Steer preference, a follow-up sent with the button joins the running Turn at its next step instead of waiting for its own Turn. People who prefer Queue set `busyEnter: queue`, and both the button and Enter then queue.
