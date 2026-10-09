# Agent Note: Composer control tips are centred, and the model seat tips instead of opening

Status: implemented

English | [中文](2026-10-09-composer-control-tips.zh.md)

## Problem

Two flaws in how the composer's icon controls name themselves on hover.

The model seat (`conversation.input.model`, [@aeven/client-ui-model-selection](../../../../packages/client/ui-model-selection/README.md)) opened its Model/Effort chooser on `pointerenter` and kept it open through a pointer grace, with a press only pinning it. Every other icon disc in the composer row names itself in the shared tooltip — the Options disc beside it shows one — so the model seat was the one control whose hover explained nothing and instead covered the composer with a card the user had not asked for. Reaching for the disc to read what it was, or passing over it on the way to another control, raised the chooser; the model name and effort the trigger states were reachable only as the trigger's native `title`, which no other composer control uses.

The row's tips were also edge-aligned: `top-start` on the leading discs (attach, the model seat, the Options disc, the recorder's cancel) and `top-end` on the trailing ones (send, stop, dictate, the recorder's save). Each bubble therefore hung off the edge of its control, and its body reached over the disc beside it, so a pointer moving along the row met bubbles that read as belonging to the neighbouring control — while the composer's own controls are 40px discs with small gaps, where the control's centre is the only place a short label can sit and read as that control's.

## Decision

The trigger's hover shows the shared tooltip, and nothing else: `<Tooltip label={t('trigger.tooltip')} side="top" disabled={open}>` wraps the disc, exactly as `ComposerOptions` wraps its own, so the composer's two icon discs read as one family. `trigger.tooltip` is locale-owned copy naming the seat (`Model & effort` / 模型与推理等级), the same fact `menu.aria` states for the card.

The card opens on a press, or on the trigger's own focus for the seat's keyboard path, and closes on the press after that, on a press outside it, on focus leaving, or on Escape. Because the trigger's focus opens the card ahead of the click of that same press, the click claims the card (`claimed`) rather than reading as the press that closes it; every close clears the claim. The hover-open path and its pointer grace are gone from this seat — `onPointerEnter`/`onPointerLeave` on the seat, `usePointerGrace`, `openFromHover`, and the pin against hover dismissal — and the trigger no longer carries a `title`, so no native bubble opens behind the tooltip. Catalog loading moves with the open: `load()` runs on a press or a focus instead of on a hover.

Every tip on the composer's control row is `side="top"`, which centres the bubble on the anchor's own box: the send and stop discs (`InputBar`), the dictate disc plus the recorder's cancel and save controls (@aeven/client-ui-voice-input), the model seat, the Options disc, and the attachment tray's per-thumbnail remove control (@aeven/client-ui-attachment). The attach disc keeps `top-start`, because it is the one control in the row whose label (`Add files and run commands`) is wider than the frame's left inset affords: the disc is the card's leftmost control, so half of a centred bubble lands past the frame's page inset, the engine clamps it back inside, and the arrow leaves the glyph. The engine's `-start`/`-end` skirting offset applies only to edge-aligned placements, so a centred tip skids nowhere. Tips the composer already places above a wider row — the queue dock and the skeleton's navigation controls — stay `bottom` and centred on their anchors.

Hover names the seat, not the selection: the model in force and its effective effort stay the trigger's accessible name (`trigger.aria` / `trigger.ariaEffort`) and the card's first row, so a locale owns one sentence for the tip instead of a composed dynamic label.

## Alternatives considered

**Keep the native `title` beside the tooltip.** Rejected because both channels fire for one hover: the browser's own bubble appears a second later, under a differently placed one, and the composer's other discs carry no `title`.

**Keep hover-open and add the tooltip on a longer dwell.** Rejected because the card would still be what a passing pointer raises; the objection is the automatic card, not its timing, and a dwell would make the trigger's behavior depend on how long a user rests on it.

**Centre the attach disc's tip like the rest of the row.** Built first, then reverted on sight: the disc is the card's leftmost control and its label is the row's longest, so a centred bubble on its 40px disc ran past the frame's page inset, the engine clamped it back inside, and the arrow no longer sat on the glyph — the one tip in the row that read as misaligned. The trailing discs' shorter labels (`Send`, `Stop`) stay centred with room to spare.

**Return the whole row to its control's start edge.** Rejected because the mid-row discs — the model seat, the Options disc, the dictate disc — sit one 40px disc apart, so an edge-aligned bubble spends its own width past the control it names, over the disc beside it, and the row reads as shared bubbles rather than one tip per control.

**Centre the tips by hand per control instead of on the shared anchor box.** Rejected because `Tooltip` already places against the anchor box, so one `side` states the placement for the whole row; per-control offsets would drift apart the first time a disc's size changes.

**Name the current model and effort in the tooltip.** Rejected because it duplicates the trigger's accessible name and the card's first row in a third place, in a sentence composed per locale; the seat's own copy says what the control is.

**Drop the trigger's focus-open and toggle the card on press alone.** Rejected because tabbing onto the disc would then reveal nothing until Enter, and the seat's keyboard path onto the card — which the press-claim exists to keep coherent — would narrow for no gain in this change.

## Consequences

A pointer that passes over the seat no longer starts a catalog load or paints a card over the composer, and the seat's hover costs one small bubble instead. The chooser now needs a press or a keyboard focus to appear, which is one gesture more than before for a mouse user who hovered deliberately; the tooltip states what the disc is, so the gesture is informed. Tipping is suppressed while the card is open, where the card already states both values.

Every tip in the row except the attach disc's hangs on the middle of the control it names, so a pointer travelling along the composer meets one bubble per disc instead of two bubbles meeting at an edge. A centred bubble overhangs its control equally on both sides: harmless between discs, and at the frame's left edge it is exactly what pushed the attach disc's long label back onto its start alignment.

## Testing

`packages/client/ui-model-selection/tests/model-select.client.spec.tsx` pins the trigger's accessible name, its expanded state across a press, and that it carries no native `title` to race the tooltip. The seat's card behavior, the effort pane, and the refused-selection toast are unchanged and keep their cases. Bubble placement and clamping belong to `@aeven/client-ui-primitives` and are covered by its own suite; no composer spec asserts a tip's side.

## Related

- [One model picker for both entries](../../implemented/architecture/2026-09-12-one-model-picker-for-both-entries.md) owns the seat's two-level chooser and its handover to the shared list.
- [Hover popup pointer grace](../../implemented/bug-fix/2026-07-30-hover-popup-pointer-grace.md) owns the grace itself for the atoms that are still hover-raised.
