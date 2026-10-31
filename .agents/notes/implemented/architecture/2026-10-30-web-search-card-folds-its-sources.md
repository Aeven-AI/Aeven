# Agent Note: The web search card folds its sources like the edited-files card

Status: implemented

English | [中文](2026-10-30-web-search-card-folds-its-sources.zh.md)

## Problem

`WebBlock`'s search card drew every returned source and capped the list with a 320px scroll box. Past the scroll edge the reader had to scroll inside a card that is itself inside a scrolling conversation, and the card ended in a `Source list truncated` note that mixed two facts: the display was cut (short lists still scrolled), and the tool's `searchMaxResults` cap had dropped sources before they ever reached the client. The turn-tail edited-files card next to it solves the same shape of problem with a fold: four rows, then `All 8 files` / `Collapse`.

## Decision

The search card's citation list uses the edited-files card's row and fold grammar.

- Four rows render folded (`FOLDED_SOURCES`), matching `COLLAPSED_COUNT` in `ui-deliverables`; longer lists draw a full-width toggle below the list that reads `All {count} sources` collapsed and `Collapse` expanded, with the same chevrons, `aria-expanded`, focus ring, and coarse-pointer height as that card. - Rows adopt the files card's metrics: `padding: 7px 2px`, `min-height: 24px`, `0.875rem` labels in label-primary/hover, tertiary metadata. - The citation index is drawn in its own tabular-numeral column instead of an `<ol>` marker. A folded or expanded row keeps its real 1-based citation number, and no scroll container is left to clip a three-digit marker. - The `Source list truncated` note is removed with its `sourcesTruncated` label field and its `web.sourcesTruncated` keys in en/zh/es. The `truncated` flag stays on the result contract: it still describes what the tool returned, and `web_fetch` still reports its own content truncation.

## Alternatives considered

- **Keep the scroll box and only raise `searchMaxResults`.** The report was about the reader's experience of the list, not the count; a bigger cap moves the scroll edge rather than removing it. - **Fold all sources away and show only links on demand.** The answer cites numbered sources, so the first rows must stay visible to be read with it. - **Keep the truncation note beside the fold control.** Two different facts arrive as one line under a control that already says how many rows exist, and the flag's own meaning — sources the model never saw — is not what a reader of the card needs to act on.

## Consequences

The card no longer advertises the source cap. Whether a search was capped is visible only in the tool result's metadata, which is the model's view; the card now shows the list without commenting on it. The assembled-browser case in `apps/web/tests/web-search-round.e2e.ts` asserts the fold instead of the scroll geometry, and its aria golden needs a refresh run.
