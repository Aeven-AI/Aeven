# Agent Note: Popup cards take the avatar menu's rim, and every popup row is one control cell

Status: implemented

English | [中文](2026-09-13-popup-rim-and-one-control-cell.zh.md)

## Problem

Two gaps were reported against the Full access popup once [the translucent fill](2026-09-13-popup-cards-take-the-avatar-menu-fill.md) had landed.

**The highlight line was missing.** Aeven's avatar popup draws its edge as a bright inner rim — `inset 1px 1px 0 0 rgba(255, 255, 255, 0.8)` plus `inset 0 0 1px 1px rgba(255, 255, 255, 0.8)` — above a soft drop shadow. The app's cards draw `--dsw-elevation-prominent` instead, whose stroke the card rebinds to `--dsw-alias-border-l1`: `rgba(10, 10, 10, 0.04)` in the light theme. That is a 4%-alpha *dark* hairline — the opposite of a highlight, and effectively invisible once the card became translucent. Checked against both stylesheets: the rim was genuinely absent, not merely faint.

**The model popups' rows were a different button.** The Full access selector's row is `ui-primitives`' Menu item: a 40px `--dsw-aeven-control-size` cell, 8px padding, the `--dsw-aeven-radius-control` radius, 14/22. The `popupSelect` row padded 6/8 at an 8px radius with no minimum height, the seat's chooser cells padded 0/10 at a 10px radius, and its effort rows were 38px at 6/10 and a 10px radius. Cards in the same family, buttons of four different sizes.

## Decision

`--dsw-specific-popup-highlight` joins the Aeven language sheet's `--dsw-specific-*` group — `rgba(255, 255, 255, 0.8)` light, `rgba(255, 255, 255, 0.08)` dark — and each of the three cards draws Aeven's two inset layers above its elevation:

```css
box-shadow:
  inset 1px 1px 0 0 var(--dsw-specific-popup-highlight),
  inset 0 0 1px 1px var(--dsw-specific-popup-highlight),
  var(--dsw-elevation-prominent);
```

Every popup row is the Menu's control cell: `min-height: var(--dsw-aeven-control-size)`, `padding: 8px`, `border-radius: var(--dsw-aeven-radius-control)`, `gap: 8px`, `font-size: 14px`, `line-height: 22px`. That is applied to the `popupSelect` row, the seat's chooser cell (which keeps `height`, now stated as the same token) and the seat's effort row. Every other inset in the two cards follows the same reference: the seat's card pads 8 like the Menu card rather than 4, and the shell card's search field and its status and error strips take the row's 8px inset — the field at the same 40px control height — so every line of text in a card starts 16px from its edge.

## Alternatives considered

**Rebind `--dsw-elevation-stroke-color` to a lighter token instead of adding inset layers.** Rejected: the stroke is a `0 0 0 0.5px` hairline whose token flips meaning between themes — `border-l1` is dark 4% in light and white 6% in dark — while the rim Aeven draws is white in both. They are two different jobs, and the dark card wants the rim *and* a hairline, not one of them.

**Copy Aeven's hardcoded white insets.** Rejected for the same reason as the fill: the dark theme needs its own alpha, so the rim is a token in both blocks.

**Match the row height but leave the radii.** Rejected: a button that is taller, narrower-padded and less round than its neighbour reads as a different component even when its height matches, which is what was reported.

**Give the model list a denser row than the permission list.** Rejected: both are command pickers in the same card, and the model row's only real difference is the detail line it carries. Density belongs to the compact-list variant the Menu already names.

## Consequences

- The three cards share one edge treatment and one row geometry: a 40px control cell with the control radius, inside a 30px surface radius, under a white rim over the prominent elevation.
- The rim is drawn inside the card's own box, so no layout moves, and it rides above the elevation's hairline rather than replacing it — the theme's elevation contract (a `--dsw-elevation-*` shadow, a rebindable stroke, no neutral border) is untouched.
- Rows grow from roughly 32px to a 40px minimum in the model list, so a long catalog scrolls slightly sooner. The viewport, the card's height cap, and the width behaviour are unchanged.
- `--dsw-specific-popup-highlight` is declared in both the light and the dark block of the Aeven language sheet, where the other `--dsw-specific-*` tokens live.

## Testing

No stylesheet contract pins the rim, the row metrics, or the card fills; the theme's elevation contract still passes because the cards keep their elevation shadow reference, keep rebinding the stroke colour, and add no border. 1238 tests across ui-theme, ui-primitives, ui-commands, ui-model-selection, ui-conversation and ui-account-aeven pass unchanged.

What was verified mechanically is delivery, in both halves the running app needs: the emitted `ui-primitives/lib/Menu.module.css` carries the rim and the 8px cell, the shell's `primitives` chunk — which owns the Full access popup's card — serves both inset layers with the token, and the ui-commands and ui-model-selection bundles carry the rim, the control size and the control radius for the model list and the seat's menu.
