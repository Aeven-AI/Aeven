# Agent Note: No scrollbars on the model list or the sidebar session list

Status: implemented

English | [中文](2026-09-12-no-scrollbars-on-the-model-list-and-sidebar.zh.md)

## Problem

Two surfaces drew a scrollbar the content never stopped deserving: the model picker's list, which runs to hundreds of catalog rows behind a search field, and the sidebar's session list, which overflows after a handful of sessions. The sidebar's bar was the pointer-revealed affordance from [the pointer-revealed sidebar scrollbars](../../archived/feature/2026-08-04-pointer-revealed-sidebar-scrollbars.md) — drawn while the pointer was over the column and hidden after it left. Even so it read as furniture: the band stayed reserved whether or not the bar was painted, the rows were a band narrower than the panel they sit in, and any pointer movement anywhere in the column brought it back.

## Decision

`ui-theme`'s scrollbar sheet owns a global `.no-scrollbar` opt-out, applied by class name to the scrolling element itself. It states both rendering paths: `display: none` on `::-webkit-scrollbar`, outside the sheet's gate, and `scrollbar-width: none` on the standard half, inside it — one gate carries every `scrollbar-width` in that sheet, and each engine then hides the bar through the path it implements instead of silencing the other.

Two surfaces opt out today: the popupSelect shell's viewport (`ui-commands`), which is the model list and every other command picker built on that shell, and the workspace browser's `.list` (`ui-workspace`), which the sidebar e2e calls the only scrolling region in the column.

The vendored Aeven sheet (`ui-auth-aeven/src/vendor/aeven-auth.css`) states the same class for its own consumers, prefixed with `body`, and happens to load app-wide because the auth mount is in the main module graph. The theme sheet states it as well, so the behavior is owned and tested here rather than inherited from that import graph; the two spellings must stay equal, and the markdown engine's existing `no-scrollbar` call sites now depend on the same class.

This reverses the pointer-revealed affordance, and the reversal is complete: the sidebar's session list draws no bar in any pointer state and reserves no band, so there is no reservation to gain or lose when overflow appears — the invariant the [reserved-gutter work](../bug-fix/2026-07-28-themed-scrollbars-and-reserved-gutter.md) protected still holds, and it now holds without spending 8px of every row on a bar nobody sees. The shell that used to decide that state stopped tracking the pointer: the linger, its timer, the geometric-leave listener, and the `quietBars` rebind are gone, leaving a region that owns its own bar treatment and a column that no longer arbitrates one.

## Alternatives considered

**Keep the reveal and hide the bar only while the pointer is away** — the shipped behavior. Rejected: it kept the band reserved and the rows narrow for a bar that was invisible most of the time, which is the cost the reveal's own note accepted only because the bar came back.

**Rebind the thumb to `transparent` permanently**, which is the sidebar's own mechanism made unconditional. Rejected because it keeps the band: the visible result would match a hidden bar, but the strip would stay empty instead of going back to the rows. That rebind is still the right tool where a bar must be hidden WITHOUT giving up its space; it is not the tool for removing the bar.

**Rely on the vendored sheet's class alone.** It is already loaded app-wide, already used by the markdown engine's code blocks and tables, and needs no new CSS. Rejected as the only definition: the behavior would then depend on an auth chunk remaining in the main graph, and nothing under DSH would state or test it. Stating it twice is the smaller risk, and the duplicate is called out in the sheet.

**Hide the bar in the model list only**, leaving the sidebar as designed. Rejected: the same furniture drew the same complaint on both surfaces, and answering them differently would make the sidebar's bar a special case again.

**Draw an overlay thumb in the app** instead of removing the bar. Rejected for the reason the earlier note already gave: it buys arbitrary styling and costs hit-testing, drag, wheel, momentum, and both palettes' hover states — a large owned surface for a cosmetic gain.

## Consequences

Both lists scroll without a bar and without a band. The sidebar's rows are a band wider and reach the panel's edge; the model list's rows do the same inside their card. Scrolling is untouched — wheel, trackpad, drag-select, and the shell's Arrow keys all still move both lists, which the e2e pins rather than assumes.

No reading depends on the pointer any more, and nothing tracks it: the sidebar shell's pointer linger, its `quietBars` state class, and the two specs that drove them were retired with the affordance they served, so no listener, timer, or DOM state class is left behind.

The scrollbar skin is unchanged for every other surface: the `--dsw-alias-scrollbar-*` tokens, the `--dsh-scrollbar-*` rebind contract, and the elevated-surface pair all still govern what draws a thumb. Only the two opted-out regions sit outside it.

The capability given up is the hover affordance itself: a pointer over the sidebar no longer reveals where the session list ends and how far it can scroll. Reintroducing it means removing the opt-out class from that list and rebuilding the pointer machinery and its `transparent` rebind, which this change deleted.

## Testing

`ui-theme`'s scrollbar spec states the utility on both paths and keeps the sheet's one-gate rule intact: every `scrollbar-width` in that sheet, the opt-out's included, sits inside the `@supports` gate, and the pseudo-element rule sits outside it.

`apps/web/tests/sidebar-scrollbar.e2e.ts` measures a real engine instead of trusting the declaration: the list overflows (vacuity guard), `scrollbar-width` resolves to `none`, the reserved band is 0, the first row reaches the sidebar's edge and the content area ends at the border box, the list still scrolls programmatically, the rows keep that geometry whether or not the list overflows, and the readings are identical with the pointer over the list and away from it. Its committed golden records the geometry and resolved style in both palettes.

`apps/web/tests/default-model.e2e.ts` pins the same opt-out on the popupSelect list from the composer's model button, reading the computed `scrollbar-width` off the open listbox.

`ui-sidebar`'s shell snapshots pin the root class of the expanded and collapsed column, which is how the retired state class stays out: `quietBars` appears in neither.

## Related

The [pointer-revealed sidebar scrollbars](../../archived/feature/2026-08-04-pointer-revealed-sidebar-scrollbars.md) Agent Note owns the affordance this reverses; it is archived alongside this change, because the mechanism it describes — the pointer tracking, its linger, and the `transparent` rebind — no longer exists. The [reserved-gutter fix](../bug-fix/2026-07-28-themed-scrollbars-and-reserved-gutter.md) owns why the band was reserved in the first place. The [model picker](../architecture/2026-09-12-one-model-picker-for-both-entries.md) Agent Note owns the list that is one of the two opted-out surfaces.
