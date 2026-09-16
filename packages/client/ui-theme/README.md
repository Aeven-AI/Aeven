---
description: "Theme and content-font-size settings for the dsh web client: --dsw-* token stylesheets, ThemeRuntime state, General settings rows, and the pre-plugin bootstrap."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-theme

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-theme` lets Web GUI users choose `light`, `dark`, or `system` and set conversation content text from 12 to 17 px in Settings. A loopback client stores both values in the `ui-theme` settings namespace, which the local provider persists in `$DSH_HOME/settings.yaml` by default. The plugin resolves `system` through `prefers-color-scheme` and publishes immutable `ThemeSnapshot`s; ui-layout applies each snapshot to the document. The package also ships the `--dsw-*` token stylesheets and injects a synchronous bootstrap so the selected palette and font size apply before the static shell preloader paints. Third-party themes can register alias-token overrides through `ctx.theme`.

The Aeven baseline is centralized in `aeven-language.css`: Google Sans Flex font roles, warm-neutral color aliases, 1024px chat width, responsive page and sidebar insets, 280px sidebar width, 400ms sidebar transition, spacing, control size, and corner radii are single-source variables consumed by component CSS.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Users switch the color scheme and content font size from two rows in Settings (General section); both choices persist across restarts on a loopback browser. Feature plugins consume the current snapshot through `ctx.theme` and read the `--dsw-*` tokens in CSS; they do not manage theme state themselves.

### Appearance and font size

The plugin registers Appearance preference cubes and a font-size stepper in the General section. The stepper accepts integer values from 12 through 17 px and defaults to 14 px. It changes conversation headings and base text by the same increment, including the user bubble and composer draft; flow-row titles, summaries, and tables follow one step under the body size, while small text and code keep fixed sizes. Each accepted change writes through the Host settings API. Rapid changes serialize in gesture order with namespace revisions, and a rejected latest write reloads the durable values. Non-loopback pages keep both choices process-local.

### Registering a theme

A composition can register a third-party theme id with alias-token overrides through `ctx.theme`; the override layer folds into the active snapshot's tokens in registration order. Removing one never overwrites the last durable built-in preference. Third-party theme ids remain an in-process extension and do not cross the built-in settings schema.

### Pre-plugin palette

When the host composition includes an HTTP server, the host half embeds the registered `ui-theme` settings, or schema defaults, into each index response. Before the loading page renders, the browser sets `color-scheme`, `body[data-ds-dark-theme]`, and `--dsh-content-font-size`, so the first paint uses the selected palette and text size.

### Static shell preloader

`apps/web/index.html`, rather than ui-theme's Host plugin, owns the brand mark and spinner markup. The production build inlines that stylesheet in the document head, so the visual is styled before the entry module, module loader, or React runs. The Host-injected theme bootstrap remains immediately after the opening body tag and selects the static visual's light or dark fallback before it paints.

The Web boot kernel owns dismissal and failure presentation; see [dsh-client-web](../web/README.md). ui-theme owns only the palette state applied to the static visual.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The service owns theme and font-size state and publishes snapshots. The ui-layout presenter applies those snapshots, and the token sheets own the color and conversation text scales.

### Stylesheets

`src/styles/` holds six sheets imported in order by ui-theme's dynamic client entry: `base.css`, `design-platform.css`, `scrollbar.css`, `gradient-shadow-text.css`, `aeven-language.css`, and `highlight.css`. The client bundle compiles and injects them as plugin-owned global styles, so unload and HMR remove them with ui-theme. `scrollbar.css` is the sole consumer of the `--dsw-alias-scrollbar-*` tokens and must follow `design-platform.css`, which declares them. `aeven-language.css` follows the generated typography sheet so its product baseline can map shared variables without duplicating component rules. `highlight.css` colors highlight.js token classes for tool cards and markdown fences.


`gradient-shadow-text.css` derives `--dsh-content-font-delta` from `--dsh-content-font-size` and shifts the Markdown heading and base-text ladder by that increment. The secondary tier `--dsh-content-font-size-secondary` covers the table variants and the flow rows one step under the body, with `--dsh-content-font-delta-secondary` carrying its leading shift. That tier's mapping lives in `secondaryFontSize` in `src/theme-settings.ts` — one step below 14, two steps below 16 and up, and the 14px floor at 14 and 15, where the step down would land on 13px — because no `min`/`max` chain over the body size can skip a single value in the middle of a ladder; the sheet declares only the fallback the boot script and the presenter overwrite. Dense small and code variants stay fixed — the smallest step is the exported 14px/20px one — and every composite font token states 450 explicitly, because a `font` shorthand that omits a weight resets it to 400. Outside the ladder, the user bubble and composer draft read the body pair directly, and flow-row titles and summaries read the secondary pair. The sheet also owns the shadow scale (`--dsw-shadow-lv*`) and the elevation tokens: `--dsw-elevation-stroke` draws a 0.5px hairline through the rebindable `--dsw-elevation-stroke-color`, and `--dsw-elevation-panel`/`--dsw-elevation-prominent` layer two faint soft shadows over that stroke, so elevated surfaces set `border: 0` and carry no layout-consuming outline; the derived tokens are re-declared per element so a surface's stroke-color rebind takes effect. The Aeven composer deliberately consumes none of these shadows ([elevation note](../../../.agents/notes/implemented/feature/2026-09-01-web-elevation-stroke-shadows.md)).

### Scrollbar rebinding

`scrollbar.css` binds `--dsh-scrollbar-thumb` and `--dsh-scrollbar-thumb-hover` on `body` to the l1 base-surface tokens; an elevated surface (menu, popover, dialog) rebinds them to the l2 tokens on its own container, and the pair's other legal target is `transparent` (ui-trajectory's summary region rebinds it that way until hover or focus-within). The standard property — `scrollbar-width: thin` — is declared on `body *` for every engine that implements it, because it is the only path that leaves a scrolling box its full width: a `::-webkit-scrollbar` skin is what forces the bar into a gutter and takes that band off the box. The pseudo-element skin is the fallback, inside `@supports not (scrollbar-width: thin)`, for the engines that cannot honor the standard properties (chromium before 121, WebKit before Safari 26.2), so the hover token renders only on that path. No sheet compensates a bar's width any more: the conversation scrollport reserves its gutter symmetrically, and reserves nothing at all where the bar floats ([scrollbar note](../../../.agents/notes/implemented/bug-fix/2026-09-13-overlay-scrollbars-return-the-gutter.md)).

### Preference persistence

The service provides itself immediately with the schema defaults on a loopback browser, then loads the `ui-theme` namespace and writes each accepted theme or font-size change through the Host settings API. Pushed settings changes and reconnects refetch the namespace. Non-loopback pages do not create that Host-backed scope. The persistence boundary is owned by the [Host-backed preferences note](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the layout presenter, the token consumers, and the styling rules.

- [ui-layout](../ui-layout/README.md) — the presenter that applies the resolved theme snapshot.
- [ui-sidebar](../ui-sidebar/README.md) — a consumer of the scrollbar rebinding contract.
- [ui-conversation](../ui-conversation/README.md) — the composer seat and the view chrome that centre on the scrollport's symmetric gutter.
- [Web styling](../../../docs/web-styling.md) — the authoritative styling rules for web client components.
- [Host-backed preferences](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md) — the persistence boundary decision.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the theme extension surface and the color authority; they are current package constraints.

- **Third-party themes are an extension point, not a product** — registering one means overriding same-named alias variables; no validation exists that an override set is complete.
- **The token sheets are the sole color authority** — values absent from the design system are deliberately not appended; the nearest semantic token wins, and design-owner-approved additions enter as a static step plus a semantic alias in the same change.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The settings scope validates and publishes the durable theme section, while the registry emits `theme/change` synchronously with its own mutations. Store/registry agreement is covered directly by this package's Host, scope, and service behavior specs.
