---
description: "Cordis dynamic-plugin browser surfaces for users and maintainers choosing, composing, or debugging tool cards and @pluginId input."
kind: "package-reference"
---

# @aeven/client-ui-cordis

English | [中文](README.zh.md)

## Summary

`avn-client-ui-cordis` gives a web client tool cards that render `cordis_define`, `cordis_run`, `cordis_stop`, and `cordis_undefine` calls in the conversation, and an `@pluginId` input source that completes the session's defined plugins. The package authors nothing the model sees: the cards render call and result content the conversation already logged.

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

Compose this package in a web client that also mounts the browser runner and the host runner to add the tool cards and `@` completion. It registers no sidebar action.

### What the tool cards show

The `cordis_define` card is a record: the name and purpose the model wrote, the source it wrote, and whether the definition is running. The `cordis_run` card shows the mode, the plugin, package, and run ids, the outcome, and offers the package's own business view through the `tool.view.cordis` slot when the package registered one. `cordis_stop` and `cordis_undefine` render compact action rows. All cards render from the recorded call and result, so replay shows the same card.

### The @pluginId input source

Typing `@` in the input offers the current session's defined plugins; picking one emits `@pluginId`, which the tool package turns into a pinned reference context for the model.

### Boundaries to plan around

Definitions are process-local: a reloaded page holds nothing until a package runs again. The cards and `@` completion read the host inventory, which refreshes on announcements.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design behind the surfaces; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The cards do not keep run state in component state, because settling a define call moves its card in the chat flow and remounts it. The browser runner owns this page's live set, while this package owns the inventory it reads and refreshes after announcements.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Plugin entry: slot registrations, inventory wiring, `@pluginId` source |
| [`src/client/CordisDefineRow.tsx`](src/client/CordisDefineRow.tsx) | The read-only `cordis_define` card |
| [`src/client/CordisRunRow.tsx`](src/client/CordisRunRow.tsx) | The `cordis_run` card and its business-view seat |
| [`src/client/CordisActionRow.tsx`](src/client/CordisActionRow.tsx) | The `cordis_stop` / `cordis_undefine` rows |
| [`src/client/card-model.ts`](src/client/card-model.ts) | Replay-stable view models derived from frozen call/result slices |
| [`src/client/inventory.ts`](src/client/inventory.ts) | The single-flight inventory read and its reconnect handling |
| [`src/client/status.ts`](src/client/status.ts) | The visible status readings over inventory and the page's live set |
| [`src/client/slots.ts`](src/client/slots.ts) | Injected faces and the package-owned `tool.view.cordis` slot declaration |
| [`src/client/run-card-index.ts`](src/client/run-card-index.ts) | Per-session index of the latest eligible `cordis_run` card |

### How the inventory stays current

Announcements (`cordis/dynamic-package`, `cordis/dynamic-retract`, `cordis/request-run`, `cordis/request-run-resolved`) trigger an inventory re-read instead of a patch-in-place update, because they carry no labels and a definition can appear or disappear between them. Reads are single-flight so several announcements settling at once cannot multiply the call; a connection reset both discards the in-flight read and frees the slot for a fresh one, so a reconnect never publishes the old host's rows.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the surfaces to the face they operate and the tools whose calls they render.

- [Client runner](../cordis-client-runner/README.md) — the browser runner the cards read.
- [Host runner](../cordis-host-runner/README.md) — the inventory and lifecycle verbs behind the cards.
- [Tool package](../tool-cordis/README.md) — the model-facing tools whose calls these cards render.
- [Extensions subsystem](../../../docs/subsystems/extensions.md) — the generated `ctx.dynamicCordisRunner` API and forwarded `cordis/*` events.
- [Dynamic client render and attachment ownership Agent Note](../../../.agents/notes/implemented/architecture/2026-08-17-dynamic-client-render-and-attachment-ownership.md) — how slot-registered browser UI is owned by its package.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the cordis_run and cordis_stop tools, which reach the same host verbs this package's definition card drives, while the runner owns any model-visible effect.

#### KV Cache effect

None; no prompt input originates here.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define where the surfaces need special care. They are current package constraints, not a task backlog.

- **The browser UI does not answer run approvals** — model-driven runs requiring approval have no control in this package.
- **A card whose call head left the event window loses its labels** — the define card derives name and purpose from the call arguments, so a session long enough to truncate them leaves the card naming its call id.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. A single keyed toolview registration whose disposal is proven by the HMR-safety spec. The one mutable relation this package owns — the per-definition run-state observable — lives in the browser process, out of reach of the host invariant service, and the node half emits no cordis events and holds no cross-plugin state.
