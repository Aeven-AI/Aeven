# Agent Note: One model picker for both model entries

Status: implemented

English | [中文](2026-09-12-one-model-picker-for-both-entries.zh.md)

## Problem

The Web composer exposed two pickers over one model directory. `/model` is a `popupSelect` contribution rendered by the shared shell in `ui-commands`, which owns a search input, filters the loaded rows locally, renders each row's detail line, and surfaces load and selection failures in a retry strip. The composer's model seat (`conversation.input.model`) rendered its own two-level Model/Effort menu built to Figma 496:26454, with its own row rendering, no search at all, no catalog detail lines, no load-retry strip, and a transient toast for selection failures. The data was already unified — one `ModelDirectory` per session, one catalog, one `session.selectModel` — but the presentation was not, and the drift was visible: the same catalog produced a searchable list in one entry and an unsearchable one in the other, and every future row change had to be made twice.

## Decision

The seat keeps its two-level entry and stops owning any list. Its trigger opens the Model/Effort chooser (label, current value, right chevron per row); the Model row opens the very spec `/model` registers, and the Effort row opens the current model's levels in the same shell. Both rows reach the shell through `CommandUiContract.openSelect(sessionId, command, spec)`, the tokenless sibling of the slash paths: the Model row passes the registered spec object itself (identity, not a copy), so no entry can drift into a lookalike list.

`CommandUiContract` therefore grows that one method, and the shell's open-time provenance union (`TokenSegment`) grows a `button` variant beside `menu` and `enter`. The two token paths keep their draft CAS guards, and a `button` open consumes nothing because it never came from the draft; `TokenPathSegment` names the token-bearing subset so the internal execute paths that fire without a settle cannot reach a consume-token dispatch.

Effort stays a list of its own rather than becoming rows inside the model list: `effortPopupSpec` offers the current model's adapter-advertised levels, the provider-default row only when the adapter configures no default, and each row carries the model those levels belong to as its detail. It is deliberately not registered as a command — a session's levels only mean something next to the model they belong to, so the list is reachable from the seat alone — but it is the seat's own drilled pane rather than a shell list (see [the effort pane note](../feature/2026-09-13-the-effort-row-keeps-the-seats-own-pane.md)): three or four levels that all fit on screen are picked by eye, and the shell's search input would cost the card a row of height for a filter that could only hide them. The level derivation is still one shared module (`effort.ts`), so the pane and the selection it submits cannot disagree. `effortLevelsOf` is the ONE derivation the rows and the selection lookup both read, so a picked row can never resolve to an effort the adapter does not serve; effort row ids live in the `effort/` namespace, mirroring the existing `failure/` rows. A model row applies that model's default effort; an effort row keeps the route and swaps only the effort.

Because one row builder now serves a catalog that routinely runs to hundreds of models, the shell also opens on the caller's marked row: `PopupSelectController.load` seeds the highlight with the first row carrying `active: true` — indexed inside the filtered rows, so a retry that kept the search text cannot leave a stale index — and the view's existing scroll-into-view effect follows the highlight. Opening the model list therefore lands on the current model, painted with the same hover treatment and scrolled into view, instead of on the catalog's first row.

Failure copy belongs to the shell on every path: a rejected selection keeps the list open with its search text and highlight intact and re-select as the retry, and a failed load shows the strip with an explicit Retry. The seat's injected face is therefore `available`, `directory`, `load` (so the chooser's values are current when it opens), `openModel`, and `openEffort` — no rows, no filtering, no failure state.

## Alternatives considered

**Give the seat's own list a search input and keep the rest.** The smallest change, and it would have left the Figma menu untouched. Rejected because it leaves two row builders, two filterings, and two failure surfaces to keep in sync by hand — precisely the drift the inconsistency came from — and the seat's list would still lack the detail lines and the retry strip the shell already has.

**Fold the effort levels into the model list as extra rows.** One list, one search, no second spec. Rejected because it makes a single list answer two different questions and deletes the seat's Model/Effort chooser, which is the shipped two-level entry users already navigate; the levels also only mean something relative to one model, which a mixed list cannot express as clearly as a list whose every row belongs to that model.

