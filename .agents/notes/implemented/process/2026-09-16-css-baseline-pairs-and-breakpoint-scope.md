# Agent Note: CSS baseline pairs and breakpoint scope

Status: implemented

English | [中文](2026-09-16-css-baseline-pairs-and-breakpoint-scope.zh.md)

## Problem

`verify-css-baseline` holds every client stylesheet to the iOS/Safari 14.5 floor, and two of its rules decided more than the floor and the documented scale do.

The dynamic-viewport rule read a stylesheet by lines: a `dvh`, `svh`, or `lvh` declaration was legal only when the line above restated the same property in `vh`. CSS has no line semantics. The floor drops a declaration whose value it cannot parse and keeps the earlier declaration of the same property, so a fallback stated before the dynamic unit in the SAME block is equivalent to one stated on the line above — and the line rule rejected the same-line pair `max-height: calc(100vh - 48px); max-height: calc(100dvh - 48px);`, which the floor renders exactly as intended. It also accepted a `vh` value written for another property merely because it sat on the preceding line, and could pair a `dvh` with a `vh` from a different rule.

The breakpoint rule applied the five-step responsive scale to any `(max-width: Npx)` condition in a stylesheet. That scale is the VIEWPORT scale; a `@container` prelude measures the element's own box, a different axis. Its width was reported as an off-scale breakpoint with the remedy "use one of the 1284 / 1024 / 768 / 640 / 480 steps", which cannot be acted on for a container, and it double-reported an at-rule the `container-query` entry already rejects.

## Decision

A dynamic viewport unit is legal exactly when the same property already states a static `vh` value in an earlier declaration of the same block. `findUnpairedDynamicViewportUnits` reads declarations with the block that holds them (`declarationsIn`) instead of lines, and looks the fallback up in that block. A `vh` value for another property, a fallback in a sibling rule, and a value holding both spellings in one declaration (`min(100vh, 100dvh)`, which the floor drops whole) all stay violations, and each violation names the line carrying the dynamic unit.

The five-step scale governs `@media` width conditions only. `findOffScaleBreakpoints` matches a width condition only inside the prelude of a preceding `@media`, so a `@container` prelude is out of scope and every `@media` width outside 1284 / 1024 / 768 / 640 / 480 still fails the gate. `container-query` remains the entry that rejects the query itself.

## Alternatives considered

**Ban `dvh` outright.** Simpler to state and to check, but it rejects the spelling the floor handles correctly — a `vh` declaration the engine parses followed by a dynamic unit later releases override — and it would fail the two shipped sheets that already use the pair, at `DirectoryBrowser.module.css` and `RiskConfirmation.module.css`.

**Keep the line rule and only allow the dynamic unit as the second declaration of its line.** Accepts the same-line fixture without a block parser, but keeps the two false results above: a `vh` fallback for another property on the preceding line pairs nothing, and a fallback inside a nested rule does not reach the dynamic unit.

**Apply the scale to every width condition, container queries included.** The container query is rejected by `container-query` either way, so the extra entry only adds a duplicate diagnostic with a remedy the author cannot apply.

**Extend the scale rule to non-`px` widths (`40em`).** A real gap — the rule matches `\d+px` only, so an `em` media width is unchecked — but no governed sheet writes one, and widening the rule would fail the gate on stylesheets this change does not own.

## Consequences

The gate now accepts every spelling the floor renders as intended and rejects every spelling it does not, so an author is no longer pushed to restate a same-line pair onto two lines. The detector reads declarations rather than lines: its cost is one pass over each stylesheet, and its scope is a declaration block, so a dynamic unit whose fallback sits outside its own rule is reported rather than paired.

`packages/client/**` and `apps/web/src/**` are unchanged by this decision: the two shipped `dvh` declarations are two-line pairs and stay legal, and every governed `@media` width is already on the scale.

## Testing

`scripts/verify-css-baseline.spec.ts` pins the same-line pair as accepted, the `rejects the value-level features` fixture as rejected, a `vh` fallback for another property and a fallback inside the dynamic unit's own declaration as rejected, and a `@container (max-width: 461px)` prelude as reported by `container-query` alone. The spec keeps its line-reporting and `governedStylesheets()` assertions, which cover 121 sheets.
