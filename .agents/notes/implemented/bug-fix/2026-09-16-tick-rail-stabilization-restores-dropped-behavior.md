# Agent Note: Tick-rail stabilization restores dropped behavior

Status: implemented

English | [中文](2026-09-16-tick-rail-stabilization-restores-dropped-behavior.zh.md)

## Problem

The `refactor/simplify-conversation-scroll-ui` branch rewrote the conversation scroller in one work-in-progress commit (the `ba27d25d4c` checkpoint, whose message states that tests, hygiene gates, and snapshots were not run against any of it) and then rebuilt turn navigation on top of it (`0714950757`, `258477130b`, `ed1eceeab6`). Twenty-nine specs across `packages/client/ui-chat` and `packages/api/session-controller` failed, and three unhandled `TypeError: el.scrollTo is not a function` errors fired from the back-to-bottom control.

The failures were not one defect. Most encoded the behavior of components the branch deliberately replaced: the rail's inner scroller with gradient fades, its per-mark `--turn-natural-position` wrappers, the `aria-busy` mark lifecycle of ChatView's own jump pager, the stall latch with its manual retry control, a four-screen prefetch runway, and `loadThrough`'s backward walk. Four of them, however, encoded behavior the branch never meant to drop, and one `color-mix()` value violated the client's iOS/Safari 14.5 CSS floor.

## Decision

Each failure was resolved on the side that held the obsolete statement: the spec where a documented redesign replaced the mechanism it asserted, the source where the rewrite silently lost a contract the spec still stated. The rail is the outline-driven tick ladder; the jump is the event-navigation path; a failed jump still lands the nearest rendered row and marks it.

Four source behaviors are restored, each of which the branch's own older tests already pinned:

- **The floor mark exists on the first frame.** `publishMark` seeds its last-turn value from the rows standing at mount, so an opened session pinned to the tail marks the last turn immediately instead of waiting for a row mutation. `b10f873d41` claimed this fix; without the seed its own test failed.
- **A Turn jump lands its earliest rendered row, or the conversation start.** `006cf095d9` landed the rail's jump on the Turn's earliest row, and on the scroll origin when that row starts the flow so a leading System prompt stays in view. The rewritten `navigateToTurn` wrote the reading-line math unconditionally and lost the origin case.
- **A jump whose page never arrives still lands the reader.** The rewritten fallback skipped Turn destinations entirely, which left the rail marking a Turn the flow could not show. The fallback now lands the closest durable row for every destination, and the mark follows the row that landed.
- **A view attaching to an open Session tests paging once.** The opening branch of the layout effect and the committed-window effect both ran on the mounting commit; the effect now owns every commit after the mount, which keeps one layout read off the frame a view attaches on. The session-side in-flight guard was already collapsing the duplicated call into one request; this removes the duplicate call itself.

`Session.loadThrough` keeps its declared "superseded" contract. A request arriving while an anchored read is in flight joins that pass at the lower of the two targets, and the pass serves it with one more anchored read rather than with the walk the two-sided window replaced — the anchored read costs the same at any distance, so a rail clicked twice in quick succession still lands the second, deeper destination instead of leaving it unserved.

`StatsLine` again measures its row for ellipsis and shows the whole line in a delayed tooltip **only while the row is clipped**. The work-in-progress commit had replaced that with a bare `title` attribute, dropping the truncation check and the observer that fed it; nothing in the commit's stated scope mentioned the statistics line.

The rail's unloaded-tick dimming states its 35% rest colour as `rgba(10, 10, 10, 0.35)`. `color-mix()` is a value-level function the floor drops, which would have left every unloaded tick painting at full strength.

## Alternatives considered

**Reinstate the replaced components.** The rail's own scroller, fades, mark wrappers, and ChatView-side jump pager could have been rebuilt to satisfy the old specs unchanged. Rejected: the branch removed them for stated reasons — a ladder sampled to a fixed band needs no inner scroller, active-mark tracking costs no layout read through `IntersectionObserver`, and one pager (the event-navigation path) already stands down for a jump — and each reason is measured in its commit, verified live on a 35-turn session.

**Revert `loadThrough` to the backward walk.** Rejected: one anchored read reaching any seq is the branch's headline result (37 round trips and 67ms by walking, 1 round trip and 5ms anchored on a 20k-event session), and the two-sided window's `detached`/`returnToLive` contract is built on it.

**Leave the duplicated paging test at mount and re-baseline the two call-count specs.** Rejected: three specs state that the open pulls once, the duplicate call is a second layout read of the scrollport on the mounting frame, and the session-side guard already makes the second call a no-op — so the wart was load-bearing for nothing.

**Install a no-op `scrollTo` stub, as sibling client suites do.** Rejected for this spec only: those suites assert that `scrollTo` was called, while these cases assert where the jump landed. The stub therefore performs the one thing the view asks for — put the requested offset on the element — and the two cases that assert a position name the floor the control computes, which jsdom does not clamp.

**Make the production `scrollTo` call defensive (`typeof el.scrollTo === 'function'` plus a `scrollTop` write).** Rejected: `Element.scrollTo` is universally present in browsers, and a jsdom-only fallback in shipped code would hide the next environment gap rather than state it where it belongs.

**Treat the lost behaviors as obsolete specs too.** Rejected: the origin landing, the nearest-row fallback, the first-frame floor mark, and the clipped-line tooltip are all user-visible contracts with their own older commits and tests. A rewrite that drops them is a regression to fix, not a design to document.

## Consequences

The scoped suites are green — `packages/client/ui-chat` 359 passed, `packages/api/session-controller` 433 passed — and the three unhandled `scrollTo` errors are gone, because jsdom now has the capability the view needs instead of the handler throwing into React's error path. `verify-css-baseline` reports all 121 governed stylesheets holding the floor.

Fixing the side that held the obsolete statement cost the specs their old mechanisms. Seven `chat-view.client.spec.tsx` cases were renamed because their titles named a mechanism the branch removed (the inner scroller and its fades, the `aria-busy` lifecycle, the stall latch, the prefetch runway in screens) and each now pins the replacement behavior with at least as many assertions. Two specs gained a case for sampling past the mark cap and keeping the newest Turn.

The specs that render the rail now install the `turnOutline` projection, because the rail's input is the host's whole-log outline rather than the loaded window. That is the branch's design, and it means a composition without the `session-turn-outline` unit renders no rail at all — a deployment fact, not a test gap.

`loadThrough` may now issue a second anchored read when a retarget arrives mid-read. Its cost is one round trip per retarget, bounded by the targets a reader can issue, and it closes the hole where a rapid second click was silently unserved.

## Testing

`packages/client/ui-chat/tests/chat-view.client.spec.tsx` pins the rail's ladder from the outline, the pointer-to-mark mapping, the sampled stride and its newest-Turn bump, the fixed-pitch styles, the event-navigation lifecycle of a jump (intent delivered, one page request, acknowledgement, nearest-row fallback), the reading band as the mark's source, the floor rule, the Turn-jump origin landing, the mount-time fill pull, and the eight-screen prefetch runway. `packages/api/session-controller/tests/session.client.spec.ts` pins one anchored read per jump target against a modelled host log, the retarget's second read, the refused jump that parks no target, and the bounded pass over a page that makes no progress. `packages/client/ui-chat/tests/chat-stats.client.spec.tsx` pins the size observer and the clipped-row tooltip.
