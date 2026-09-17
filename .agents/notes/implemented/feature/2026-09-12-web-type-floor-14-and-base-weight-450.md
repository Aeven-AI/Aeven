# Agent Note: The Web Type Floor Moves to 14px and the Base Weight to 450

Status: implemented

English | [中文](2026-09-12-web-type-floor-14-and-base-weight-450.zh.md)

## Problem

Two type defaults reached the Web UI from the Figma export rather than from a decision about the product. The smallest text step was 13px: 77 declarations across 41 stylesheets wrote it literally, and 29 more in 10 stylesheets read the exported `--dsw-font-xs-13` token, so most of the small text sat one pixel under the 14px body — too close to read as a tier of its own, and small enough to read as an accident. The document weight was whatever a user-agent sheet applies, because only the Markdown ladder and the vendored Aeven sheet named a weight explicitly. The shipped variable cut renders 450 as a real instance, and the design already uses it, so text that stated no weight was the one place the product fell back to 400. A reader meeting 13px text beside 14px text at 400 beside 450 reads the mixture as a rendering defect rather than as a scale.

## Decision

No Web source declares a 13px font size, and the base weight is 450. Both rules hold across every package that ships a browser half — the 52 packages declaring `avn.client.platform === 'web'`, plus `apps/web` — which is 101 stylesheets and the inline style objects beside them, since the plugin packages style some surfaces as CSS-in-JS rather than as rules.

The size change is not a text substitution: the exported `--dsw-font-xs-13` and `--dsw-font-xs-strong-13` steps are renamed `--dsw-font-xs-14` and `--dsw-font-xs-strong-14` and now declare `14px/20px` and `500 14px/20px`, so the token name, its value, and its 39 consumers agree. The leading is deliberately unchanged at 20px: the step is the dense one, so a 1px larger glyph keeps the row heights that consume it — trajectory tables, terminal, read, diff, and web blocks.

The weight change covers three spellings of 400 — 52 declarations across the two package groups — because a stylesheet can reach it three ways: `font-weight: 400`, `font-weight: normal` (the highlight.js token rules that reset a bold default), and a `400` inside a `font` shorthand. It also covers the declarations that state no weight at all — 12 component `font` shorthands and 16 composite font tokens — because the `font` shorthand resets an omitted weight to `normal`, so leaving them would have kept 400 in exactly the dense surfaces that use the shorthand. `packages/client/web/src/base.css` then makes 450 the document default on `body`, and restates it on `button`, `input`, `select`, and `textarea`, whose user-agent shorthand resets the family and the weight together.

The derived tier follows the same rule. `--avn-content-font-size-secondary` — what flow rows, chat secondary lines, and Markdown tables read — was computed in the sheet as `min(setting − 1px, max(13px, setting − 2px))`, which resolves to 13px at settings 14 and 15. No `min`/`max` chain can skip a single value in the middle of a ladder, so the mapping moved to `secondaryFontSize` in `src/theme-settings.ts`: one step below 14, two steps below 16 and up, and the 14px floor at 14 and 15, where the step down would land on 13px. Its result rides the theme snapshot beside `fontSize`, because a value import from ui-theme into ui-layout's client bundle is forbidden by the bundle-purity gate; the boot script in `boot-theme.ts` publishes the same pair before any plugin runs, `ThemePresenter` publishes it on every snapshot, and the sheet declares only the fallback they overwrite.

Annotations that are weights rather than text styles keep theirs: the ANSI renderer's `bold: { fontWeight: 700 }`, the `600` emphasis weights, and the vendored Aeven sheet's own scale all still say what they said.

## Alternatives considered

**Replace the literal `font-size: 13px` declarations only.** Rejected: it would leave the exported token's 39 consumers at 13px, which is where most of the visible dense text lives — the trajectory table, terminal, read, diff, and web blocks all read the token, not a literal.

**Keep the token name and change only its value.** Rejected: `--dsw-font-xs-13` would then declare 14px, and the next reader would have to check every token body to know which names lie.

**Point the token's consumers at the neighbouring `--dsw-font-s-14` step.** Rejected: that step carries 22px leading, so every dense row that reads it would grow by two pixels, turning a font-size change into a layout change across the trajectory table and the tool cards.

**Rely on the body default alone for the weight.** Rejected: the `font` shorthand resets an omitted weight, so the dense component shorthands and the composite tokens would have kept rendering 400 while the rest of the UI moved to 450 — the same mixture this change removes, in the places a reader looks at most.

**Import the mapping from ui-theme's client entry into the presenter.** Rejected by the client bundle-purity gate, which fails the build on a cross-plugin value import; declaring ui-theme as an explicit external of ui-layout would ship the theme plugin's code into every bundle that reads a size. The snapshot already carries the resolved theme state across the service seam, so the tier rides it.

**Leave the derived tier in the sheet and accept 13px at two settings.** Rejected: it is the one path that still renders 13px, and it renders it for the tier a reader meets most — flow rows, chat secondary lines, and Markdown tables — so the floor this change states would hold for declarations and fail for the text they were declared to serve.

**Set the form controls to `font-weight: inherit`.** Rejected in favour of the literal 450: the point is a fixed base weight, and inheritance would let a bold ancestor pull a control's label to a weight the component never chose.

## Consequences

The scale the sheets declare is 11, 12, 14, and 16 for the dense steps and the body, with the Markdown heading steps above them: the 1px gap that made small text look accidental is gone, and the smallest dense step now carries the body's own weight, so dense text reads as 14px text rather than as shrunken text. The costs are real but bounded. The dense token keeps 20px leading over a 14px glyph, which is tighter than the body's 24px over 16px, so the surfaces that consume it are slightly denser than the rest; that was the token's own choice before this change and it is unchanged here. At text sizes 14 and 15 the derived tier now equals the body size instead of sitting a pixel under it, so those two settings carry one size where the ladder's other settings carry two, and only the label color separates a flow row's title from the body text around it. A heavier base weight also makes 500 the first step that reads as emphasis, so any design that relied on 400-versus-500 contrast inside dense text now has less of it — no such rule exists in the shipped stylesheets today, and a future one states 400 explicitly and is visible in review because it is now an exception rather than a default.

## Verification

`packages/client/ui-theme/tests/theme-settings.client.spec.ts` pins the tier's ladder for every accepted size, that it never returns 13, and that it never exceeds the body size; `boot-theme.client.spec.ts` and `packages/client/ui-layout/tests/theme-presenter.client.spec.ts` pin that both writers publish the pair from the same size and retract it on dispose. `packages/client/ui-chat/tests/chat-font-axis-styles.client.spec.ts` and `packages/client/ui-workflow-run/tests/panel-styles.client.spec.ts` pin the rules that read the tier. `pnpm exec vitest run packages/client packages/session-query packages/extensions` passes (386 files, 5,541 tests). A scan of all 890 UI source files — stylesheets and inline style objects across the 52 packages and `apps/web` — for `font-size: 13px`, `fontSize: 13`, `font-weight: 400`, `fontWeight: 400`, `font-weight: normal`, `--dsw-font-xs-13`, and weight-less font shorthands returns zero each. The client lib and the Web artifacts were rebuilt, and a live scan of the running Web UI reports rendered font sizes of 12px, 14px, and 16px with weights of 450, 500, and 600 — no element at 13px or at 400, `body` computing 450, and `body` carrying both content-size variables together.