**Delete the chooser and open the model list straight from the trigger.** The shortest path to "searchable list from the composer button", and the first attempt at this change did exactly that. Rejected on review: it removed a step users rely on and left the reasoning-effort levels with no entry point in the composer at all.

**Have the button "run" `/model` by inserting the token into the composer.** This would reuse the slash path literally, but it writes into the user's draft, has to clean the token up afterwards, and breaks whenever the draft is not empty or already holds a slash command.

**Give the seat a second spec over the shared shell but keep the model list private.** Both entries would use one component, yet two specs, so rows and filtering could still diverge — the property this change exists to guarantee is spec identity, not component reuse.

**Keep two pickers and treat the difference as intentional.** The TUI/Web divergence that motivates a slightly different treatment is about *unlisted current models*, not about which affordances a picker offers; two lookalike lists with different capabilities is not a defensible presentation of one directory.

## Consequences

The model list is now literally one component over one row builder: `/model` and the seat's Model row open the same object, so search, filtering, row rendering, empty/loading/retry copy, and keyboard behavior cannot drift. The effort list stays the seat's own pane — arrow keys, Escape-to-back-out, and a check on the level in force — which is a second rendering of one shared derivation rather than a second picker contract, and the chooser keeps its place as the entry to both. Model rows on the composer path also carry their catalog description again, because the shared row builder includes the detail line the seat had dropped — later narrowed on both sides: the detail line names the provider alone, since DeepSeek advertises a sentence per model and OpenRouter none, and the blurb moved to the shell's search-only `keywords` so it is still findable without crowding the provider out of the row. The row's selection marker is the hover treatment the highlight already wears, not an icon; the icon competed with the detail line for the row's width.

The cost is that the lists are anchored by the command overlay rather than by the chooser, so the chooser cannot know when a list is open: it closes as it hands over, and the trigger reports only its own `aria-expanded`. The seat's injected face changed shape (it no longer carries a selection verb) and both lists open under the shell label `model`, since the effort list is that same feature's second list and inventing a command name for it would put a nonexistent `/effort` into user-facing aria text. The client command contract gained one method and the segment union one variant — a contract visible to every business package, so `openSelect` is now part of the surface other contributions may use to give a button the same picker as their slash line — and the shell's opening highlight is now seeded from the marked row for every contribution, so `/permission` opens on the current preset as a side effect.

## Testing

`packages/client/ui-commands` pins the new entry: `openSelect` drives the session's own controller over the given spec, settles with a bound composer focus, dispatches no `consume-token`, and reports `false` for a session with no scope. It also pins the opening highlight — the marked row when one is marked, the first row when none is, an index taken inside the filtered rows when a retry kept the search text — and that the view scrolls that row into view as the shell opens.

`packages/client/ui-model-selection` pins the seat's chooser: the trigger's model and effort labels, the raw `provider/model` fallback, the loading label, the locked and unavailable states, the Model and Effort rows with their current values, that the Model row opens the very spec object the `/model` contribution registered (`toBe`, not deep equality) while the Effort row opens a different one, that Escape closes the chooser without opening either list, and that a model without reasoning metadata has no Effort row. It pins the lists through the shared specs: the model list marks the host current and is failure-row-refusing, the effort list carries exactly the declared levels under the model they belong to (provider-default only without an adapter default), and an effort row keeps the route and swaps only the effort.

The `declared-reasoning` web e2e drives the chooser's Effort row and pins that list as a golden (Default/Off/High/Max, each naming the model), then records the picked level into the Agent default; `default-model` switches through the chooser's Model row and asserts the list opens with the current model highlighted and in view even though it is not the catalog's first row.

## Related

The [Web session model selection](../feature/2026-07-24-web-session-model-selector.md) Agent Note owns the surrounding decision — Host-owned selection, the advisory directory, and the `conversation.input.model` seat — and is updated to describe the seat's chooser and the two lists it opens. The popupSelect shell itself is owned by the [web command surfaces](2026-07-25-web-command-surfaces-and-assembly.md) Agent Note.
