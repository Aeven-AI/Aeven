---
description: "The Aeven cloud inference adapter for users and maintainers configuring the aeven-cloud route, its catalog, and reasoning defaults."
kind: "package-reference"
---

# @aeven/llm-aeven

English | [中文](README.zh.md)

## Summary

`@aeven/llm-aeven` registers the `aeven-cloud` provider route on the harness LLM service, pointed at the Aeven gateway. It reuses `@aeven/llm-deepseek`'s `DeepSeekAdapter` as its transport, because that adapter is transport-only — "fetch plus SSE against an OpenAI-compatible chat-completions endpoint" — and the gateway speaks exactly that protocol; a second adapter would be the same wire behaviour carrying its own copy of the same bugs. What differs between the two routes is not the transport but the authority behind it: DeepSeek's platform against Aeven's.

The practical consequence is that a route exists which a signed-in user can use without producing an API key. A key is what a user must supply to talk to a provider directly; an Aeven sign-in already establishes the same thing, so the base URL is not a new setting to keep in sync but the origin the client is already authenticated against, and the credential is the session the host already verifies. That is the whole difference between this route and `deepseek-official`.

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

Mount this plugin when a composition should offer Aeven's own models to a reader who has signed in. It registers one route, announces a catalog, and resolves the endpoint and credential together per request, so a session that appears after the mount is usable on the next call without a restart.

### When to choose it

Choose this route when inference and identity should be one origin. Choose `avn-llm-deepseek` when the deployment holds its own DeepSeek API key and talks to DeepSeek's platform directly. The two can be mounted together: their route names do not collide, and a reader may legitimately have both a signed-in session and a personal key.

Two facts let it fit the existing first-run flow without modifying it. The Models page treats a route whose credential is configured as usable and ends the step as soon as *any* route is, so a signed-in reader completes setup without touching a key field. And the catalog is announced through `registerModelDiscovery`, so the model picker offers these entries the same way it offers any other provider's.

### Minimal configuration

```yaml
- name: '@aeven/llm-aeven'
  config:
    apiUrl: http://localhost:9000   # Aeven API origin; /v1 is appended
    apiKeyEnv: AEVEN_TOKEN          # credential holding the signed-in session
    reasoningEffort: max            # off | low | high | max
    maxTokens: 384000               # optional per-request output cap
```

Only `apiUrl` and `apiKeyEnv` describe where requests go and what authenticates them. Everything else has a shipped default that matches the gateway.

