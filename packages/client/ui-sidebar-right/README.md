---
description: "Right sidebar for the Web GUI: the per-session column ui-layout reserves, its header toggle and in-panel collapse control, and the width drag that each session remembers; for users and maintainers of the right-hand panel."
kind: "package-reference"
---

# @aeven/client-ui-sidebar-right

English | [中文](README.zh.md)

## Summary

This package occupies the `rightbar` column of the Web GUI layout: each session opens and closes its own panel from the session header, folds it again from a control inside it, and drags the column's inner edge to resize it between 300px and 70% of the frame, at 45% of the frame on first opening. The panel is per session, so switching sessions redraws the column at whatever width that session was left at. Its body is empty until a content package registers at the `sidebar.right.body` seat; the surface, the toggle, and the drag handle all work before any such package exists.

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

Mount this plugin as a row of the client composition; the Web app bundle already carries it as `ui-sidebar-right`, after the `ui-sidebar` row. With a session open, an open-panel control appears in the navigation band at the upper right of the conversation, ahead of the account avatar; clicking it opens the column, clicking it again closes it. Inside an open panel, the collapse control at the panel's upper edge folds the column away, and the drag handle on the column's inner edge resizes it.

### Open, close, and resize

The seat is root-scoped, so the header control reads the current session from the global session list and draws nothing while no session is current. A pointer press on the drag handle freezes the width in force at the start of the gesture and clamps every report into the frame's range; the clamped width is what the store keeps, so a drag cannot close the panel it is resizing. Closing keeps that width for the session, so reopening returns to the width the reader left rather than to the first-open fraction.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`apply` registers the `sidebarRight` locale namespace, registers `SidebarRightRoot` at the frame's `rightbar` seat with the `sidebar.right.body` child declared under it, and injects a toggle into `conversation.navigation.utilities` at order 90 — ahead of the account avatar's order 100. The injection hook receives the session id for a session-scoped seat and closes over it, so the panel's own control toggles the session the seat belongs to.

The frame owns the geometry. `SidebarRightRoot` states nothing about its width: it reads `--avn-frame-rightbar-width`, the custom property ui-layout writes from its store, and resolves its open width from it while `.visible`; a drag is therefore a CSS-only write that never invalidates the transcript's styles. Collapse is the one `.visible` state, so the shell repositions and remounts nothing, and the panel keeps rendering its surface with an unoccupied body.

ui-layout holds the per-session surface in its layout store: `shown` plus a remembered `width`, seeded at 45% of the frame on a first opening and clamped to a 300px floor and a 70% ceiling on every write. The frame resolves the current session's surface to place the column, reads the width into the property above, and draws the rightbar drag handle only while that width is above zero. That state is memory-only, so a reload starts every session closed.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the column's behavior is not enough, or when a panel body is what you are building. They move from the frame the column sits in to the packages the shell is assembled from.

- [ui-layout](../ui-layout/README.md) — owns the `rightbar` column, the per-session width, and the drag handle this panel resizes through.
- [ui-conversation](../ui-conversation/README.md) — renders the navigation band and the session header the open-panel control sits in.
- [ui-sidebar](../ui-sidebar/README.md) — the left sidebar this shell mirrors, fold and resize behavior included.
- [ui-primitives](../ui-primitives/README.md) — supplies the panel and chevron glyphs and the tooltip the controls are labelled with.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the panel is a browser-side surface over the layout column and registers no prompt, tool, or result.

#### KV Cache effect

None; this package never assembles or sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what this shell publishes today. They are current package constraints, not a general comparison of panel features.

- **The body seat has no registered occupant yet** — `sidebar.right.body` is declared and rendered, and nothing registers at it, so the panel draws its surface, controls, and drag handle over an empty body.
- **`tests/` is empty** — the fold toggle, the header toggle, and the integration with the frame's width are not covered by a spec of this package; they are covered indirectly through ui-layout's and ui-sidebar's own suites.
- **Panel width does not survive a reload** — the per-session surface is memory-only, so a reload opens every session closed with no remembered width.
- **Panel content is not owned here** — the shell neither enumerates nor validates what a body occupant draws; the seat is single-entry and per session, and a second registration replaces the first.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This is a pure-consumer plugin deriving its `collapsed` and `width` from the props the frame delivers at the `rightbar` seat; it emits no cordis events and owns no cross-plugin mutable state.
