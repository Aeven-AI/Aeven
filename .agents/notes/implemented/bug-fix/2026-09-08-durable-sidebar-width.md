# Agent Note: Durable Sidebar Width

Status: implemented

English | [中文](2026-09-08-durable-sidebar-width.zh.md)

## Problem

The layout store held every panel width in memory only, so a page reload always reopened the sidebar at `SIDEBAR_DEFAULT`. A user who collapsed the column, or dragged it to a width they preferred, lost that on every refresh — the one piece of shell geometry they set deliberately and expect to find again.

## Decision

The layout store persists the sidebar width alone, under `avn.layout.panels`. A closed sidebar is the width `0`, so a column the user collapsed reloads collapsed. The details width and the narrow-viewport pair (`narrow`, `narrowExpanded`) stay per-page: details keeps its [closed default](../../archived/bug-fix/2026-07-30-web-details-default-closed.md) and reopens from an explicit selection, and the narrow pair is a reading of the current viewport that `AppFrame` re-derives from `matchMedia` on mount.

Persisting one field of a store is a `avn-client-store` declaration: `persist` accepts either the key alone (whole-state persistence, unchanged) or `{ key, fields }`. Hydration with a field list seeds `init()`'s state and adopts a stored field only when the revived value is non-null and carries the initial value's `typeof`, so a truncated, stale, or hand-edited entry loses that field instead of poisoning the store. Writes serialize the declared fields only, so a field that leaves the durable set stops being written without a key rename.

This supersedes the transient-store fact recorded in the [details Session lifecycle note](2026-07-29-web-details-session-lifecycle.md); that note's details-ownership decision is unchanged.

## Verification

`store.client.spec.ts` covers a field list persisting its fields alone, the rest of the state returning to `init()` on reload, and rejection of a wrong-typed, null, missing, or non-object stored entry. `layout-store.client.spec.ts` covers the sidebar width surviving a reload, a closed sidebar reloading closed, details and the narrow pair not being written, and a non-numeric stored width falling back to the default. `app-frame.client.spec.tsx` clears storage per case so each mount is its own page load.

## Alternatives considered

**Persist the whole layout state under one key.** It needs no framework change, but it also restores `details` — contradicting the archived closed-by-default decision — and restores `narrow`/`narrowExpanded`, so a desktop reload after a narrow session paints one frame with the sidebar collapsed before the mount effect corrects the breakpoint.

**Hand-roll storage inside `createLayoutStore`.** Reading in `init()` and subscribing to the instance keeps the change inside `ui-layout`, but it puts a second persistence implementation beside the framework's and writes outside the store's declared action set.

**Write the preference from `AppFrame`.** The frame is a pure component fed by the three framework shares; a storage effect there splits ownership of the preference between the store and the component that renders it.

**Version the storage key (`.v5`-style) instead of validating fields.** That is the existing whole-state idiom, but it needs a rename on every state change and still adopts a corrupt entry of the right vintage. Field-level `typeof` validation makes the durable boundary self-checking.

## Consequences

The sidebar the user left is the sidebar they come back to, on the first frame — hydration happens at store construction, before the first render, so nothing flashes. `localStorage` gains one key per browser profile. Two live instances created under the same key share that entry — the boundary `EngineStoreHandle.create` documents — and production creates one root instance under the [framework-owned store lifecycle](../architecture/2026-07-22-slot-type-chain-implementation.md). Tests that mount the frame more than once must clear storage between cases, since a collapse in one case would otherwise seed the next mount.
