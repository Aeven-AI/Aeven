# Agent Note: The root font size is the client's typographic base

Status: implemented

English | [中文](2026-10-19-root-font-size-type-scale.zh.md)

## Problem

The Font size setting (12–17px, default 16) moved one axis: `--avn-content-font-size` on `body`, plus a second variable a step below it and a pixel delta derived from the pair. Type written as `calc(34px + var(--avn-content-font-delta))` followed the setting; everything else — the settings dialog, the sidebar, menus, the composer, tool output, code blocks, the sign-in screens — was a literal `font-size: 14px`. The result was a reader who chose 17px getting a conversation at 17px inside chrome frozen at 16/14/12, and 473 pixel type declarations across 93 stylesheets that would each have to learn about the axis separately.

## Decision

**The setting writes the document root font size, and client type is stated in `rem`.** `boot-theme.ts` states `documentElement.style.fontSize` before the shell mounts and `ThemePresenter` keeps it current; every `rem` in the client is therefore a fraction of the reader's choice. At the 16px default the rendered sizes are identical to the pixel values they replaced, so the change is invisible until someone moves the setting.

**One ladder, expressed as fractions.** 16px is the base (`1rem`), 14 is `0.875rem`, 12 is `0.75rem`, and the markdown ladder (h1 2.125rem … h6 0.6875rem, prose 1rem/1.75rem, code 0.875rem) is the same ladder at the same rendered sizes. Line heights are stated in `rem` too, so a row keeps its proportion rather than its pixels.

**The delta plumbing is retired.** `--avn-content-font-delta`, `--avn-content-font-delta-secondary`, and the `calc(Npx + delta)` metrics they fed are gone: a metric that used to add the delta for one font-size step is now the fraction that equals it at the default. `--avn-content-font-size` and `--avn-content-font-size-secondary` remain written for surfaces outside this client, but nothing in the client reads them.

**Pixel type is a gate failure.** `scripts/verify-client-type-scale.ts` (script `verify-client-type-scale`, in the client gate group) rejects `font-size`, `line-height`, `font:` shorthands, `--dsw-font-*` tokens, and type-carrying custom properties stated in `px` across `packages/client/*/src` and `packages/api/*/src`. A deliberate exception writes `/* type-scale-allow: reason */` on its line; the iOS focus-zoom floor in `packages/client/web/src/base.css` is the only one, because that 16px threshold is absolute rather than typographic.

## Alternatives considered

**Keep the delta variables and multiply the whole ladder by them.** Rejected: every size keeps two representations (its value and its delta form), the ladder lives in `calc()` strings that no tool can read, and a component that adds a size still has to choose a delta variant.

**Leave pixels and scale with `zoom` or a transform.** Rejected: sub-pixel glyph reflow, a viewport that changes with the setting, and text metrics that no longer match the layout the rest of the CSS is written against.

**Set the base on `body` instead of `html`.** Rejected: `rem` resolves against the root element, so a body-level size would scale nothing; it would have needed every declaration moved to `em`, which cascades through nesting and makes a component's size depend on its parent.

## Consequences

Changing the setting now rescales the whole interface, and the Font size row says so ("Affects the whole interface"). The terminal emulator derives its glyph size from the same snapshot (`Math.round(fontSize * 13 / 16)`), since xterm measures in whole pixels of its own. The gate is the enforcement: `pnpm run verify-client-type-scale` fails on a new pixel size, and its spec pins each admitted and rejected form. The vendored sign-in sheet (`ui-auth-aeven/src/vendor/aeven-auth.css`) and the Figma-exported token sheet (`gradient-shadow-text.css`) were converted with everything else, so the pre-plugin auth screens follow the setting too. Icons keep their pixel geometry for now: they are sized by SVG attributes rather than type, and scaling them is a separate decision.
