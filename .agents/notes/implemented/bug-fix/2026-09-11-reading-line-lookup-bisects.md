# Agent Note: Reading-line lookup bisects instead of scanning rows

Status: implemented

English | [中文](2026-09-11-reading-line-lookup-bisects.zh.md)

## Problem

`ChatView`'s `turnAtLine` resolved the Turn owning the reading line by hit-testing that line with `document.elementsFromPoint` and falling back to a linear scan of every row carrying `[data-chat-turn]`:

```ts
for (const row of list.querySelectorAll<HTMLElement>('[data-chat-turn]')) {
  if (row.getBoundingClientRect().top > line) break
  ...
}
```

Each iteration read one rect, and a geometry read on an unflushed transcript forces layout of the entire column. The hit test misses whenever the line lands in the gaps between rows or on the non-scrolling column chrome, which on a real session is about a quarter of the time, and `syncActiveTurn` can run the lookup more than once per frame. The scan is also linear in the *rendered* row count, so the cost grew with the history the reader had paged in: measured on a 512-row, 11,569-node session, one lookup read up to 781 rows, and scrolling averaged 113.6 geometry reads per frame with 105.7 of them inside this scan.

The pass also wore an unreachable-looking floor: the scan's own `break` is the only thing that makes hidden rows harmless, and nothing in the code said so.

## Decision

`turnAtLine` keeps its hit test and replaces the fallback scan with a bisection.

The bisection steps to the nearest *visible* row instead of comparing the row at the probe index. This is required, not defensive: rows carrying `[data-chat-turn]` are interleaved with hidden ones (measured across indices 2–497 on a real session), and a hidden row renders no box, so it reports a zeroed rect whose `y` is 0 and sorts ahead of every visible row. Only visible rows are ordered by document position — measured as zero inversions over the 457 visible rows, with turn numbers ascending. Stepping over the zero-height rows restores the monotone predicate the bisection needs, and a first probe past the last visible row terminates the search with no match.

The bisection preserves the previous contract: the last visible row at or above the line owns the reading line, a row whose `data-chat-turn` is not a safe integer yields `null`, and a list with no visible row yields `null`. It reads ~10 rows instead of scanning, independent of how deep the window is.

`usePrimitives`' `useAnchoredPosition` gained the identity guard its siblings already had. `place` is registered as a capture-phase `window` scroll listener, so it runs on every frame a scroll produces — including frames that scroll some other element and leave the anchor exactly where it was. It returned a fresh `{ left, top }` each time, re-rendering the panel for coordinates already on screen. It now keeps the previous object when the placement has not moved, matching `AttachmentRail`'s existing guard.

## Verification

The fallback was replaced against a live 512-row session by re-implementing both algorithms and comparing them at every line position the reading line can take — the scrollport spans y 0–739 and the line sits at `top + min(96, 0.2 * height)`, so the reachable range is 0–739. 740 checks, zero mismatches; average reads in that range fall from 321.0 to 20.0. The only divergences are at `line < 0`, where no row can cover the line and both answers are vacuous.

Scrolling the same 11,569-node window with real CDP wheel input, before and after: geometry reads per frame 113.6 → 14.0, fallback row reads per frame 105.7 → 6.1, rows read per scan 423 → 25, and `turnAtLine` reads over 60 frames 6,322 → 195.

End-to-end under one methodology (real wheel input, identical distance and instrumentation), the app goes from 3 frames over 16.7 ms and a 95 ms long task to 0 and 0, with `median 8.3 / p90 9.1 / p99 9.4 / worst 9.4` ms — matching the Aeven reference client measured the same way (`8.3 / 9.1 / 9.3 / 9.4`, 0 and 0) while rendering 4,370 nodes to its 9,574.

`packages/client/ui-chat` and `packages/client/ui-primitives` pass, 900 tests. The client build (`tsc -b tsconfig.client.json && tsdown`) exits 0.

## Alternatives considered

**Copy the bisection `pagingAnchor` already uses.** It bisects `[data-chat-flow] > [data-chat-flow-key]:not(:empty):not([hidden])`, whose selector excludes the zero-height rows, so the predicate is monotone over what it reads. `turnAtLine`'s selector cannot exclude them: hidden rows carry `[data-chat-turn]` and are the Tombstones a prepend leaves behind, and the lookup must agree with the linear scan about which row owns the line. Reusing that selector would have changed which Turn the rail marks.

**Fix the hit test instead, by sampling several x positions.** Measured against the live flow, sampling left, centre, and right all missed at the same points: the misses are line-position gaps and column chrome, not side margins. No x position makes a single-line hit test reliable against a flow with gaps, so the fallback has to be cheap on its own.

**Leave the scan and bound it with a window around the last answer.** Correct while scrolling smoothly and wrong after a jump or a prepend, when the answer moves further than any window. It also keeps a per-frame cost proportional to the window at every scroll frame, where bisection is ~10 reads flat.

**Virtualize the transcript instead.** The column CSS already anticipates this (`ChatView.module.css`: the flow item is "the natural measurement/mount unit for a virtualizer"). It would reduce the absolute node count, but it does not make this lookup correct or bounded: a virtualized window still needs the row owning a line, and the scan would still be linear in the window. The two changes are independent, and bisection is the prerequisite that keeps the lookup cheap at any window size.

**Add `content-visibility: auto` or `contain: layout paint` to flow rows to cut scroll cost.** Measured by applying both to the live flow rows: long-task totals over one paging burst were 241 ms unmodified, 249 ms with `content-visibility`, and 231 ms with containment — a change under 4%, inside run-to-run noise. The remaining cost is not paint.

## Consequences

Scroll cost no longer grows with the history a reader has paged in. The lookup is ~10 geometry reads at any window depth, so a session that has loaded 900 rows costs what a session with 90 costs — the property that was missing, and the reason long sessions degraded. `syncActiveTurn` may still run more than once per frame, but each pass is now bounded rather than proportional to the transcript.

The bisection compares visibility instead of position, so it depends on a fact the previous scan did not state: that hidden rows have zero height and interleave with visible ones. The note above records it, and the `visible` predicate is the single place that encodes it. A future row that renders a non-zero box while `hidden`, or a hidden row that carries layout, would break the ordering assumption — the fallback would then return a wrong Turn rather than throwing, so this is the assumption to re-measure if the reading-line mark ever looks wrong.

A separate ~90 ms hitch remains and this change does not address it. It fires once per history page rather than per frame: `loadOlder` pulls `PAGE_MESSAGES = 50` (`packages/api/session-controller/src/client/sessions/session.ts`), which commits roughly 100 rows and 5,000 nodes in one React commit, producing 3–4 long tasks of 85–102 ms while the window fills. React accounts for only ~38 ms of a ~100 ms task, so the rest is browser layout of the inserted subtree. The levers are the page size or virtualization, both design changes rather than local fixes.
