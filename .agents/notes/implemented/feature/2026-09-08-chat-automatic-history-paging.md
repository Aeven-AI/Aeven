# Agent Note: Chat pages history by approach, not by button

Status: implemented

English | [中文](2026-09-08-chat-automatic-history-paging.zh.md)

## Problem

Reaching older Chat history required clicking `Load earlier` once per page. Every page cost a deliberate gesture, the control appeared and disappeared inside the transcript flow, and its unmount moved the rows the prepend compensation was holding — the rail jump had to pin its target row specifically to survive that. The Turn rail compounded the same split: unloaded marks rendered 8px wide against a loaded mark's 12px, so the ladder read as two scales rather than one session.

## Decision

Approaching the window head is the request. A latest-ref test runs from the raw scroll handler, the paging settle, the activation tail, and the flow `ResizeObserver`; it pulls the next older page when `scrollTop` is within `max(clientHeight * 2, 600)` of the head, and fills a window whose content does not scroll at all so a short tail page still leaves history reachable. The runway is viewport-relative because a fixed distance is a shrinking fraction of a taller window, and a fast fling then reaches the head before its page arrives. `scrollHeight` is read only after the cheap `scrollTop` comparison, since it forces layout of the whole transcript.

`loadOlder` reports failure by swallowing it and leaving `hasMore` set, so a settled pull that moved no window head is the only failure signal available. That latches automatic paging off and puts `Load earlier` back as the reader's retry, which re-arms it. Only a `loadingOlder` true-to-false edge counts as a settle: the effect also runs on mount, where consuming the outstanding record would judge a request that has not returned.

The head boundary became a zero-height sticky overlay — the back-to-bottom pattern — carrying the Trajectory history spinner (`TrajectoryTable .historyLoadingSpinner`). Nothing about it enters flow, so neither its appearance, its swap to the retry control, nor its removal at history exhaustion changes transcript geometry. Unloaded rail marks keep a loaded mark's width and carry dimming alone.

Separately, nothing that must hold still may live inside the scrollport. An elastic overscroll translates a scroller's contents past either end, and `position: sticky` does not exempt a box from that — it moves with the contents it sticks within, which is why the composer seat, the Turn rail, the paging boundary and back-to-bottom all rode the rubber-band while the Session header never did. Suppressing the bounce with `overscroll-behavior` was tried first and rejected: it removes the reader's scroll feel to fix a positioning fault, and `contain` does not remove the local bounce at all.

The composer seat moved out of the scrollport to become a flex sibling below it, docked by order. ConversationRoot publishes a non-scrolling overlay layer beside it (`[data-conversation-chrome]`), carrying the transcript's side inset plus the scrollport's reserved gutter, and Chat portals its floating controls into it. The Turn rail additionally takes `position: fixed`: every ancestor inside a scroller is translated by the overscroll, so only the viewport is a stable reference — it gives back the details column (`--avn-frame-details-width`, published by AppFrame) and the scrollbar gutter. Back-to-bottom's composer clearance is keyed off the chrome layer rather than the scrollport it used to sit in, and its visibility moved to the per-frame active-Turn sync, which already measures the same floor comparison; leaving it on the throttled sample made the control appear and disappear up to a sample interval late.

Two ChatView reads followed the seat out: the paging anchor no longer subtracts a composer overlapping the scrollport (its floor is the last visible line), and the flow observer finds the seat as a sibling. It must never observe the scrollport itself — that callback writes `scrollTop`, and doing so on the scroller's own resize flattens the very bounce this change preserves.

## Alternatives considered

**`IntersectionObserver` on a head sentinel.** Rejected because an observer that stays continuously intersecting never re-notifies, so the settle-driven chain is required anyway; scroll geometry also keeps working when the enclosing `[data-conversation-scroll]` host owns scrolling, and it is testable under jsdom.

**Cap consecutive automatic pulls.** Rejected because `hasMore` is the stop condition the data already carries; a cap invents a limit and hands the reader back a control they dismissed by scrolling. Fully paging a long session was already reachable through a rail jump to turn 1.

**Keep the fixed-height in-flow boundary.** Rejected because it still moves content when history completes and the row unmounts. An overlay removes the class of problem rather than one instance of it.

## Consequences

Reading backwards is continuous, and paging cost moves from one gesture per page to none. Full materialization of a long transcript is now reachable by holding a scroll gesture; the render is not windowed, so `order` takes a new identity per page and `ChatNodeList` re-creates every element (memoized seats skip their subtrees). Windowing the render, not further memoization, is the lever if that becomes the limit. `PAGE_MESSAGES` stays at 50; raising it would cut the number of prepend compensations per unit of scrolling and is the next thing to try if fling smoothness needs more.

Coverage: ui-chat specs for the fill-on-open, margin threshold, in-flight suppression, stall latch and its manual retry, the settle chain, and jump ownership of the pager; a ui-conversation CSS spec pinning the scrollport bounce suppression together with the sticky seat it protects; the chat-scroll e2e drives paging by arriving at the head and keys history exhaustion off `[data-earlier-history]`.
