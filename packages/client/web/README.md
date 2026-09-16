---
description: "Web boot kernel for the web GUI: two-stage boot of the client plugin tree, the framework-free boot page, and the shared module table, for users and maintainers composing or debugging the browser application."
kind: "package-library"
---

# @aeven/client-web

English | [中文](README.zh.md)

## Summary

`dsh-client-web` boots the web GUI: it loads the client module system from the Host-provided boot graph, then activates every client plugin before the application mounts, so the full UI appears only when every plugin is up. `apps/web` hardcodes a styled preloader in its HTML shell so the spinner paints before JavaScript, while a framework-free failure page reports a bundle or plugin that cannot activate. The package also defines the shared module table (`PLATFORM_MODULES`) that every dynamic bundle resolves its externals against. The model never sees this package.

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

Use it when you assemble the browser application: `apps/web`'s Vite entry runs `new AppWebEntry(container).run()` against the mount point, and the boot page carries the user through activation. Ordinary browser callers pass no options. A pre-injected page transport is the default ahead of the `seams` override: when `globalThis.__DSH_TRANSPORT__` carries `loadBundle`, the module stage adopts it as the bundle transport and skips the immediate-tier HTTP prefetch, while explicit `seams` still win (for example jsdom tests, where external `<script>` execution cannot reach the page context).

The shell base styles apply automatic CJK/Latin spacing to ordinary content in supporting browsers. Semantic code and terminal, diff, read, and search output containers retain literal source spacing and column alignment; browsers without `text-autospace` support ignore both declarations. The same sheet sets the document base weight to 450 — the shipped variable cut renders 450 as a real instance — and restates it on form controls, whose user-agent shorthand resets the family and the weight together.

### What boot looks like

Authentication code and styles belong to the initial shell dependency graph, so downloading the entry also discovers the sign-in resources. The rendering family starts eagerly from a top-level dynamic import when the shell evaluates, while authentication proceeds without waiting for it. An authenticated boot materializes UI primitives into the platform table before constructing the module system and evaluating any plugin bundle.

Boot runs in two stages: the module stage adopts the parser-loaded bootstrap batch, builds the module system from the Host-provided boot graph, and prefetches the `immediately` tier through the shared application-batch URL, which executes once. The plugin stage then activates every graph entry and waits for all of them before handing the marked boot DOM to the UI renderer, which hydrates it and switches to the complete UI.

### The boot page

The normal Web shell carries `#dsh-preloader` before the application root. The production build inlines its stylesheet in the document head so the full-screen background, brand mark, and spinner paint from the document bytes; remaining stylesheets load without blocking that paint. `AppWebEntry` fades that visual after the plugin tree has activated, the application owns the mount point, and — when `uiWorkspace` is present — the first sidebar lists and selected conversation history have arrived.

`BootPage` uses plain DOM and local CSS as the failure fallback. It stays visually silent while the static preloader owns loading, then reports an import or activation failure by name and reason after the kernel immediately uncovers it. Documents without the static shell retain BootPage's progress spinner.

### The shared module table

`PLATFORM_MODULES` (in `src/platform.ts`) names the shell-seeded shared modules — React, Cordis, and UI libraries — and together with `PRELOADED_CLIENT_EXTERNALS` (the parser-preloaded runtime row) defines the implicit external baseline every dynamic bundle resolves against. The shell seeds its immediate modules synchronously and adds eagerly requested UI primitives before module-system construction. `dsh.client.external` adds only exact non-baseline requests; see [shared modules and the module graph](../AGENTS.md#shared-modules-and-the-module-graph).

### Configuration

The package accepts no plugin config of its own; the generated [configuration catalog](../../../docs/config-catalog.md) lists every plugin config in the repo for comparison.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the boot kernel is built; observable behavior is covered in [Use this package](#use-this-package).

### Design concept

The kernel owns exactly three things: the module system, the Cordis Loader, and the boot page. The Host owns the graph, batch preload, and loader facade, so `AppWebEntry` never knows the bootstrap package id or parses the wire format. The dynamic UI renderer receives the mount point only after every client entry activates.

### Two-stage boot

`run()` starts the rendering-family request, restores authentication, and returns after mounting the sign-in screen when authentication owns the page. An authenticated boot waits for UI primitives, completes the platform module table, then calls the Host-installed `window.__ModuleLoader__.create({ boot, staticModules, ...seams })`; the facade returns the constructed module system and parsed manifest after adopting the parser-loaded bootstrap batch. The module stage prefetches the `immediately` tier through the one shared application-batch URL. The plugin stage mounts the Loader, assigns `loader.internal = modules`, creates every graph entry uniformly, awaits quiescence, then audits activation: any entry that failed import, stayed pending on a missing service, or landed in another non-active state throws one aggregated error naming every failing entry.

### Boot page mechanics

`src/preloader.ts` controls the static HTML visual without creating it: successful boot fades it over 400ms after the first shell payloads arrive, then removes it from layout, while failure hides it immediately so it cannot cover the report. The worker preview hides it for the source chooser and restores it while the selected image boots. `BootPage` remains plain DOM with local CSS; `internal/status` events update its fallback progress state, and `fail()` renders the thrown reason. React mounting, slot rendering, and assembly live in `ui-renderer`; `ui-layout` owns the assembled browser-title projection.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Library entry: `AppWebEntry` and platform tables |
| [`src/boot.ts`](src/boot.ts) | `AppWebEntry`: two-stage boot, activation audit, renderer handoff |
| [`src/boot-page.ts`](src/boot-page.ts) | Framework-free boot page: spinner, per-entry status, failure rendering |
| [`src/preloader.ts`](src/preloader.ts) | Lifecycle control for the static preloader in `apps/web/index.html` |
| [`src/platform.ts`](src/platform.ts) | `PLATFORM_MODULES` / `PRELOADED_CLIENT_EXTERNALS`: the implicit external baseline |
| [`src/seed.ts`](src/seed.ts) | Immediate module table and eager UI-primitives request handed to boot |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the boot contract is not enough: the module system it boots, the renderer that mounts the app, and the client authoring rules behind the baseline.

- [Client module system](../modules/README.md) — the lazy module table and boot graph this kernel consumes.
- [UI renderer](../ui-renderer/README.md) — receives the mount point and binds slot data to React.
- [Client modules subsystem](../../../docs/subsystems/client-modules.md) — the web plugin table, boot graph wire, and bundle route.
- [Client authoring rules](../AGENTS.md#shared-modules-and-the-module-graph) — the shared-module baseline and `dsh.client.external` semantics.
- [Client group map](../README.md) — the browser half this package belongs to.

-----

<a id="model-experience"></a>
## Model Experience

None, as the boot kernel is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the boot kernel does not support. They are current package constraints, not a task backlog.

- **The application waits for the full roster** — one failed entry keeps the framework-free boot page visible with a per-entry report; partial UI availability is not supported.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The vite entry shell — boot glue and module-table seeding with no cordis events and no cross-plugin mutable state; the boot chain (loading page → settled → one-flip UI) is asserted by the web smoke e2e against the real carrier.
