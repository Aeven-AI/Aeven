# Agent Note: Known Routes Answer Draft Discovery

Status: implemented

English | [中文](2026-09-11-known-route-answers-draft-discovery.zh.md)

## Problem

The Models page's "Fetch available models" action could not succeed for a known route. `discoverModels` read the endpoint and protocol from the discovery request alone and refused a request that named neither, while the Models page sends the route id plus whatever its form currently shows. For a profile that states only `apiKeyEnv` — the whole user-facing step for a known route, because the table owns the rest — the form shows no endpoint and no protocol, so the draft arrived with neither and the action failed with `pi-ai ships no catalog for provider "deepinfra", so its models can only come from its endpoint; set a baseURL, or enter this provider's models by hand`. The Host-side stored-profile lookup could not close that gap: it answers with deployment headers and a lazy credential, and never with an endpoint. The same call with the table's endpoint and protocol supplied by hand answered 191 models from a recorded DeepInfra listing, 85 of them speech, embedding, image, or video entries that the route's text protocol cannot call; the live refresh already dropped those entries through `LiveCatalogRoute.requireTags`, so the two paths disagreed about which models one route serves.

## Decision

`discoverModels` reads `knownRoute(request.provider)` and completes the draft from that entry: its `api` and `baseURL` stand in when the request names neither, which is exactly how `resolveProfiles` reads the same two fields off the same entry to complete a stored profile that supplies only a credential. A value the draft supplies still wins, so a known route pointed at a proxy is interrogated where the draft says; a blank value counts as supplied rather than omitted, so an emptied field is refused as the unusable endpoint it is instead of silently reaching the table.

The fallback lives in `src/discovery.ts` rather than in the plugin's registration. The registration contributes what only the Host holds and a draft must not carry — the stored credential and the deployment headers — while the endpoint, protocol, and tag requirement are published facts of the route that depend on nothing but the route key, so a caller reaching the module directly gets the answer one reaching it through `ctx.llm.discoverModels` gets.

Candidates are filtered by the route's own `requireTags` when the draft names no tags of its own, which it never can: the discovery request has no field for them. `carriesTags` in `src/live-catalog.ts` is the one home for that signal. It reads the `metadata.tags` an `openai-models` document publishes; the [live refresh](../architecture/2026-08-28-live-provider-model-catalog-refresh.md) filters the entries it materializes through it, and draft discovery filters the candidates it offers through it, so `requireTags` selects the same models on both paths. A route the table does not describe requires no tags and keeps every entry its endpoint publishes, exactly as before, and a route the installed catalog describes is still answered from that catalog with no network call.

## Verification

`tests/discovery.spec.ts` adds four cases. A request naming only `deepinfra` is sent to `https://api.deepinfra.com/v1/openai/models` and yields the two chat entries of the recorded document while dropping its speech, embedding, and image entries. A route mounted from `{ apiKeyEnv: DEEPINFRA_API_KEY }` alone answers through the same endpoint carrying its stored credential, which is the reported defect. A draft naming its own endpoint and `anthropic-messages` wins over the table, and its entries are still filtered by the route's tags. A provider the table does not describe keeps every published entry, tagged or not.

The deepinfra fixture is `tests/fixtures/model-listings/deepinfra-2026-09-11.json`, a recorded listing trimmed to six entries that keep their recorded fields. Against the full recorded document of 191 entries the same call returns 106 chat models, which is what the refresh materializes for that route.

## Alternatives considered

**Complete the draft inside the plugin's registration.** The registration already builds the stored profile, so it could spread the known-route entry over the request before calling `discoverModels`. It lost because the tag requirement has to be applied while the listing is parsed, which is inside `discoverModels`, so the route's facts would be read in two places, and because the module's own exported entry point would keep failing for the same request.

**Carry the endpoint through `StoredModelDiscoveryProfile`.** That interface exists for Host-owned inputs a draft cannot carry. Adding a publicly known endpoint and protocol would widen it for facts the request can already state, and it would not cover a route no profile declares yet, where the table is the only source.

**Drop non-chat entries by inspecting ids inside the discovery parser.** An id-based heuristic would disagree with the refresh about the same document, and the document states its capability tags outright.

## Consequences

A route configured with a credential alone can be interrogated, and the candidates offered for adoption are the models the route can serve: the recorded DeepInfra document yields its 106 chat models instead of all 191 entries. Draft discovery and refresh now share one tag signal, so a published layout whose tags live somewhere else must be taught to `carriesTags` once rather than twice.

Candidates from an `openai-models` endpoint still arrive without capacities, because that layout nests them under `metadata` and the listing parser reads the top-level capacity fields. A model adopted from such a list therefore takes the route's `defaultContextWindow` and `defaultMaxTokens` until its own entry states better ones; that gap predates this change and is left as it is.

Nothing in the client changed: the Models page already omits a blank endpoint and protocol rather than sending them, so the fix is entirely Host-side.
