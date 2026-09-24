# Agent Note: Row actions are revealed by the pointer or the keyboard, never by selection

Status: implemented

English | [中文](2026-09-24-pointer-revealed-row-actions.zh.md)

## Problem

Every sidebar row keeps its controls in one trailing cell — a folder row's New Session button and a Session row's options menu — and [`WorkspaceBrowser`](../../../../packages/client/ui-workspace/README.md) hides that cell at rest: `.rowActions` declares `opacity: 0` and `pointer-events: none`. The reveal that brought the cell back named each row kind on its own and answered only the pointer and the row's own open menu (`.projectRow:hover`, `.sessionRow:hover`, and the two `.menuOpen` selectors), so a keyboard reader had no route into it: `pointer-events: none` leaves the buttons in the tab order, and no selector revealed the cell when one of them took focus. The same cell also carried a folder-only `height: 20px` override, so one cell had two heights depending on which row kind it sat in.

Selection was the other half. A selected Session row paints no fill — `.sessionRow.selected` states a transparent background — and its leading mark stayed at the resting ink, so nothing in the row itself said which Session the pane was showing: the mark only came up on hover or with the row's own menu open.

## Decision

Both row kinds share one reveal list: `.projectRow:hover .rowActions`, `.projectRow.menuOpen .rowActions`, `.sessionRow:hover .rowActions`, `.sessionRow.menuOpen .rowActions`, and `.rowActions:focus-within` set `opacity: 1` and `pointer-events: auto`. Selection is not in it, and the stylesheet carries no `.sessionRow.selected .rowActions` rule: a selected Session row's options menu stays hidden until the pointer, the row's own open menu, or focus asks for it.

Selection is carried by the leading mark instead. It is a bare circle (`IconLucideCircle`) at a resting `opacity: 0.1`, and `.sessionRow.selected .idleMark` brings it to `1` beside the existing hover, open-menu, and search-result reveals. The inked circle is therefore what says which Session the pane is showing, and the actions cell is not part of that answer.

`:focus-within` sits on the actions cell rather than on the row, and that placement is deliberate. A Session row's own link (`.sessionLink`, the row's `<a>`) holds focus after a plain pointer click in browsers that focus a link on click, so a row-level selector would keep the actions revealed for as long as that link held focus; on the cell, only focus that actually lands on an action reveals it.

The cell keeps its room and only fades: `.rowActions` gains `transition: opacity 150ms var(--ds-ease-in-out)`, so a reveal never re-measures the title beside it. Dropping the folder-only `height: 20px` override needs no compensation — `.iconButton` is a fixed 18px box inside an inline-flex cell, and the row is a fixed height that centres its children, so the override only made the cell 2px taller than the icons it holds.

## Alternatives considered

**Put `:focus-within` on the row rather than on the cell.** Rejected: a Session row's link holds focus after a plain pointer click in browsers that focus a link on click, so the row-level selector would keep the actions revealed for as long as that link kept focus, and the reveal would stop meaning "the pointer is on this row".

**Reveal on `:has(:focus-visible)`.** Rejected: no stylesheet under `packages/` or `apps/` uses `:has(`, and the extra state it distinguishes — focus that is not visibly keyboard-driven — is not one the sidebar has; `:focus-within` on the cell already limits the reveal to the action that holds focus.

**Keep the folder row's New Session button on screen without the pointer.** Rejected: one row kind holding an action permanently visible while the other hides its own teaches two discovery rules for one list. The button's accessible name names the folder it starts a Session in, and the folder row's hover card repeats the Workspace's path and creation time, so the action stays nameable without the button staying drawn.

**Reveal the Session row's actions on selection as well.** Rejected: it would put the options on screen for the row the reader is already looking at, which is where the pointer is most likely to be, and it competes with the circle ink that now names the selection. The style spec pins the rule's absence, so a later change cannot re-add it quietly.

## Consequences

- One reveal covers both row kinds: the pointer on the row, the row's own open menu, or focus landing inside the actions cell. A selected Session row reveals nothing on its own, and the stylesheet has no `.sessionRow.selected .rowActions` rule.
- Selection is read from the leading circle — `0.1` at rest, `1` when the row is selected or hovered — so a folder row's New Session button is revealed rather than permanently drawn. Always-visible returns only if the pointer, the row's menu, and the cell's focus stop being discoverable routes to it: a sidebar driven by touch alone, or a list whose reader must learn that a chat can start from a folder without pointing at a row. `Rows.module.css` owns that rule and `browser-styles.client.spec.ts` pins it, so returning to always-visible is one selector plus that case.
- A reveal costs no layout: the cell keeps its width and fades in 150ms with `var(--ds-ease-in-out)`, and the dropped folder-only height changed only the cell's own box inside a fixed-height row.

## Verification

`packages/client/ui-workspace/tests/browser-styles.client.spec.ts` reads `Rows.module.css` as text and pins the reveal: `.rowActions` at `opacity: 0` and `pointer-events: none`; `opacity: 1` and `pointer-events: auto` for `.projectRow` and `.sessionRow` under `:hover` and `.menuOpen`; the same pair for `.rowActions:focus-within`; and no rule at all for `.sessionRow.selected .rowActions`. A second case in the same file pins the mark — `.idleMark` at `0.1`, `.sessionRow.selected .idleMark` at `1`.

`npx tsx scripts/run-tsc.ts tsconfig.client.json` exits 0, and so does the host program. The browser half was rebuilt with `pnpm --filter @aeven/client-ui-workspace bundle`; the shipped `lib/client.js` carries the five-selector reveal list under hashed class names, with `focus-within` present, and no `.sessionRow.selected .rowActions` rule.
