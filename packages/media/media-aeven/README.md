---
description: "The Aeven gateway image and video providers for ctx.media: Aeven-1.0-Image-Flash, Aeven-1.0-Image-Pro, Aeven-1.0-Video-Flash and Aeven-1.0-Video-Pro over the signed-in Aeven session, from shipped catalogs that are always offered."
kind: "package-reference"
---

# @aeven/media-aeven

English | [中文](README.zh.md)

## Summary

`avn-media-aeven` registers Aeven's own gateway as an image provider and a video provider for `ctx.media`. It serves two image models, `Aeven-1.0-Image-Flash` and `Aeven-1.0-Image-Pro`, through the gateway's `POST /v1/images/generations`, and two video models, `Aeven-1.0-Video-Flash` (the default) and `Aeven-1.0-Video-Pro`, as gateway jobs started with `POST /v1/videos` and read at `GET /v1/videos/{id}`. Every request presents the signed-in user's Aeven session as the bearer, so generating needs a sign-in and no vendor key. Mount it where a deployment offers Aeven's image or video models.

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
| `maxVideoBytes` | 52428800 (50 MiB) | Largest finished clip one download accepts |

### The models and their options

| Option | `Aeven-1.0-Image-Flash` (default) | `Aeven-1.0-Image-Pro` |
|---|---|---|
| `size` | `1K`, `2K` (default), or `WIDTHxHEIGHT` (sent as the nearest aspect ratio, long edge up to 2048) | `1K`, `1.5K`, `2K` (default), or `WIDTHxHEIGHT` |
| `n` | 1–4 | 1–4 |
| Reference images | up to 14 | up to 4 |
| `background` | none | `transparent` or `opaque` |
| `seed` | 0 to 4294967295; no reproducibility guarantee | none |
| `guidance_scale` | none | none |
| `output_format` | none | `png` or `jpeg` |
| `optimize_prompt_mode` | none | `standard` or `fast` |

A transparent background on Pro needs one reference image that has an alpha channel; the gateway enforces that rule.

### Requests

`requestBody` refuses, before any request is made, a model Aeven does not serve, a background on a model without that option, `n` outside 1–4, too many reference images for the model, and `aspectRatio`. `resolution` maps to `size` and cannot accompany an explicit size; `seed`, `guidanceScale`, `outputFormat` and `optimizePromptMode` map to the gateway's corresponding snake-case fields; `guidanceScale` is left out for a model without a guidance option. Everything else — the size vocabulary, a transparent background's alpha requirement, the account's plan and balance — is the gateway's to refuse, and its message is carried in the `MediaError`. Reference images are sent inline as `data:` URLs, because the gateway fetches no remote address.

### Video

| Option | `Aeven-1.0-Video-Flash` (default) | `Aeven-1.0-Video-Pro` |
|---|---|---|
| Tier | Fast and economical | Slower, pricier, better quality |
| `duration` | 4, 6 or 8 (default 8) | 4–15 (default 5) or `-1` (the model decides) |
| `resolution` | `720p`, `1080p` (default) or `4K` | `480p`, `720p` (default) or `1080p` |
| `aspectRatio` | `16:9` (default) or `9:16` | `16:9` (default), `4:3`, `1:1`, `3:4`, `9:16`, `21:9` or `adaptive` |
| First and last frame | both | both |
| `seed` | 0 to 4294967295 | −1 (random) to 4294967295 |

`videoRequestBody` refuses, before the job starts, a model Aeven does not serve, `size`, a `duration`, resolution or aspect ratio the model's column above does not list, and more than two reference images. The first reference image is sent as `first_frame_image` and a second as `last_frame_image`, both inline as `data:` URLs; `seed` and `generateAudio` map to `seed` and `generate_audio`. The job is started with `Prefer: respond-async`, so the gateway owns the render and a dropped connection neither loses nor re-bills it. Its `in_progress`, `completed` and `failed` states map to the seam's `running`, `succeeded` and `failed`. `fetchVideo` reads the completed job and takes the clip from its result: the bytes themselves when the result carries `b64_json` (the gateway downloads a Video Flash clip with its own key, because that upstream's link is not presigned), otherwise the HTTPS URL it names, downloaded without a credential. Either way it refuses anything over `maxVideoBytes`.

### Signing in instead of holding a key

The bearer is resolved per generation: the credentials seam's value for the owner of the generating Session, else for the acting caller, else the launching environment. Several clients signed in to different accounts share one Host, so a generation never presents another user's session. With no session anywhere, the call fails with `MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE` naming the remedy — sign in.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### The catalog is shipped

`AEVEN_IMAGE_MODELS` and `AEVEN_VIDEO_MODELS` are shipped rather than fetched from the gateway's `GET /v1/models`. That listing is entitlement-scoped — it answers with what one account's plan may use — which is the wrong input for a menu every account reads. `available()` is always true for both providers, so every model is always listed; a missing sign-in or an account without the model is reported by the generation itself.

The entries mirror the gateway's catalogue (`services/inference/modelCatalog.js` in the Aeven API), whose `GET /v1/models` lists the same per-model vocabulary under `image` and `video`. The gateway stays the authority: this list only refuses early what it states.

### Source map

- `src/index.ts` — config, the shipped catalogs, request translation and early refusal, gateway error mapping, response and job decoding, the clip download, and both provider registrations.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the consumer that mounts the media seam; this provider registers no tool and contributes no prompt.

#### KV Cache effect

No direct invalidation; the consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is a poor fit. They are current package constraints.

- **No invariant companion** — No runtime invariant companion is published because this package owns no relationship two independent observers could disagree about; its two registrations are disposed with the calling fiber and covered by the package's tests.
- **The catalog is a mirror** — a model the gateway adds is not offered until this list ships it, and an option the gateway changes is refused early here until the list follows.
- **Frames only for video references** — local images reach a clip only as its first and last frame; the gateway's `reference_images`, `reference_videos` and `reference_audios` take HTTPS or `asset://` URLs, which local files do not have.
- **The charge is the gateway's figure** — `costUsdMicros` on an image result or a succeeded video job is the customer charge the gateway's ledger recorded (`usage.cost_usd_micros`); a gateway that does not report it leaves the field absent.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Widening from the listing

The gateway's `GET /v1/models` now lists each image model's full option vocabulary. Widening the shipped catalog with what that listing adds, without ever narrowing it, would let a new model appear without a release. Not pursued while two models are the whole product set.

</details>
