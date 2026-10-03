---
description: "Coding-subscription OAuth for Grok Build and ChatGPT Codex: model routes with per-model selection, quota reporting, image and video generation, and a group on the Providers settings page."
kind: "package-bundle"
---

# @aeven/subscription-auth

English | [中文](README.zh.md)

## Summary

`avn-subscription-auth` lets a deployment drive models from coding subscriptions the operator already pays for, instead of an API key. It signs in to Grok Build and ChatGPT Codex over OAuth, publishes each as an LLM route serving the models the user keeps selected, reports what quota is left, and offers image and video generation through its own tools and the harness media seam. A Subscriptions group on the Providers settings page owns sign-in, quota, and model selection in the browser, one foldout card per subscription. It is experimental: excluded from official releases, and it talks to private endpoints the vendors do not document, so a provider change can break a route without warning.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Add the package to a profile as a bundle. Its `cordis.patch.yml` inserts the `llm-grok-build-oauth` row and leaves the deployment's default model alone; the deployment's own patch layer applies after it and wins.

### When to choose it

Choose it when the operator holds a SuperGrok or ChatGPT Plus/Pro subscription and wants those models available without provisioning API keys. Claude is not offered: Anthropic bills a Claude subscription's OAuth use outside its own apps against usage credits rather than the plan's limits, which is API-key billing by another route. Do not choose it to serve those subscriptions to anything but this deployment: each vendor's terms govern what a subscription may drive, and this package uses each vendor's own client route rather than a public API.

### Sign in

Every provider is signed in from Settings → Providers, in its Subscriptions group: open the provider's card and choose **Sign in** at its foot. On the harness host the button opens the vendor's sign-in page in a new tab and completes through the harness's local callback, so nothing is entered in Settings. When the browser is not on the harness host the same button starts the device-code flow instead and shows a code to enter on the vendor's page, because the local callback would reach the wrong machine. Settings closes the provider tab it opened once the sign-in lands; Grok's consent page confirms delivery itself because the local callback lets `https://accounts.x.ai` read its answer. Credentials live under `${AVN_HOME}` in one file per provider, readable only by the operator, and are never rendered in the browser.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `imagineTransport` | `auto` | `xai-api` uses a configured `XAI_API_KEY`; `grok-build` uses the subscription's OAuth token; `auto` prefers the key and falls back to the subscription. |
| `imagineApiTimeoutMs` | `180000` | Imagine API request ceiling. The subscription route proxies generation through the Grok Build chat proxy and is slower than the direct xAI API. |
| `capabilities.codexSearch` | `false` | Publish Codex-backed web search, which spends Codex quota. |
| `capabilities.codexFast` | `false` | Publish the Codex Fast route when the live catalogue confirms priority eligibility. |
| `capabilities.searchResults` | `5` | Upper bound on results returned by that search. |
| `modelSyncIntervalMs` | `1800000` | Interval between automatic model-list syncs of the signed-in subscriptions. A sync also runs at startup and after each sign-in; `0` limits it to those two moments. |

Image and video generation have no configuration field. Each subscription's image model appears in its card's model list, marked as generating images, and switching it off there withdraws it from the harness image-model list and withdraws the matching generation tools.

### Models

An open, signed-in card lists every model the subscription offers with one checkbox each, plus **Select all** or **Deselect all**. A new model is selected by default. Small icons mark a model that understands images and a model that generates images. A change applies at once: the route's model list, the composer's model picker, and the image-model list follow it. The selection lives in `${AVN_HOME}/subscription-model-selection.json` as the ids the user switched off, so a model the vendor adds later starts selected and a model it removes drops out without touching other choices.

Codex generation/editing and Grok Imagine image results return durable image blocks with a summary stating that the images are already displayed and must not be repeated or embedded in the reply. Workspace-copy paths remain in the typed output and replayable presentation metadata, rather than the model-facing summary.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

Codex is one `OAuthProviderSession` over its credential file, and Grok is one `GrokBuildSession`. Each serves the vendor's live model listing — Grok's `/v1/models`, Codex's `/backend-api/codex/models` without the entries Codex hides — and falls back to its shipped catalog until the first listing arrives. `src/model-sync.ts` re-reads both listings at startup, after each sign-in, and on `modelSyncIntervalMs`; the last listing is cached under `${AVN_HOME}` and restored at startup. A listed Codex id the shipped catalog does not know inherits the newest catalog entry's transport and limits. `createCodingOAuthAdapter` publishes each signed-in provider as an LLM route serving its selected models and resolves a refreshed access token per request.

