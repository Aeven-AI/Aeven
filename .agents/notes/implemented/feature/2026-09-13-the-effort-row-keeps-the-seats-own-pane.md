# Agent Note: The effort row keeps the seat's own pane

Status: implemented

English | [中文](2026-09-13-the-effort-row-keeps-the-seats-own-pane.zh.md)

## Problem

[One model picker for both entries](../architecture/2026-09-12-one-model-picker-for-both-entries.md) gave both of the composer seat's rows the shared `popupSelect` shell: the Model row opens the searchable catalog list `/model` registers, and the Effort row opened the current model's advertised levels through that same shell — search input included. The unification removed real drift, and it is right for the model list, where a catalog runs to hundreds of rows and typing at a description is how people find one.

It is wrong for the effort list. An adapter advertises three or four levels (`Off`, `Low`, `High`, `Max` in `llm-deepseek`), all of them visible at once, so the shell's search input was the first row of the card and could only filter rows the reader was already looking at. Reported from the running GUI: opening the seat's Effort row showed a search box over a one-screenful list, which reads as a heavier control than the choice deserves.

## Decision

The Effort row drills into the seat's own pane again — Figma 496:26454's list rows inside the same card, the level in force carrying a trailing check, `ArrowUp`/`ArrowDown` moving focus, and Escape returning to the root before it closes the card. No search input, no second card. The Model row is unchanged: it still hands over to the shared shell, one card being the point there.

What stays shared is the part that could actually drift between the two: `src/client/effort.ts` owns `effortLevelsOf` (the levels the pane renders) and `effortSelectionOf` (the selection a picked level resolves to), and `effectiveEffortOf` states which level is in force. The pane and the submit verb read that one module, so a level the adapter does not serve cannot be rendered, and a level the pane renders cannot fail to resolve. The seat submits through a new injected `selectEffort(levelId)` rather than a shell spec, and the seat — not the shell — surfaces a refusal, through the shared `Toast` anchored to the composer card.

`effortPopupSpec`, `effortOptionsOf`, and the shell's effort row ids are deleted rather than left unused.

## Alternatives considered

**Keep the shell and hide its search input behind a spec flag.** Tried first and withdrawn: it left the effort list rendering in a card anchored to the composer card rather than to the seat, with the shell's empty/loading/retry copy and its own dismissal rules, for a control whose whole job is four rows. The flag also made the shared contract carry an option no other contribution used.

**Keep the shell with its search input.** That is the shipped state this note replaces: a filter over four rows can only hide them, and the input costs the card a row of height above the composer.

**Inline the levels as rows of the root chooser.** Rejected: the chooser's row set would then depend on the current model's metadata, and an adapter with eight levels would push the Model row off the card.

**Give the effort list its own component with its own CSS, ported wholesale from the pre-unification seat.** Rejected as a copy: the original's list markup is worth keeping, but its row and failure surfaces should keep reading the shared store and primitives, which is what makes this a restore rather than a fork. The pane is one row style, one check, and one notice.

## Consequences

- The seat's Effort row opens four levels, checked at the one in force, with no search input and no second card; picking one keeps the route and swaps only the effort, exactly as before.
- The seat owns a list again — the drift [one model picker](../architecture/2026-09-12-one-model-picker-for-both-entries.md) removed is back for this one list. Bounded deliberately: the row derivation and the selection resolution are one module, and the seat's list is four rows of adapter-provided names with no filtering, no failure strip, and no empty state to keep in step with the model list.
- A refused level no longer closes the card silently: the pane stays open and the shared Toast carries the store's error text.
- The `/model` command and the seat's Model row are untouched: one spec object, one shell, one searchable list.

## Testing

`packages/client/ui-model-selection/tests/model-select.client.spec.tsx` pins the pane: the Effort row drills in place (the Model row's opener is not called), the rendered levels are the model's own with `aria-checked` on the effective one, picking a different level calls `selectEffort` with that level's id and closes on acceptance, Escape backs out to the root first, and a refused level keeps the pane open and renders the notice. `packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts` pins the wiring: the Model row opens the registered spec object, the Effort row opens nothing in the shell, `selectEffort` resolves the level against the live snapshot and submits a route-preserving selection, the provider-default level submits no `reasoningEffort` at all, an unknown level id is refused, and an addressed subagent session gets a refusal rather than a submission.
