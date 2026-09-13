# Agent Note: Popup rows name the provider and mark selection with the highlight

Status: implemented

English | [中文](2026-09-13-popup-rows-name-the-provider.zh.md)

## Problem

A `popupSelect` row rendered its `label`, an optional `detail`, and — for the option the caller marked `active` — a check icon. In the model list the detail was `group.name · model.description`, and the icon took its width from that same line. Reported from the running GUI: DeepSeek rows read `DeepSeek · Fast, efficient, and economical; suited to focused, routine, or parallel tasks. Reads images.` while OpenRouter rows read `OpenRouter`, because `llm-deepseek`'s catalog advertises a description for every model and OpenRouter's advertises none. One picker therefore read differently per provider, and the check icon on the current row narrowed the detail line until the provider name was the part that got truncated away.

The icon was also redundant. [One model picker for both entries](../architecture/2026-09-12-one-model-picker-for-both-entries.md) had already made the shell open its highlight on the row the caller marks `active` and scroll it into view, so the row the icon marked was the row already wearing the hover treatment.

## Decision

A model row's `detail` is the provider group name alone. The blurb moves to a new optional `SelectOption.keywords`, which `filterOptions` matches and `PopupSelectView` never renders: typing a description word still finds the model, and a description sentence stops competing with the provider name for the row's width.

`PopupSelectView` no longer renders the check icon, and `.check` and its `IconCheckOutline16` import go with it. The row the caller marks `active` instead wears the hover treatment as a standing marker: `rowSelected` and the rollover's `rowActive` share one declaration, so the current value keeps the look the pointer gives it and the row spends its width on the label and the detail.

The contract change is additive: `keywords` is optional and no other contribution's rows change shape.

## Alternatives considered

**Drop the description entirely, from the row and from search.** Rejected: it fixes a display problem by silently removing a documented capability — the [README's contract paragraph](../../../../packages/client/ui-commands/README.md) states that search matches the detail text, and the model list is the picker people actually type into.

**Keep the check and let the detail line ellipsize.** Rejected: that is the reported bug. The detail is what carries the provider name, and an icon that marks a row the highlight already marks is the wrong thing to spend row width on.

**Let the opening highlight be the only marker.** Shipped in the first revision of this change, then reversed on sight: with the icon gone and the cursor carrying the selection alone, hovering any other model cleared the current row's treatment and the picker read as unset. The marker keeps the treatment instead; what it costs is that the pointer's row and the picker's row are two highlighted rows while the pointer rests elsewhere, which is the trade this row accepts — one look for both facts, distinguished by their lifetime rather than by a second shade.

**Keep the description in the label.** Rejected: the label is the accessible name and the sort key; a sentence there would swell both, and every row would still read differently per provider.

## Consequences

- Every model row reads as its name plus its provider — `DeepSeek-V4-Pro` / `DeepSeek` — in the same shape for a provider that advertises a blurb and one that does not, and the provider name keeps the row's remaining width.
- A blurb stays searchable: `keywords` feeds `filterOptions` and never reaches the DOM, so no picker can leak search-only text into a row.
- The current value stays marked while the pointer and the arrow keys are elsewhere. The standing marker and the rollover are one declaration rather than two shades, so a picker opened on a current value shows two highlighted rows whenever the cursor leaves it — accepted, because the alternative is a picker that looks unset while holding a value.
- Two `popupSelect` surfaces lose their check icon: the model list and the effort list, which share the shell. Both are opened by the composer seat or `/model`, and both already highlight the row that would have carried it.
- The row contract gains one optional field, recorded in the [one-model-picker note](../architecture/2026-09-12-one-model-picker-for-both-entries.md) and in the `ui-commands` and `ui-model-selection` READMEs.

## Testing

`packages/client/ui-commands/tests/popup.client.spec.ts` pins that `filterOptions` matches `keywords` case-insensitively alongside the label and the detail. `packages/client/ui-commands/tests/popup-view.client.spec.tsx` pins the rendered row: the marked option carries `aria-selected` and no `svg`, and a keyword search filters down to that row while rendering only its label and detail — which is the assertion that fails if the view starts rendering `keywords`. A second case moves the highlight with `ArrowDown` and asserts the marked row still carries `rowSelected` while `rowActive` has moved to the next row, which is what fails if the marker goes back to being the cursor. `packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts` pins the model row itself: a described model carries `detail: 'DeepSeek'` and its blurb in `keywords`.

The web e2e suites read the current row through `aria-selected`, so they keep pinning the opening highlight unchanged, and no golden records the icon or the description.
