# Agent Note: The desktop window-controls gutter is measured, not assumed

Status: implemented

English | [中文](2026-09-30-desktop-window-controls-gutter.zh.md)

## Problem

The desktop shell hides its title bar and lays the page under macOS's window controls: [`trafficLightPosition`](../../../../apps/desktop/src/main.ts) insets the three traffic lights over the page's own top-left. Three sheets reserved the room for them by restating one sum — `3 * 12px + 2 * 8px`, three 12px buttons 8px apart — and the auth screens' band reserved none.

macOS paints them 23px apart. Read off the rendered window (macOS 26, Electron 44), the painted circles begin at the 24px the shell asks for and their leading edges run at 24, 47 and 70, so the last button ends at 84 — eight further right than the sum reserved. The sidebar shell's header row, which carries the Session search, placed that control at exactly 76: over the zoom button, which is the defect this note records. The collapsed conversation band's fold control cleared them only because that row rests its own page inset inside the same reservation, and the frame's window-drag strip ended 8px inside the buttons it exists to cover. At the ≤640px breakpoint the sum reserved only 68px, because it carried the narrowed page inset inside it, for controls that had not moved.

## Decision

[`--dsw-aeven-window-controls-gutter: 84px`](../../../../packages/client/ui-theme/src/styles/aeven-language.css) owns the geometry: the controls' own 24px inset plus the 60px they paint over. It is a page constant rather than a function of `--dsw-aeven-page-inset`, because the lights stay where the shell put them at every width.

The sheets that ride that line read the token: the conversation band's collapse reservation, which puts the fold control and the Session actions behind it one page inset past the gutter; the sidebar shell's header row, which adds its own row inset to the same gutter, so the search stands on the line the collapsed band puts the fold control on; and the frame's drag strip, whose width is now the gutter itself.

The auth screens render before the token sheet loads, so their band ([`aeven-auth.css`](../../../../packages/client/ui-auth-aeven/src/vendor/aeven-auth.css)) restates the sum, 108px, under the desktop flag. The theme's stylesheet spec asserts that restatement against the token values, so the two cannot drift apart.

## Alternatives considered

**Re-measure in the shell and inject the value into the page.** The main process could hand the page a custom property and no sheet would hold a number. Rejected: Electron exposes `trafficLightPosition` as write-only, so there is nothing to measure back — the value would still be a constant, one hop further from the CSS that consumes it and unreadable by the auth band, which paints before any script of ours runs.

**Correct the same sum in all four sheets in place.** The smallest edit is to change the spacing in each copy. Rejected: four copies of one sum, one of them in a sheet that cannot read tokens, is what let the value and the painting drift apart in the first place. The token gives the number one owner, and the auth band's restatement is the one exception the spec watches.

**Reserve only the sidebar header, by adding the missing 8px there.** Rejected: the auth band's back control and brand mark sat under the same buttons for the same reason, and the drag strip fell short of them too. The gutter is one fact about the window, and three sheets asking the same question deserve one answer.

**Reserve a round margin instead of the measurement.** 96px or 100px would clear the buttons on any macOS. Rejected: a layout number that answers to nothing tells the next reader neither what it covers nor when it stopped covering it. The measurement is one native screenshot to re-take, and this note records the method.

## Consequences

The Session search moves from 76px to 108px; the back control and the brand mark on the sign-in and sign-up screens from 24px to the same seat; the collapsed conversation band's fold control and the Session actions behind it from 100px to 108px; and the frame's drag strip widens from 76px to the controls' whole 84px gutter, still stopping a page inset short of the control beside it. Every one of those positions is now the same figure plus the row's own inset, at every width.

The number is a record of how macOS paints, not a derivation from the shell's `WINDOW_BUTTON_SIZE`: a macOS or Electron version that lays the buttons out differently is re-measured, and the gutter token moves with it.

## Testing

[`packages/client/ui-theme/tests/aeven-language-styles.client.spec.ts`](../../../../packages/client/ui-theme/tests/aeven-language-styles.client.spec.ts) asserts the token's value, that each of the three consuming sheets reads it rather than restating the arithmetic, and that the auth band's literal equals the gutter plus the page inset.

The geometry itself was read off the running window: three 12px circles with their leading edges 23px apart, the first at x=24, spanning y 21–35 — `screencapture` of the dev app's window, then the painted circles' columns in the PNG, with the control rects read over the renderer's debug port to compare. Re-take it the same way, and the state read back is `getComputedStyle(...).paddingLeft` against the rect of the control that rides the line.
