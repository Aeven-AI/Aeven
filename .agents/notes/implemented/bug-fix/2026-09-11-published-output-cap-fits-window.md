# Agent Note: A Published Output Cap Must Fit the Model's Window

Status: implemented

English | [中文](2026-09-11-published-output-cap-fits-window.zh.md)

## Problem

Every turn on the `deepinfra` route failed with `max_tokens: 974872 > 128000, which is the maximum allowed number of output tokens for claude-opus-5` before a token streamed, while the same model id worked on the `openrouter` route. Nothing configured 974,872. DeepInfra's model document publishes `metadata.max_tokens` as a copy of `metadata.context_length` — all 131 entries carrying both fields agree — so the live refresh read a 1,000,000-token output capability off `anthropic/claude-opus-5`. That route configured no request cap, and pi-ai falls back to `model.maxTokens` when a caller names none, clamping it to `contextWindow - estimatedPromptTokens - 4096`: 1,000,000 − 21,032 − 4,096 = 974,872 for that request. Providers that tolerate an oversized cap accepted it, so only the Anthropic-backed ids surfaced the failure. The `catalog.ts` and `config.ts` contracts asserted that a catalog `maxTokens` "sizes the model and stops there"; pi-ai promotes it into the request's cap, so nothing between a provider document and the wire compared it to the window.

## Decision

An output cap must be smaller than the window it is bounded by, and every value that becomes one is checked against the window.

A published cap counts only when it is smaller than the window the entry materializes with — its own published context window, else the route's `defaultContextWindow`. Anything else reads as no cap published.

Where a document states no usable cap, the model's own vendor answers before the route default does. A published id is vendor-prefixed, and when that prefix names an installed provider and the remainder equals one of that provider's model ids, case aside, that entry's output cap is taken. The match is deliberately narrow, because a gateway's cap is the vendor's cap only where the vendor is the one serving the model: DeepInfra serves `anthropic/claude-opus-5` with a 1,000,000-token window, states no output cap on either of its documents, and refuses 128,001 output tokens exactly as the `anthropic` entry states 128,000. Looking a model id up across the whole catalog instead answers with whichever provider happens to serve a same-named model, and those disagree — the catalog states 384,000 output tokens for a DeepSeek id DeepInfra itself caps at 65,536, and 40,960 for a `gpt-oss-120b` DeepInfra serves at 131,072.

A materialized cap above its `contextWindow` is replaced by the route's `defaultMaxTokens`, for the model's capability and for the request default an explicit entry would otherwise set. Equality stays legal: a `maxTokens` equal to its window is how a model with no distinct output limit is stated — the installed pi-ai catalog does it for 197 of the 1,267 entries carrying both fields, and written settings do it too. pi-ai clamps every cap it sends below the window regardless, so neither substitution widens a request.

## Verification

The 334 tests of `packages/llm/llm-pi-ai` pass with per-file 100% coverage on its sources. `tests/live-catalog.spec.ts` pins a cap copied from the context length reading as no cap, a smaller published cap being kept, a cap judged against the route window when the entry publishes none, and the vendor cap answering only where the document states none that can be one. `tests/catalog.spec.ts` pins the vendor lookup — exact id, case aside, and no answer for a vendor that is not the provider or an id the provider does not ship — beside the above-window substitution and the equal-to-window entry that keeps its value.

Every value the vendor layer adopts was checked against the live API before adoption. Resolving the live DeepInfra document through `resolveRouteModels` gives `anthropic/claude-opus-5` 128,000 (the host refuses 128,001 and accepts 128,000), `anthropic/claude-haiku-4-5` 64,000, `google/gemini-*` 65,536 (the host's supported range ends there), `moonshotai/Kimi-K3` 131,072, and `google/gemma-4-*` 32,768; for each of the 17 ids the layer covers, the host either refuses the catalog value plus one token or accepts it, so no adopted cap over-asks. The other 93 models on the route keep the route default of 32,768.

## Alternatives considered

**Look every published id up across the whole installed catalog.** Matching a bare model id without its vendor covers 33 of DeepInfra's 106 chat models instead of 17, but it answers with whichever provider serves a same-named model. Where DeepInfra also states its own `max_output_tokens`, the two disagree 8 times out of 11, in both directions: 65,536 against a catalog's 384,000, and 512,000 against a catalog's 128,000. Adopting those would reintroduce the reported failure for models that work today.

**Read DeepInfra's per-model `max_output_tokens` during the refresh.** `GET /models/<id>` states a real cap for many open-weight models — 131,072 for `DeepSeek-V4.1-Flash` and `GLM-5.3-Flash`, 8,192 for `gemma-4-31B-it-Ultra` — but it is `null` for every proxied model, including all seven Anthropic entries, and the bulk documents state the context window in its place. Reading it would cost one request per model per refresh and still not answer for the models that need it.

**Probe the limit during the refresh.** The host names the limit in the refusal it returns for an oversized request, which is how the adopted values were verified by hand. Doing it in a refresh means sending a deliberately invalid request per model on every mount, against a documented range the host also publishes for open models — traffic the harness should not manufacture.

**Refuse a declared cap above the window.** A route is refused whole for one bad entry, and the same settings files already carry equal-to-window entries that must stay legal, so the refusal would take working routes down for a value pi-ai already clamps into a serviceable request.

**Treat equality as no cap everywhere.** This is what DeepInfra's document needs, but applying it to the catalog and to written settings would rewrite 197 installed entries and every equal-to-window hand-written one, cutting long-output ceilings on routes that work today. Only a document's claim to state an output cap makes equality there mean "no cap".

**Materialize a request cap on every pi-ai route.** Capping each unconfigured request at the route default changes what every pi-ai route asks for, from a layer that owns no capacity data and would hide the same class of defect rather than correct it.

**Correct pi-ai's own fallback.** `options?.maxTokens ?? model.maxTokens` lives in the installed dependency, which this repository does not own; the published value still has to be judged against the window before it reaches any consumer.

**Drop `metadata.max_tokens` from the `openai-models` layout entirely.** It would fix DeepInfra and also discard a genuine cap from a provider that publishes one, leaving every such route at the route default.

## Consequences

The `deepinfra` route's models ask for their vendor's cap where one is known: 128,000 for six Anthropic models, 65,536 for five Google models, 64,000 for `claude-haiku-4-5`, and 131,072 for `moonshotai/Kimi-K3`, with the remaining 93 keeping the 32,768 route default. A deployment wanting more on a model neither the vendor nor the document sizes states it: `defaultMaxTokens` on the route, or `maxTokens` on a `models`/`modelOverrides` entry, which remains a request default and is still clamped below the window.

The vendor layer trusts the vendor's cap for a model the gateway serves. Where a gateway serves the same model under a lower cap of its own and states it, the document's value wins and the gateway's cap is never overridden; where the gateway states nothing and its own cap is lower, the adopted value can over-ask, which is what the per-model probe checked for on all 17 ids this layer covers. A model whose vendor is absent from the installed catalog keeps the route default.

An installed catalog entry whose `maxTokens` equals its window keeps sending a whole-window cap, by the equality decision above. Only a provider that rejects it can refute the claim, and the remedy is a `modelOverrides` cap on that route.

The guard is a ceiling, not knowledge: a document publishing a plausible but wrong cap below the window is still believed, and nothing in a model document can reveal that the provider's real output limit is lower.
