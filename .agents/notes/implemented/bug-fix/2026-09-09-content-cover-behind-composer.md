# Agent Note: The Content Cover Passes Behind the Composer

Status: implemented

English | [中文](2026-09-09-content-cover-behind-composer.zh.md)

## Problem

Switching Sessions made the composer look like it unmounted and remounted. It never did: `session-maybe` keeps that incarnation across switches, and the seat's DOM node is the same node before and after. The content cover was painted over it. `.contentLoader` carried `z-index: 20` while the composer seat carries `7`, so the overlay's opaque `--dsw-alias-bg-base` plate covered the input card for as long as the cover stood and then revealed it again through the 400ms fade. A reader sees the input blink out and back, which reads as a remount and not as a load.

## Decision

The cover keeps its geometry and changes only its place in the stack. It remains a fixed layer from `top: 0` to `bottom: 0` at `100cqi`, so it still spans the whole conversation column, and it now passes *behind* the composer seat instead of over it. `.contentLoader` drops to `z-index: 6` and `.scrollArea` becomes a stacking context at `z-index: 5`, which puts the transcript, the CodeBlock sticky banners that sit at `6` inside it, and the view's own floating chrome under one level the cover clears with a single number. The seat's `7` therefore wins over the cover, and the header's `30` still wins over both. This supersedes only the clause of the [content-loader decision](2026-09-08-conversation-content-loader.md) that had the overlay covering the column *through the composer*; that note continues to own when the cover appears, what it shows, and how it hands off to the page preloader.

## Verification

Style specs in `ui-conversation` read the module's declarations and require the cover to rank below the composer seat, to outrank the `.scrollArea` group that holds everything it hides, and to keep `position: fixed` with `top: 0` and `bottom: 0` so it is not bounded to the scrollport. Chrome DevTools against a real Session switch confirms it: the seat stays in the document with an unchanged rect throughout, the cover measures the full `997px` column height at `z-index: 6`, and of thirty sample points across the composer band at full cover opacity none resolves to the loader — the topmost painted element there is the composer row, where it was previously the cover's background plate.

## Alternatives considered

**Bound the cover to the scrollport.** Making it `position: absolute; inset: 0` inside `.scrollArea` ends it at the seat's top edge and does stop it covering the input, but it shrinks the cover instead of restacking it: the band behind the composer is then uncovered, and the fix is a smaller overlay rather than a correct paint order.

**Raise the composer seat above the cover.** The seat sits at `7` deliberately below ChatView's back-to-bottom control at `8` so that control paints over the input card. Lifting the seat over a `20` cover would invert that relationship for a reason that has nothing to do with either control.

**Leave the cover at `6` and rely on document order.** A cover and a CodeBlock sticky banner would then tie at `6`, and paint order would fall to which element appears later in the tree. That is true today and silently wrong the moment either subtree moves.

## Consequences

A Session switch covers the transcript and leaves the composer visible and legible the whole time, so the switch reads as content loading rather than as the input being torn down and rebuilt. Everything inside `.scrollArea` is now capped below the seat, which is consistent with that layer already being bounded to the scrollport and unable to overlap the composer geometrically. The cover still spans the full column height, so the band behind the input keeps its ground colour while the transcript is hidden.
