---
description: "Sidebar shell plugin for the dsh web client: brand row, New Session action, collapse control, scroll-aware region seat, and bottom-pinned Settings seat."
kind: "package-reference"
---

# @aeven/client-ui-sidebar

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-sidebar` gives the dsh web client an Aeven-style navigation menu: a full-width hamburger row, New Session action, Workspace and Session browser, and bottom-pinned Settings seat. Collapsing the menu returns its layout column to zero width and leaves only the hamburger at the upper-left. The Workspace and Session browser rendered into `sidebar.workspaces` belongs to ui-workspace; this package neither derives its rows nor owns its view preferences. New Session starts the runtime's page-local frontend Session Intent against the explicit, current, or most recently active Workspace.

The expanded panel consumes the Aeven 280px width, translucent white surface, 20px outer corner, 40px row height, responsive row inset, bottom inset, and 400ms easing variables. The menu toggle uses the reference hamburger and double-chevron glyphs; feature action and status icons remain unchanged.

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

The sidebar is the navigation shell: users open it from the hamburger, start new sessions, browse work, and reach Settings. Feature plugins fill its seats — ui-workspace fills `sidebar.workspaces`, ui-settings registers the trigger row and settings panel at `sidebar.settings`.

### Menu and New Session

The hamburger row spans the panel and places its leading glyph 24px from the desktop edge or 16px on small screens. The built-in Aeven presentation hides the replaceable `sidebar.brand.mark` and `sidebar.brand.name` seats. New Session targets the explicit Workspace used by a scoped action, otherwise the current Session's Workspace, otherwise the most recently active Workspace; when none exists it clears into the blank New Session page.

### Collapse behavior

During a live collapse, the panel width and content opacity resolve over 400ms on Aeven's `cubic-bezier(0.23, 1, 0.32, 1)` curve. The layout column ends at zero width; New Session, workspace controls and rows, footer actions, and Settings are hidden, while the 68×40px hamburger button remains fixed at the upper-left. Reduced-motion mode disables the transitions.

### Scrollbars

Scrollbars in the column are a pointer affordance: the shell rebinds the scrollbar indirection to `transparent` whenever the pointer is outside the column and keeps the thumb drawn for 2s after the pointer leaves, so a list nobody is pointing at carries no visible thumb. The scrolling region does not reserve a gutter; non-overflowing rows retain the reference menu's full 280px width.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The shell is pure composition: `SidebarRootComponentProps` composes the layout owner share, the global `useSessions` and `useWorkspaces` hooks, the declared brand, the `sidebar.workspaces` and `sidebar.settings` child slots, and injected `startSession` plus sidebar-toggle callbacks. There is no plugin store.

### Slot discipline

Declaration-aware `slots.inject()` lets a replacing package activate before or after the sidebar. The foot is the `sidebar.settings` seat: the sidebar renders only the bottom-pinned layout slot and shares its column state (`wide`). The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; SidebarRoot, the row components, and the tree derivation remain package-internal behind the slot registration.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the surfaces that fill the shell's seats and the composition model.

- [ui-workspace](../ui-workspace/README.md) — the Workspace and Session browser rendered into `sidebar.workspaces`.
- [ui-settings](../ui-settings/README.md) — the settings domain base registering the trigger row at `sidebar.settings`.
- [ui-layout](../ui-layout/README.md) — the layout owner whose zero-width column state the collapse uses.
- [ui-theme](../ui-theme/README.md) — the scrollbar token indirection the shell rebinds.
- [Slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) — the composition model behind the seats.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the shell owns versus what its occupants own; they are current package constraints.

- **Session state-dot rendering is owned by ui-workspace** — no done/error notification sources are available to this shell.
- **Workspace browser behavior is composition-owned** — grouping, ordering, search, and row state belong to ui-workspace, not this shell.
- **"New task completed" unread marking is local viewing state** — completion-time > last-seen never reaches the host.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. A pure-consumer plugin deriving its rows in-component from the standard useSessions delivery — it emits no cordis events and owns no cross-plugin mutable state; derivation and interaction behavior are asserted directly by this package's tree/component specs.
