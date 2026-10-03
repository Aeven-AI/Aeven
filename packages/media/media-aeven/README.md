---
description: "The Aeven gateway image provider for ctx.media: Aeven-1.0-Image-Flash and Aeven-1.0-Image-Pro over the signed-in Aeven session, from a shipped catalog that is always offered."
kind: "package-reference"
---

# @aeven/media-aeven

English | [中文](README.zh.md)

## Summary

`avn-media-aeven` registers Aeven's own gateway as an image provider for `ctx.media`. It serves two models, `Aeven-1.0-Image-Flash` and `Aeven-1.0-Image-Pro`, through the gateway's `POST /v1/images/generations`, and presents the signed-in user's Aeven session as the bearer, so generating an image needs a sign-in and no vendor key. Mount it where a deployment offers Aeven's image models.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads `avn-media`. It registers under `aeven`.

### Minimal configuration

```yaml
- name: '@aeven/media-aeven'
  config:
    apiUrl: http://localhost:9000   # Aeven API origin; /v1/images/generations is appended
    apiKeyEnv: AEVEN_TOKEN          # credential holding the signed-in session
```

| Field | Default | Meaning |
|---|---|---|
| `id` | `aeven` | Registry key under `ctx.media` |
| `apiUrl` | `http://localhost:9000` | Aeven API origin; the same origin `llm-aeven` is configured with |
| `apiKeyEnv` | `AEVEN_TOKEN` | Credential reference holding the signed-in session, resolved through the credentials seam then the environment |

### The models and their options

| Option | `Aeven-1.0-Image-Flash` (default) | `Aeven-1.0-Image-Pro` |
|---|---|---|
| Served by | Seedream 4 | Seedream 5.0 Pro |
| `size` | `1K`, `2K` (default), `4K`, or `WIDTHxHEIGHT` | `1K`, `1.5K`, `2K` (default), or `WIDTHxHEIGHT` |
| `n` | 1–4 | 1–4 |
| Reference images | one | up to 4 |
| `background` | none | `transparent` or `opaque` |
| `seed` | −1 (random) to 4294967295; no reproducibility guarantee | none |
| `guidance_scale` | 1–10 | none |
| `output_format` | none | `png` or `jpeg` |
| `optimize_prompt_mode` | none | `standard` or `fast` |

A transparent background on Pro needs one reference image that has an alpha channel; the gateway enforces that rule.

### Requests

`requestBody` refuses, before any request is made, a model Aeven does not serve, a background on a model without that option, `n` outside 1–4, too many reference images for the model, and `aspectRatio`. `resolution` maps to `size` and cannot accompany an explicit size; `seed`, `guidanceScale`, `outputFormat` and `optimizePromptMode` map to the gateway's corresponding snake-case fields. Everything else — the size vocabulary, a transparent background's alpha requirement, the account's plan and balance — is the gateway's to refuse, and its message is carried in the `MediaError`. Reference images are sent inline as `data:` URLs, because the gateway fetches no remote address.

### Signing in instead of holding a key

The bearer is resolved per generation: the credentials seam's value for the owner of the generating Session, else for the acting caller, else the launching environment. Several clients signed in to different accounts share one Host, so a generation never presents another user's session. With no session anywhere, the call fails with `MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE` naming the remedy — sign in.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### The catalog is shipped

`AEVEN_IMAGE_MODELS` is shipped rather than fetched from the gateway's `GET /v1/models`. That listing is entitlement-scoped — it answers with what one account's plan may use — which is the wrong input for a menu every account reads. `available()` is always true, so both models are always listed; a missing sign-in or an account without the model is reported by the generation itself.

The entries mirror the gateway's catalogue (`services/inference/modelCatalog.js` in the Aeven API), whose `GET /v1/models` lists the same per-model vocabulary under `image`. The gateway stays the authority: this list only refuses early what it states.

### Source map

- `src/index.ts` — config, the shipped catalog, request translation and early refusal, gateway error mapping, response decoding, and the provider registration.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the consumer that mounts the media seam; this provider registers no tool and contributes no prompt.

#### KV Cache effect

No direct invalidation; the consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is a poor fit. They are current package constraints.

- **No invariant companion** — No runtime invariant companion is published because this package owns no relationship two independent observers could disagree about; its one registration is disposed with the calling fiber and covered by the package's tests.
- **The catalog is a mirror** — a model the gateway adds is not offered until this list ships it, and an option the gateway changes is refused early here until the list follows.
- **No video** — the gateway serves no video route.
- **No cost reporting** — the gateway settles each generation on its own ledger, and the seam has nowhere to carry the charge.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Widening from the listing

The gateway's `GET /v1/models` now lists each image model's full option vocabulary. Widening the shipped catalog with what that listing adds, without ever narrowing it, would let a new model appear without a release. Not pursued while two models are the whole product set.

</details>
