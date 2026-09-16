---
description: "Model selection for the Web GUI: the /model popup and the composer model seat over one per-session provider-grouped directory; for users and maintainers of model routing."
kind: "package-reference"
---

# @aeven/client-ui-model-selection

English | [中文](README.zh.md)

## Summary

This package provides model selection in the Web GUI: the `/model` popup command and the composer's model seat, both over one per-session directory of provider-grouped models and both rendering their lists through ONE picker — the shared popupSelect shell, the searchable one for the Model row, and the seat's own pane for the Effort row. Choosing a model submits the complete selection — provider, model, and reasoning effort — which the Host snapshots at the next prompt-assembly boundary, so the following request uses it while a running step keeps its assembled selection. The seat keeps a two-level entry: its trigger opens a small Model/Effort chooser, the Model row opens the very list `/model` opens, and the Effort row drills into the seat's own pane over the current model's levels — so no entry owns a lookalike list of its own, and no picker carries a search input over a list that fits on one screen. When the Host reports that no adapter serves the session's route, the composer input goes inert until a route becomes available.

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

Mount this plugin alongside `ui-conversation` and the commands package; the composer then shows the model seat next to the pending indicator, and pressing it opens the seat's Model/Effort chooser. The Model row opens the same searchable list `/model` opens. Both surfaces show the host-reported current selection when the exact provider/model pair remains in the advertised groups; a missing catalog row leaves the routable selection intact while the trigger prompts `Select model`.

### Model and effort

Models stay grouped by provider, and each row carries the provider name as its detail line — never the model's catalog description, which DeepSeek advertises per model and OpenRouter does not, so a rendered blurb would make the two provider lists read differently and push the provider out of the row. The description stays findable by typing it, because the row hands it to the shell as search-only `keywords`. The Effort row drills into the seat's own pane instead of the shell: the current model's adapter-advertised levels, the one in force checked, arrow keys moving focus, Escape backing out to the chooser. An adapter advertises three or four levels that all fit on screen, so a search input over them could only hide rows the reader is already looking at. One module, `src/client/effort.ts`, derives the levels the pane renders and resolves the selection a picked level submits, so the pane cannot offer a level the adapter does not serve. Picking an effort keeps the route and swaps only the effort. A model row applies that model's default effort. An adapter without reasoning metadata leaves the Effort row out of the chooser entirely; there is no arbitrary effort input.

### Unroutable sessions

When the Host reports that no adapter serves the session's route, this plugin raises a composer block and the input goes inert with its own copy; recovering clears it without a reload. A `null` before the first load or after one failed never blocks, and catalog membership never blocks either — a route serving a model it does not advertise is missing from the groups yet usable.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Two entries over ONE per-session directory owned by `ModelDirectoryResolver` (`ctx.modelDirectories`) one `CommandUiSpec` over the shared popupSelect shell for the model list, and the seat's own effort pane: the `/model` popupSelect contribution (registered through `ctx.commandUi`) and the composer's named `conversation.input.model` seat both load the session's advisory directory through `session.models` and submit through `session.selectModel` via the same `ModelDirectory` instance, so a switch made in any entry is what the others show next. The seat owns only its Model/Effort chooser: the Model row opens the spec `/model` registered (the same object, not a copy) and the Effort row opens the levels spec, both through `commandUi.openSelect` — the tokenless sibling of the slash paths — so the model list is the same controller, shell component, and row builder everywhere it is opened; a settled selection closes the shell and consumes nothing from the draft. Directory loads and selections share a generation counter so an older response never overwrites a newer one; a connection reset drops every resident projection and repulls the Host-restored selection. Directories are per-session, resolved lazily, and disposed with the session scope; addressed subagent sessions expose neither entry. Every resident directory refetches directly on forwarded `llm/adapters-updated` and `settings/document-updated` owner events.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the model surface is not enough. They move from the browser surfaces to the command popup shell and the selection contract.

- [ui-commands](../ui-commands/README.md) — the popupSelect shell both model entries open, and the `openSelect` button entry into it.
- [ui-conversation](../ui-conversation/README.md) — declares the composer's `conversation.input.model` seat and the composer block.
- [dsh-agent-default-model](../../core/agent-default-model/README.md) — the default-model service for sessions that never choose.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `session.selectModel` selection both entries submit: the Host snapshots the complete `ModelSelection` at the next prompt-assembly boundary and owns the model-visible effect, while a running step keeps its assembled selection.

#### KV Cache effect

Switching the route can reduce or invalidate provider-side cache reuse for subsequent requests; the prompt prefix itself is untouched.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current model surface. They are current package constraints, not a general model-router comparison or a task backlog.

- **No create-time or addressed-subagent selection** — both entries require an existing ordinary session's Agent; there is no draft-phase model choice to fold into session creation, and subagent continuation deliberately exposes no independent model-selection contract.
- **Directory names are presentation-only** — selection and persistence use provider/model/effort ids; a provider whose catalog or exact-model metadata lookup fails lists as an unselectable failure row until reload.
- **No arbitrary effort input** — the chooser offers only the exact model's adapter-advertised levels; an adapter without reasoning metadata leaves the Effort row out.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. A single command contribution registration whose disposal is proven by the HMR-safety spec — it emits no cordis events and owns no cross-plugin mutable state.
