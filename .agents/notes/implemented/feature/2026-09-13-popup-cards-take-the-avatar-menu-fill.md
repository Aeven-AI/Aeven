# Agent Note: Popup cards take Aeven's avatar-menu fill

Status: implemented

English | [中文](2026-09-13-popup-cards-take-the-avatar-menu-fill.zh.md)

## Problem

The Web client drew its dropdown cards as opaque boxes: `background: var(--dsw-specific-menu)` — pure white in the light theme, `rgb(36, 36, 36)` in the dark one — with a 20px radius on the two cards the composer shell owns and no blur at all. Aeven's own popup, the account menu behind the avatar, is a translucent card instead: `rgba(255, 255, 255, 0.7)` over `backdrop-filter: blur(4px)`, with a 30px radius, in its vendored tippy `menu` theme (`ui-account-aeven/src/vendor/aeven-account.css`).

Reported from the running GUI as a mismatch between the two families, with the avatar popup as the reference and a request to confirm its radius.

That check, run against the stylesheet: the avatar popup **does** carry `border-radius: 30px`, `background-color: rgba(255, 255, 255, 0.7)`, and `backdrop-filter: blur(4px)` — it was already the translucent 30px card the other popups were being compared to. The avatar mark itself is a 30 × 30 box with `border-radius: 15px`; that is unchanged.

## Decision

The three card surfaces take the avatar popup's recipe:

- `border-radius: var(--dsw-aeven-radius-surface)` (30px). The shared `Menu` card already used this token; the `popupSelect` card and the composer seat's menu move from a hardcoded 20px to it.
- `background: color-mix(in srgb, var(--dsw-specific-menu) 70%, transparent)` — Aeven's 70% fill expressed through the theme's own menu token, so the dark theme gets its own colour at the same alpha instead of white.
- `backdrop-filter: blur(4px)`.

The elevation stays the app's own: `box-shadow: var(--dsw-elevation-prominent)` with the rebindable `--dsw-elevation-stroke-color`, rather than Aeven's hardcoded white inset highlights, so the hairline keeps tracking the theme and the theme's elevation contract keeps holding. No border is added, so the "elevated surfaces carry no neutral border" rule is untouched.

The three surfaces are `ui-primitives`' `Menu` card, `ui-commands`' `PopupSelectView` card, and `ui-model-selection`' `ModelSelect` menu — one look across the dropdowns the composer and the settings pages open.

## Alternatives considered

**Copy Aeven's hardcoded `rgba(255, 255, 255, 0.7)` and its white inset shadows.** Rejected: that sheet is light-only. The app has a dark theme, where a white card over dark content is not the same design; the token plus `color-mix` keeps one recipe for both.

**Restyle only the popup the report named.** Rejected: the Full access selector, the model list and the seat's chooser are three renderings of the same card, and the report itself arrived as "these should look like that one". Leaving two of them opaque would put both looks side by side in the same composer.

**Add a translucent-menu token to `ui-theme`.** Not yet: one fill ratio, expressed once per sheet through a token that already exists, does not need a new name in the theme contract. If a second surface wants a different alpha, that is the moment to name it.

**Keep the 20px radius on the two shell cards.** Rejected: the reference card is 30px, the shared `Menu` card is already 30px through the same token, and a picker opened from the seat sits inches from that menu.

## Consequences

- Menus, pickers and the seat's cards are translucent and blurred: what is behind them stays faintly visible, which is what the blur is for.
- Every `Menu` in the app changes with this — settings dropdowns, workspace menus, plan menus, the permission selector, and the `popupSelect` lists. That is intended: they are one card.
- Copy sits on 70% of the menu fill rather than on the fill itself. The colour is unchanged; only its alpha is, and the blur keeps the backdrop from competing with the text.
- The two composer-owned cards go from a 20px to a 30px surface radius. Their 8px padding, row radii, and the elevation are unchanged.

## Testing

No stylesheet contract pins these values, and none was invented: the change is a surface, and the suites that cover these packages — the theme's elevation and token contracts included — pass unchanged (1238 tests across ui-theme, ui-primitives, ui-commands, ui-model-selection, ui-conversation, and ui-account-aeven). What was verified mechanically is that the running app serves the new rules: `backdrop-filter`, the `color-mix` fill, and the surface-radius token are present in the bundles `dsh web` serves for ui-commands, ui-model-selection, and ui-conversation, which is also the check that the shared `Menu` change reaches the popup that opens it.
