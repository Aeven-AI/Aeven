# Agent Note: The Turn Rail Marks Every Human Message

Status: implemented

English | [中文](2026-11-11-turn-rail-marks-every-message.zh.md)

## Problem

The Chat turn rail drew one tick per agent turn, built from the `turnOutline` projection, which kept one entry per `turn/start`. Messages a user sent while a turn was running join that turn as steering, so they had no tick. A measured Session with 21 human messages, 17 of them steering turn 1, showed 5 ticks, and the rail did not show what the user had said. Two defects in the same rail were measured in that Session as well. Scrolling to the floor by wheel left the second-to-last mark active, because the reading band only re-resolved the floor case when a row crossed it and the last crossing happened before the floor. The first and last ticks sat on the edges of the rail's pointer box, so a click on the centre or outer half of the last tick hit the slot behind it and did nothing.

## Decision

`turnOutline` folds one entry per human `user/message`. A turn's first message fills the entry opened at `turn/start`, which stays the jump anchor because a window paged through it holds the whole turn. Every later human message in the same turn settles the open entry and opens its own entry, anchored on its own `user/message` seq. Responses go to the open entry, so each entry previews the newest assistant text after its message. The state records `awaitingPrompt` to tell a turn opener waiting for its prompt from a message already placed, and `stateVersion` is 4. The wire value is ordered strictly by seq and non-decreasingly by turn.

The rail keys marks by seq and numbers them by their place in the outline. An opener mark lands on its turn's head as before; a steering mark lands on the row whose `data-chat-anchor-seq` equals its seq, or pages there through event navigation when the row is not loaded. The active mark resolves from the last row in flow order that the reading band reports: the nearest preceding `user` or `steering` row of the same turn picks the newest mark at or before its seq. At the floor the last turn's newest mark is active. Scroll and `scrollend` re-resolve the mark against the floor state, and a navigation's mark holds while the view stays at the offset the navigation landed on. The rail's pointer box extends 8px past both end ticks, and the band fraction clamps there to the end mark.

## Verification

`projection.spec.ts` covers a steering entry anchored on its own seq with the answers after it, empty-text messages as entries, rewinds that drop steering entries, and the seq ordering of served and persisted values. The ui-chat specs pass with message-numbered rail labels. In the measured Session the rail shows 21 ticks after a restart, the floor marks the last message after a wheel scroll, and clicks on the centre of either end tick navigate.

## Alternatives considered

**Derive steering marks on the client from loaded rows.** This needs no projection change, but the rail spans the whole Session, and steering messages outside the loaded window would have no mark until their page arrives, so marks would appear under the reader as history pages in.

**Keep one tick per turn and list steering messages in the hover preview.** This keeps the count low, but a click cannot reach a steering message, which is the navigation the rail exists for.

## Consequences

A long steered turn now contributes many ticks, and sessions reach the 200-mark sampling cap sooner. The wire value grows by one entry per steering message. Rail labels name messages, not turns.
