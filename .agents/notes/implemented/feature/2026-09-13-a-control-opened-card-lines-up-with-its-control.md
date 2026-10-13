# Agent Note: A control-opened picker card lines up with its control

Status: implemented

English | [中文](2026-09-13-a-control-opened-card-lines-up-with-its-control.zh.md)

## Problem

The `popupSelect` shell's card is positioned inside the overlay anchor, a zero-height strip on the composer card's top edge, with `left: 0` — so a picker opened from a composer control started at the composer card's leading edge. That is the right anchor for the token paths (`/model` typed into the draft), which belong to the composer as a whole.

It is the wrong anchor for a control. The seat's own chooser is a card right-aligned to its trigger, and the model list opened from that chooser's Model row is another card — so the two cards of one seat pointed at different edges, and the searchable list appeared to belong to the composer rather than to the button that opened it. Reported from the running GUI as a misalignment against the model selector.

## Decision

`CommandUiContract.openSelect` takes an optional `anchor` element, and `PopupSelectController.open` carries it into the open state. `PopupSelectView` measures the card's own offset parent (the overlay anchor) against that element's box after mount and before paint, and positions the card with `right: <inset>` and `left: auto`, so the card's trailing edge sits on the anchor's trailing edge. Without an anchor the card keeps its CSS rule and the composer's leading edge.

The seat passes its trigger element when its Model row hands over. Measuring in a layout effect is what keeps the card from rendering at the composer's edge for a frame and jumping; `state.anchor`, `state.open`, and the load lifecycle are the effect's inputs, because the overlay's own box can change while the card is open.

The contract change is additive: `anchor` is optional, the token paths pass nothing, and every popup opened from a draft token keeps the placement it had.

## Alternatives considered

**Center the card on the anchor.** Rejected: the model list is up to 420px wide against a 220px seat, so centering pushes it off both ends of a narrow composer; the seat's own chooser is trailing-aligned, and matching it is what makes the two cards read as one control's.

**Anchor the card to the composer column's center.** Rejected: it is what a token-opened picker already does, and it is what the reported misalignment was.

**Let the caller pass a raw pixel offset.** Rejected: every caller would then have to measure, re-measure on resize, and know the overlay's box; the shell already owns the card and can measure both boxes itself.

**Position the card with a CSS anchor positioned element (`anchor-name`/`position-anchor`).** Rejected for now: it would remove the measuring, but support and fallback behavior across the engines this app runs on are not settled, and the shell would still need the fallback path.

## Consequences

- A picker opened from a composer seat sits under that seat, sharing its trailing edge with the seat's own chooser card; a picker opened from a draft token keeps the composer's leading edge.
- The offset is measured once per open rather than tracked: the card is transient and the composer does not move under it, which is the same assumption `useAnchoredMaxHeight` already makes about the space above the card.
- The shell's state carries one non-serializable field, the anchor element, which is the open-time binding exactly as the token segment is.

## Testing

`packages/client/ui-commands/tests/popup-view.client.spec.tsx` renders the shell and asserts the card's inline `right`/`left` follow the anchor's trailing edge, and that a card opened without an anchor keeps the CSS placement. `packages/client/ui-model-selection/tests/model-select.client.spec.tsx` pins the caller's half: the Model row hands `openModel` the seat's own trigger element.