Usage reporting normalizes two unrelated vendor payloads into one projection (`src/usage-view.ts`): remaining percent per window and epoch-second resets, whatever the vendor reports. Codex answers `wham/usage` with used-percent windows and a credit balance, and Grok answers `/billing?format=credits` with one billing period, a per-product split, and a prepaid cent balance. Money balances carry their ISO 4217 currency and are shown in its minor unit. Each reader caches a successful read briefly and a refusal for much longer, because only a sign-in change can alter a refusal.

Media generation reaches the model through this package's own Imagine and Codex tools, and each subscription's image model is also registered into the harness media seam (`src/media-providers.ts`) as `grok-subscription` and `codex-subscription`, so it appears wherever the harness lists image models. Both are gated on credential readiness and on the model's selection rather than on a setting — a tool or media provider whose backend holds no usable credential, or whose image model the user switched off, is withdrawn rather than offered and failed.

**Runtime invariant:** No companion is published. OAuth sessions and credential files have no independent package-owned observation to compare, while capability, route, and tool contributions are owned by their registries and covered by lifecycle tests.

-----

<a id="further-exploration"></a>
## Further Exploration

- [`packages/media`](../../media/README.md) — the seam these providers register into.
- [`packages/llm`](../../llm/README.md) — the LLM capability the adapter publishes routes on.
- [Experimental subtree rules](../AGENTS.md) — what experimental status does and does not relax.

-----

<a id="model-experience"></a>
## Model Experience

### Subscription models and media tools

#### What the model sees

Signed-in providers appear as ordinary LLM routes, so a model reaches them through normal model selection with no vocabulary of this package. The optional tools it may additionally see are `codex_image_generate`, `codex_image_edit`, `grok_imagine_image`, `grok_imagine_video`, and `grok_imagine_video_status`, each advertised only while its backend holds a credential. A generation tool returns a short text summary plus image attachment references; the browser renders those from the tool result, so a reply does not restate them as markdown.

#### Token effect

The tool schemas are the only standing cost, and only for a session whose credentials make them available; withdrawing a tool removes its schema from the catalogue. Quota reads never enter a model request. A generated image enters the transcript as an attachment reference rather than inline bytes, so its cost is the reference and the summary line, not the media.

#### KV Cache effect

Tool advertisement changes the tool catalogue, and the catalogue is part of the cached prefix: a sign-in or sign-out mid-session withdraws or adds a tool and invalidates the prefix from that point. Ordinary quota refreshes and capability reads do not, because neither reaches a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Image providers in this package refuse `guidanceScale`, `outputFormat` and `optimizePromptMode`; these native Seedream controls are served by the Aeven and DeepInfra providers.

- **Vendor endpoints are private and undocumented.** Quota reads and the Grok Build media route call each vendor's own client endpoints. A vendor may change or withdraw one without notice, and the failure surfaces as a refused tool rather than a build error.
- **The Grok Imagine image model has two names.** The direct xAI API calls it `grok-imagine-image-2.0` and the Grok Build proxy calls it `grok-imagine-image-quality`. Both spellings are accepted and normalized to the transport in play, so a model picker offering either id works whichever credential resolves.
- **Grok's billing redirect is not observed.** The official client hides quota for accounts whose remote settings carry `usage_billing_redirect_url`. This package does not fetch remote settings, so such an account sees numbers its own vendor client would decline to show.
- **The compatibility BOM is now redundant.** `compatibility/avn-bom.json` and `AVN_EXACT_BOM` detect cross-repository version drift, which workspace resolution makes impossible. They are kept until the package settles in the harness, then removed.
- **The package spans several product roles.** OAuth sessions, an LLM adapter, media tools, and a client UI live in one package. It is expected to split along those roles before promotion out of `experimental/`.
- **Credential files are the only durable state.** They hold refresh tokens, and removing a provider's last account deletes its document — a full sign-out that also discards the refresh token, recoverable only by a fresh browser sign-in.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