| Field | Default | Meaning |
|---|---|---|
| `apiUrl` | `http://localhost:9000` | Aeven API origin; `/v1` is appended, so the origin stays the one fact an operator configures |
| `apiKeyEnv` | `AEVEN_TOKEN` | Credential reference holding the signed-in session, resolved through the credentials seam then the environment |
| `models` | Aeven Flash + Aeven Pro | Advisory catalog shown by discovery consumers; a settings section replaces it whole |
| `thinking` | `enabled` | Deployment policy; `disabled` locks every request to `off` |
| `reasoningEffort` | `max` | Default effort: `off`, `low`, `high`, or `max` |
| `maxTokens` | `384,000` | Per-request output cap; a model's own cap and explicit request values win |
| `defaultContextWindow` | `1,000,000` | Capacity fallback for models without an exact value |
| `streamIdleTimeoutMs` | `300,000` | Maximum provider idle time per outstanding stream read |
| `maxRequestFilesBytes` … `fileQuotaCleanupBatch` | adapter defaults | Inert here — see [Known Limitations](#known-limitations-and-deferred-work) |
| `retryPolicy` | normal, 5 retries | Provider-owned retry policy, resolved once at registration |

The generated [configuration catalog](../../../docs/config-catalog.md#aevenllm-aeven) is the exhaustive source for every accepted field and its JSDoc.

### The shipped catalog

Two entries ship, because a selector needs labels and limits before any request is made: `Aeven-1.0-Flash`, named "Aeven Flash", which reads images, and `Aeven-1.0-Pro`, named "Aeven Pro", which does not. Both advertise a 1,000,000-token context window and up to 384,000 output tokens.

The catalog is shipped rather than fetched deliberately. A live listing is entitlement-scoped — it answers with what one *account* may use — which is the wrong input for a catalog every account reads. Shipping it also means the listing never *narrows* what is offered: a free account still sees the paid model and learns from the refusal that it needs a plan, rather than having the model silently absent. The Models page's "fetch available models" action is answered from these same entries for that reason.

### Signing in instead of holding a key

`resolveApiKey` reads the credential reference through the credentials seam, then falls back to the launching environment, so a headless run can supply `AEVEN_TOKEN` without a credential store. When neither holds a value, the request fails with `MISSING_CREDENTIAL` naming the remedy — sign in, or store the token when running headless. The message deliberately does not suggest finding an API key, because a missing key is not the fault and naming one would send the reader somewhere that cannot fix it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design behind the adapter; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

One class and one resolution step carry the whole adapter. `AevenAdapter` extends `DeepSeekAdapter` and overrides exactly one thing — `providerInfo` — because the inherited implementation answers every route it owns with DeepSeek's own brand, and the identity a selector shows is the one fact that cannot be inherited. Everything else is the transport as it stands.

`options()` is the single path from raw configuration to validated connection facts, and it restates every default from the schema rather than leaving them to it: the schema fills them for a loader-resolved entry, but the type stays optional so a user-settings section can supply a subset. Resolving the endpoint and the credential in one value is what makes it impossible for a request to pair a stale origin with a newer session.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, per-request resolution, credential resolution, catalog and route registration |

### Registration

`apply` performs four registrations: the configurable-provider entry (`aeven-cloud`, display name `Aeven`, settings namespace `llm-aeven`), the model-discovery answer, the adapter itself, and the anonymous-user-id resolver that gives every request stable attribution. `prepareExtensions` is a no-op returning empty fields and an accepting callback, because the gateway carries no plugin-contributed top-level fields.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [avn-llm service](../llm/README.md) — the provider-neutral service this adapter registers on.
- [llm-deepseek adapter](../llm-deepseek/README.md) — the transport this route reuses, and the files-API behaviour this route leaves unconfigured.
- [llm-retry](../llm-retry/README.md) — the retry executor that applies this adapter's `retryPolicy`.
- [LLM streaming subsystem](../../../docs/subsystems/llm-streaming.md) — the `StreamChunk` protocol and adapter contract.
- [Configuration catalog](../../../docs/config-catalog.md) — every accepted field, generated from the source JSDoc.

-----

<a id="model-experience"></a>
## Model Experience

### Aeven request

#### What the model sees

The selected Aeven model receives the harness system prompt, message history, tool schemas, stop sequences, and call config (`maxTokens`, `reasoningEffort`, `temperature`) without adapter-authored prompt prose. Because this route configures no files API, images are carried inline as `image_url` parts rather than as uploaded file references, and no request contributes plugin-owned top-level fields.

#### Token effect

Provider tokenization governs exact text and image-token input. Inline images are charged as image tokens by the gateway on the same accounting it applies to any OpenAI-compatible vision request; the adapter itself adds no tokens. `totalTokens` is the exact `prompt_tokens + completion_tokens` aggregate.

#### KV Cache effect

An unchanged assembled prefix is eligible for the gateway's cache reuse, which the adapter reports in usage. A model-route, prompt, schema, history, or image change may prevent reuse from the first affected token, and reasoning passback appends on every reasoned turn.

### Aeven response

#### What the model sees

Reasoning, text, and raw-string tool arguments are translated into harness chunks for the loop to log and assemble.

#### Token effect

Generated tokens follow the request's logged reasoning effort and `maxTokens`; only loop-retained blocks affect later input.

#### KV Cache effect

Loop-retained response blocks append to the next request and preserve its earlier reusable prefix; dropped blocks have no later cache effect. Changing the provider or model selects a different cache domain.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define where the adapter stops and future work begins. They are current package constraints, not a general Aeven-gateway comparison or a task backlog.

- **No files API, so no upload behaviour** — images travel inline as `image_url` parts. The Files-API paths the transport implements (upload caching, expiry, refresh, stale-id recovery, quota cleanup) are unreachable on this route, and a gateway that gains a files API would need this route to start using them.
- **The image and Files config knobs are accepted but inert** — they are declared because the transport's connection facts require a complete set, and are pinned to the adapter's own defaults so an upstream change is inherited rather than silently overridden here.
- **The catalog is shipped, not fetched** — deliberately, because a live listing is entitlement-scoped. A model the gateway adds is not offered until this package ships it.
- **No plugin-contributed top-level request fields** — `prepareExtensions` contributes nothing, so the session-log and plugin-inventory extensions the DeepSeek route carries are absent here.
- **`thinking` and `reasoningEffort` are forwarded, not enforced** — the gateway accepts both values; what it does with them is its own contract, and a model that ignores an effort reports usage accordingly.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is non-authoritative working context: undecided directions and notes for maintainers. Shipped behavior and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

- `DEFAULT_API_URL` names the local development gateway, matching the value the identity authority and the web bundle already resolve. A deployment that runs the gateway elsewhere overrides `apiUrl`.
- The route reuses `DeepSeekAdapter` rather than composing it, so a change to that adapter's wire behaviour reaches this route automatically. That is the intended coupling; the alternative — a second adapter — was rejected as a copy carrying its own bugs.

</details>

**Runtime invariant:** No companion is published. This package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam.
