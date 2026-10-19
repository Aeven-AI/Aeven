# Agent Note: The light scheme is one seven-step neutral ramp

Status: implemented

English | [中文](2026-10-19-light-scheme-neutral-ramp.zh.md)

## Problem

`aeven-language.css` overrode the upstream platform palette alias by alias, and each override stated its own hex value. The result was roughly twenty distinct neutrals in the light scheme: three near-black text steps (`rgb(50, 50, 50)`, `rgb(80, 80, 80)`, `rgb(90, 90, 90)`), a caption step, a disabled step, three whites that differed by seven levels (`#fff`, `rgb(242, 242, 242)`, `rgb(235, 235, 235)`, `#e6e6e6`), an inline-code fill and its own literal ink (`#737373`), a scrollbar pair inherited unchanged from the cool upstream scale, and half a dozen cool-grey aliases the Aeven layer never warmed.

Nothing prevented the next token from adding a fourth near-black or a fifth off-white. Several aliases that no stylesheet consumed still carried values, and the surfaces that render before theme delivery — the boot page, the markdown engine, the vendored auth and account sheets — each kept a separate neutral ladder of their own.

## Decision

### Seven steps, stated once

[The Aeven visual language](../process/2026-09-03-aeven-web-visual-language.md) fixes which layer owns the values; this note fixes how many the light scheme may hold. The light block of `aeven-language.css` opens with seven neutral steps: `--dsw-aeven-ink`, `--dsw-aeven-ink-muted`, `--dsw-aeven-ink-faint`, `--dsw-aeven-ink-disabled`, `--dsw-aeven-surface`, `--dsw-aeven-well`, and `--dsw-aeven-raised`. Every alias in the light scheme resolves to one of them; no alias states a neutral literal of its own. Translucent tints and the state blends keep their own values because they are percentages of a step, which the supported browser floor cannot compute from a token.

The near-duplicates collapsed: the two lighter ink steps became the muted step, the hover step of the primary button became the muted step, the inline-code fill became the raised step, and the inline-code ink became a token (`--dsw-alias-markdown-inline-code-text`) reading the muted step rather than a literal. The transcript's forced-black rows now read the ramp instead of restating `rgb(0, 0, 0)`.

### A scrollbar is present or absent

Where an engine draws a scrollbar at all, the thumb rests on the raised step and reaches the disabled step under the pointer; the track stays transparent. The light scheme therefore states the scrollbar aliases itself instead of inheriting the cool scale's `rgb(229, 229, 229)` and `rgb(212, 212, 212)`. The dark scheme keeps the upstream values: its thumb sits at `rgb(60, 60, 61)` and its track is transparent already.

### Surfaces that paint outside the theme read the same steps

The boot page, the markdown engine's `--hm-*` palette, the syntax-highlight comment and punctuation colors, the JSON tree and hover card chrome, the upload tile and lightbox, and the vendored auth and account sheets each restated greys of their own. Each now states one of the seven step values, or an alpha of one: the boot page's cool `#0f1115`, `#61666b`, `#81858c` became ink, muted, and faint; the engine's `rgb(160, 160, 160)`, `rgb(105, 105, 105)`, and `rgb(102, 102, 102)` became faint and muted; the auth sheet's `#111`, `#333`, `#868e96`, `rgb(90, 90, 90)`, `rgb(100, 100, 100)`, `rgb(105, 105, 105)`, and `#ddd` became ink or one of the steps.

The dark palette is untouched. It is a separate scale with its own inverse ladder, and collapsing it is a separate decision.

### The ramp is enforced, not documented

`packages/client/ui-theme/tests/aeven-language-styles.client.spec.ts` resolves the light scheme through the cascade — both sheets in mount order, light `body` blocks only, `var()` chains followed to their literals — and fails when any `--dsw-alias-*` or `--dsw-specific-*` value is an opaque neutral that is not one of the seven. A new alias that picks a step passes; one that invents a grey does not.

## Alternatives considered

- **Keep the platform's alias names and set literals directly.** Rejected because the alias list is long and grows with upstream, so literals spread across it cannot be audited; a ramp names the vocabulary in one place and makes each alias a choice between seven.
- **Prune the upstream static scale from `design-platform.css`.** Rejected as out of scope: many aliases and third-party theme overrides read that scale, and the light scheme no longer exposes the cool steps because the Aeven layer overrides the aliases that used them.
- **Also collapse the dark palette.** Rejected here because dark is a separate inverse ladder whose steps are not the light scheme's; the same ramp discipline can be applied to it on its own evidence.
- **Remove the transcript's forced-black block instead of pointing it at the ramp.** Rejected because it carries a product decision — the light transcript reads at one ink — that predates the ramp and is unrelated to which step that ink is.

## Consequences

- The light scheme holds seven neutrals instead of roughly twenty, and every one of them is visible in one block of `aeven-language.css`; a reviewer reads the palette rather than hunting overrides.
- Chrome that used the two lighter ink steps now reads one step darker, and the primary button's hover now lands on the muted step instead of a step of its own — a larger jump than it had.
- An idle scrollbar thumb sits on the raised step and is close to the surface it lies on; reaching the disabled step under the pointer is what makes it read. A surface that needs a stronger bar states its own rebind.
- The toast and tooltip surfaces draw on ink rather than on the two dark chips they used, so their separation comes from elevation alone.
- Inline code keeps its own ink inside the transcript, where message prose is forced to the ink step.
- The boot page, the markdown engine, the syntax palette, the vendored auth and account sheets, and the component-local literals that used to carry their own greys now agree with the theme they paint inside.
- The dark palette keeps its own scale, so the light and dark schemes no longer share a step count.
