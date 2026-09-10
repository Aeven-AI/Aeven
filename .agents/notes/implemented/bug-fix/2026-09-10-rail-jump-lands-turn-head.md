# Agent Note: Rail Jumps Land the Turn's Earliest Row

Status: implemented

English | [中文](2026-09-10-rail-jump-lands-turn-head.zh.md)

## Problem

Jumping to turn 1 from the Chat turn rail never showed the start of the conversation. In every measured Session the view stopped at `scrollTop = 90`, and turn 1's own `System prompt` row sat entirely above the viewport. A rail item's anchor is the Turn's first loaded user node, and `ChatView` placed that anchor row at the 24px reading line. The renderer can place rows of the same Turn before the user node: the request-prompt Definition anchors a `system-prompt` row at the Turn's start whenever a request shows its system prompt, which always happens for the first request and again when the system prompt changes. The landing therefore clipped the target Turn's own leading rows. For later Turns without such a row, the rows above the anchor belong to earlier Turns and nothing was lost. Both the loaded and the load-and-jump paths ended at the same position, because both land through the same helper.

## Decision

Rail landings resolve the anchor row to its Turn's earliest rendered row before scrolling. `turnHead` walks the anchor's preceding flow siblings while they carry the same `data-chat-turn`, and skips hidden and empty seats because they render no box. That row lands at the reading line. When no rendered row precedes it and the Session has no older history to page (`hasMore` false), the row is the start of the conversation, and the view lands at the scroll origin so the flow's leading space shows as well. The rail item's `anchorKey` is unchanged. It still keys paging anchors, the settle correction, and the outline merge, so only the landing position moves. Content-search navigation keeps landing its exact durable row, because it addresses a message rather than a Turn.

## Verification

`chat-view.client.spec.tsx` jumps to turn 1 of a complete two-Turn transcript whose first Turn carries a System prompt row, and requires `scrollTop` 0. A second case gives turn 2 a System prompt row ahead of its user anchor and requires that row at the reading line. Against the previous landing, the two cases end at 676 and 236 instead of 0 and 176. The existing jump case, whose target is the first loaded row of an incomplete history, still lands at the reading line.

## Alternatives considered

**Anchor the rail item on the Turn's first visible node.** This would move the landing, but `anchorKey` also identifies the row that paging compensation holds during a jump. A System prompt row appears and disappears with prompt changes, and moving the key off the user node would change the navigation projection for every consumer to fix a scroll offset.

**Special-case turn 1 by clamping to the origin.** This fixes the reported symptom but still clips leading rows of any later Turn whose system prompt changed.

## Consequences

A jump to any Turn shows the Turn's leading rows, and a jump to turn 1 of a fully paged Session matches scrolling to the top by hand. A jump whose target is the head of a window that still has older history lands that head at the reading line, as before.
