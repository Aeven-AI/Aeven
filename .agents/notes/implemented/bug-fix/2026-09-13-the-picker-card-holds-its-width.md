# Agent Note: The picker card holds its width while the list is filtered

Status: implemented

English | [中文](2026-09-13-the-picker-card-holds-its-width.zh.md)

## Problem

The `popupSelect` card is sized by its content — `min-width: min(220px, 100%)` and `max-width: min(420px, 100%)` around a `max-content` box — so the searchable model list was as wide as its widest row. Typing in the search input filters rows away, and the card narrowed under the cursor as it did: the box, the input, and the rows all shifted on every keystroke that matched fewer rows, and widening the match again pushed them back.

Reported from the running GUI against the model list, which is the picker people actually type into: the list runs to hundreds of rows of varying width, so the shrink is largest exactly where the search is most useful.

## Decision

The card holds the widest width it has shown for the duration of one open. `PopupSelectView` measures the card in a layout effect after every render that can change its content (the search text, the loaded options, the load status) and keeps the largest width it has seen in state, applied as an inline `min-width`. The measurement converges because the inline minimum only ever raises the box's width, so the next measurement cannot come back smaller; a closed shell resets it, so the next open measures from scratch.

The width stays content-driven: a two-row picker still opens narrow, and the model list opens at whatever its widest row needs, up to the composer card's own width.

## Alternatives considered

**Give the card a fixed width.** Rejected: the shell serves every `popupSelect` contribution — a theme list, a permission list, a model catalog — and a fixed 420px card would leave most of them padded to a width their rows never use, while a narrower fixed width would truncate the long model names the flexible sizing exists for.

**Measure the unfiltered rows once and freeze that width.** Equivalent to what ships for the first keystroke, but it ignores the case the measurement above covers for free: a retry that reloads a longer catalog, or rows that arrive after the card is already up, would still resize it.

**Let the card shrink but animate it.** Rejected: motion does not remove the problem. The reader's cursor is inside the card, and a moving target under it is worse than a box that is simply too wide for a moment.

**Hold the width across opens (per session).** Rejected: a picker opened later for a different list — another contribution's rows — would inherit a width that has nothing to do with it. The measurement is cheap and per-open, so it re-runs.

## Consequences

- Typing in the shell's search no longer moves the card, its input, or its rows; filtering to a single row keeps the box the size the full list gave it, and clearing the search keeps it there too.
- The card can be wider than its current rows for as long as one open lasts. Accepted: the alternative is a box that moves under the cursor, and the excess is bounded by the widest row the reader just saw.
- One more layout effect runs per content change. It reads one number and sets state only when that number grew by more than a pixel, so a keystroke that does not change the width costs nothing.

## Testing

`packages/client/ui-commands/tests/popup-view.client.spec.tsx` stubs the card's rect as a function of its row count — jsdom lays nothing out — and asserts the inline `min-width` holds the three-row width after filtering down to one row and after clearing the search, which is the assertion that fails if the measurement stops being applied.
