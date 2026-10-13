# Agent Note: An open Turn's process control is openable

Status: implemented

English | [中文](2026-10-12-open-turn-process-openable.zh.md)

## Problem

In Compact mode the Turn-process control carries a running Turn's elapsed counter (`Ævening for …`) while the Turn's process rows, including the reasoning it streams, wait behind that same control. The control accepted a click only once the projection could place an eligible row inside `[processStartSeq, answerAnchorSeq)`. During the stage where the model was already reasoning but no eligible row had landed yet, the reader saw a live counter on a disabled row: the reasoning could not be unfolded, and the row became clickable only later, when a row or the final answer boundary arrived. `hasContent` gated the click on content that a running Turn cannot yet place, so the withheld reasoning sat behind a control the reader could not open.

## Decision

An open Turn's control is always openable. `ChatNodeSeat.openable` is true whenever the Turn is open: its process rows and its streamed reasoning wait behind the control, and only the closed Turn's projection knows which of them it keeps. A closed Turn stays openable only when it holds process rows (`hasExternalProcess`) or its Answer Step's reasoning (`inlineReasoning`). The disabled state, the chevron, and `aria-expanded` all read that one value, so nothing is withheld behind a control the reader cannot open. Opening before any row lands keeps the group open, and the reasoning that arrives next is revealed without a second gesture. While the Turn is open and `holdsProcess` is still false, the opened disclosure renders the row that will hold the trace — a running Think row — so an opened group is never blank during the model's prefill, and it gives way to the projected row the moment one lands. That stand-in occupies the box the projected row lands in: it takes the chat column's work-row gap, the same one a reasoning-only Step's flow item carries, so the Think row does not move as the first token arrives.

The [Turn-process folding decision](../feature/2026-08-14-web-turn-process-folding.md) continues to own membership, the final-answer boundary, completion collapse, persistence, focus, and pagination behavior; this note changes only when the control accepts a click.

## Alternatives considered

**Keep the control disabled until an eligible row exists.** Rejected: that is the reported defect. The reader watches a live elapsed counter while the reasoning the same row withholds cannot be unfolded.

**Keep a running Turn's reasoning visible instead of withheld.** Rejected because the disclosure owns the Turn's whole process: exempting one running Step's trace would show part of a group the control claims to hold, and it would leave the trace out of view at `turn/end` when the answer boundary starts to withhold it — the same collapse-then-reveal discontinuity the folding decision rejected for live answer candidates.

**Gate the click on the running Step's own reasoning.** Rejected: the control's Seat would have to scan the Turn, or the projection would mirror `AssistantNodeView`'s hiding rule and the two copies could disagree. The open-Turn rule needs no new cross-Node fact.

## Consequences

A running Turn's control renders enabled with a chevron from the moment it appears, so a reader can open the Turn's work before anything lands; streamed reasoning and Tool rows then appear without another click. Turn completion still collapses the group, because manual expansion belongs to the answer-Step generation it was made in. Render coverage pins an open Turn with no eligible row yet — the control accepts the click and the reasoning that arrives afterwards is revealed. `ChatView.module.css` owns that shared gap once, on the message column as `--avn-chat-work-row-gap`, and the stand-in reads the same value; jsdom has no layout, so `packages/client/ui-chat/tests/chat-trace-row-styles.client.spec.ts` pins the declarations that keep the row still. The `packages/client/ui-chat` render fixture still derives `TurnProcessSpec` itself, so states whose process window differs from production are not reproducible there.
