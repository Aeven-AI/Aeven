# Agent Note: The no-Workspace composer carries no stroke of its own

Status: implemented

English | [中文](2026-09-12-no-workspace-composer-ring.zh.md)

## Problem

The no-Workspace composer card wore a dashed l4 ring at rest, drawn as an `::after` SVG dash ring, to mark the card as the Workspace picker's trigger. A reader reaches that exact state without asking for a picker: archiving the selected Session leaves no Session and no workspace, so the resident composer drops into the trigger posture on its own. The dotted outline then reads as an input artifact — a focus or drop-target decoration around an empty box — rather than as an affordance, and nothing in that moment announces a pending choice.

## Decision

`packages/client/ui-conversation/src/client/input/InputBar.module.css` keeps `.cardWorkspaceTrigger` as the flat surface it would be anyway: the transparent elevation stroke and the pointer cursor, with no ring rule and no hover recolor. The card still owns the full-capsule click, the read-only draft still activates the picker on Enter or Space, and `.cardWorkspaceTrigger :disabled` still lets pointer events fall through the toolbar, so the pick target and the accessibility contract are unchanged. The Workspace chip above the card keeps carrying the visible invitation, and the placeholder text keeps naming the required action.

## Verification

`packages/client/ui-conversation/tests/input-bar-styles.client.spec.ts` reads the stylesheet as CSS text and asserts that the only rules mentioning the trigger state are `.cardWorkspaceTrigger` and `.cardWorkspaceTrigger :disabled`, and that no SVG dash pattern remains in the module. Component coverage for card-wide pointer activation, keyboard activation, and the picker's expansion echo is unchanged and lives with the entry's other specs. `pnpm exec vitest run packages/client/ui-conversation` passes 34 files and 394 tests.

## Alternatives considered

**Keep the ring and show it only on hover.** A pointer-only affordance disappears for keyboard and touch readers, and the reviewer asked for the ring to be gone, not deferred.

**Keep the ring and show it only on keyboard focus.** The state still paints a dotted outline over an empty composer for the reader who arrives by archiving, which is the case the ring failed.

**Replace the ring with a filled surface or a label inside the card.** The card already sits on a distinct major-input surface, and the chip plus placeholder already state what is required; a second signal adds weight to a state the reader is passing through.

## Consequences

The no-Workspace card is visually identical to any other resting composer and stays clickable end to end. The state loses its at-a-glance "this is a picker, not a text field" cue, so discovery rests on the Workspace chip and the placeholder copy; reintroducing a cue means a non-dashed one rather than the ring restored.
