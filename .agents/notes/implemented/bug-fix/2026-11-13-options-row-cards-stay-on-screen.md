# Agent Note: Composer Options Row Cards Stay on Screen

Status: implemented

English | [中文](2026-11-13-options-row-cards-stay-on-screen.zh.md)

## Problem

On a phone, the cards opened from rows of the composer's Options popup (reading voice, permission mode, context actions and details) ran past the right edge of the screen ([#643](https://github.com/Aeven-AI/Aeven/issues/643)). Their stylesheets placed every card at `left: calc(100% + 10px)` from the row, beside the popup; the `max-width: min(360px, calc(100vw - 32px))` cap limited the card's width but not where its left edge landed. The popup is at least 232px wide and starts at the disc, so on a 390px screen the card started near x 314 and ended near x 557, and the document is `overflow: hidden`, so nothing could scroll it into view.

## Decision

`@aeven/client-ui-primitives` gained `useBesidePlacement`, a placement step for a card that opens beside its row. It measures the row seat and the card and keeps the stylesheet's trailing-side placement when the card fits there, moves the card to the row's leading side when that side has room, and otherwise stacks the card above its own row, sliding it sideways until both edges sit inside the 16px margin the stylesheets' `100vw - 32px` caps already imply. It re-runs on resize, capture-phase scroll and the card's own size changes, so a voice catalogue arriving after the card opens is placed again. The stacked card covers the popup's rows above its row but leaves the row visible, so a second press on the row still closes it. The same module's `useViewportClamp` slides the left-aligned popup card itself inward when the disc's seat would push it past an edge; with the disc seated on the left this is a no-op today.

`ComposerOptions` routes its three cards through a local `RowPane` that applies the hook, and `SystemVoice` applies it to the voice card and measures its height cap from the row's top edge while stacked, instead of its bottom edge.

## Alternatives considered

**A CSS-only phone branch.** A `@media (max-width: 640px)` rule can move the card, but it cannot know where the disc sits or how wide the card is after its catalogue loads; a 641px tablet with a wide catalogue would still clip.

**Render the cards through the Menu primitive's portal path.** `Menu` already clamps, but its cards are a list of entries; the voice card's sticky language sections and the context breakdown are arbitrary content, and moving them into a portal would also move them outside the popup's outside-press dismissal root.

**Replace the popup with the card on a phone.** One card at a time is a design change the issue left open; stacking over the popup keeps the desktop behaviour and the row-press toggle without new navigation.

## Consequences

Any plugin row in `conversation.input.options` that copies the `.pane` geometry should apply `useBesidePlacement` with the same gap, lift and margin, or it keeps the old overflow. The hook decides by width alone: a stacked card is not clamped vertically, which the current cards do not need because the popup sits low on the screen.

## Verification

The three client packages typecheck and `pnpm run build` passes. In the source web client under mobile emulation, each card's bounding box was measured against the viewport: at 390×844 the voice card stacks at x 88–331 above its row and the permission card at x 88–276; at 320×568 the popup slides 8px inward to x 72–304 and the voice and permission cards land at x 61–304 and x 80–268; rotating to 844×390 with the voice card open moves it back beside the popup at x 314–557. Before the change the voice card measured x 314–557 at 390px. The context row was not exercised, because a new session has no context reading.
