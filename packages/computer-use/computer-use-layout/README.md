---
description: "Slide layout as pure geometry: parameterised layouts computed from a grid, needing no application and no tool."
kind: "package-reference"
---

# @aeven/computer-use-layout

English | [中文](README.zh.md)

## Summary

Seven parameterised slide layouts, computed from a declared grid. Taken from the recipe catalog the Codex application ships — 41 slide layouts, each a parameterised `run` over a declarative drawing API with coordinates derived from a 12-column grid rather than discovered by looking at the screen.

The structural idea worth taking is that **layout is pure geometry**: a recipe takes parameters and returns positioned shapes. It touches no application and needs no tool, so this module is deliberately free of I/O. Rendering the result to a file is a separate concern with its own readiness requirements, and keeping the two apart is what makes the interesting part verifiable **on any machine** — including this one, where it is the only capability in the stack that runs with nothing installed.

That is also the answer to the formatting problem. A parameterised layout verified through its **computed geometry** is strictly better than an operation sequence verified by pixels, because a shape that overflows the slide is wrong regardless of what a screenshot shows.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limited-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```ts
import { layoutDeck, overflowing, overlapping } from '@aeven/computer-use-layout'

const deck = layoutDeck([
  { kind: 'cover', title: 'The Cartographer of Small Hours', subtitle: 'A short story' },
  { kind: 'bullets', title: 'Agenda', items: ['Vell', 'The stopped clock', 'Two times'] },
  { kind: 'metrics', title: 'Traction', metrics: [{ value: '4.2M', label: 'Revenue' }] },
])

overflowing(deck[0]!)   // [] — no shape falls outside the slide
overlapping(deck[1]!)   // role pairs that coincide, which the caller judges
```

## Understand the implementation

### The grid is declared, not hard-coded per layout

`DEFAULT_GRID` fixes 12 columns, an 80-unit margin, and gaps that are multiples of 8, chosen so they divide the 1366×768 surface evenly. Every layout positions against it, which is what makes a deck internally consistent and lets a layout be reasoned about without reading it: a full-width shape is the content width, and `spanWidth(grid, 4)` is the same value in every recipe.

`snap()` rounds to the base unit, so a shape's edge is a value a test can state exactly rather than a float it must tolerate.

### Verification is geometry, not pixels

`overflowing()` reports shapes that fall outside the surface, which is a fact about the computation. `overlapping()` reports coincident role pairs **without judging them**, because overlap is sometimes the design — a title band sits over a background deliberately — so the caller decides which roles may legitimately coincide.

That distinction is the reason this layer is worth having: an operation sequence verified by pixels cannot establish that nothing overflows, and a screenshot of a correct deck looks identical to a screenshot of one that is one unit too wide.

### Fills are parameters, so a deck restyles without editing a layout

`LayoutFills` is resolved once and fully required, so a layout reading `fills.accent` always gets a string instead of inventing a fallback at every use site. Passing `{ fills: { band: 'slate-900' } }` changes the band and leaves the rest at their defaults.

## Further Exploration

- [`@aeven/computer-use-formats`](../computer-use-formats/README.md) — rendering a layout to a file, which is where the tool requirements live.
- [`computer-use-source-inventory.md`](../../../../workspace/project/computer-use-source-inventory.md) — why this capability is taken from Codex rather than reimplemented from a repo.

<a id="known-limited-work"></a>
## Known Limitations and Deferred Work

- **Seven layouts, not forty-one.** The catalog has 41 slide layouts including an eleven-recipe pitch deck; these are the seven kinds that carry distinct geometry, and the rest are parameterisations of them.
- **No renderer.** This package computes geometry and stops. Writing it to a presentation file needs `python-pptx`, which is blocked on this machine, so no deck can be produced here yet.
- **`agenda` is `bullets`.** The catalog ships them separately with different styling; here only the geometry differs, so they share a layout until the renderer can express the difference.
- **No chart layouts.** The catalog's `chartStyle` and `chartType` recipes are a different concern — they style a chart the drawing API produces, which needs that API.
- **Nothing reads a deck back.** A layout is verified by its own geometry; confirming what a rendered file actually contains needs the format layer's reader.

<a id="dev-note"></a>
## Dev Note

`exactOptionalPropertyTypes` caught a real looseness here: resolved fills were `string | undefined`, which would have forced every layout to invent a fallback for a value `resolve()` always provides. The type now says a resolved option is resolved.

Writing the tests caught a second thing worth recording. Two helper names were imported that had never been written, and the suite passed anyway — vitest does not typecheck. The names were removed and the exports checked against the imports directly, because a green run is not evidence that the code refers to anything.

**Runtime invariant:** No companion is published because The package computes slide geometry as pure functions from a spec, so its output is total and comparable by value; there is no sequence of effects to observe.
