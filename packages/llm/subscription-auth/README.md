---
description: "Coding-subscription OAuth for Grok Build, ChatGPT Codex, and Claude Code: model routes, quota reporting, image and video generation, and a group on the Model providers settings page."
kind: "package-bundle"
---

# @aeven/subscription-auth

English | [中文](README.zh.md)

## Summary

`avn-subscription-auth` lets a deployment drive models from coding subscriptions the operator already pays for, instead of an API key. It signs in to Grok Build, ChatGPT Codex, and Claude Code over OAuth, publishes each as an LLM route, reports what quota is left, and contributes image and video generation to the media seam. A Subscriptions group on the Model providers settings page owns sign-in and quota in the browser, in the same rows as the API-key providers. It is experimental: excluded from official releases, and it talks to private endpoints the vendors do not document, so a provider change can break a route without warning.

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

Choose it when the operator holds a SuperGrok, ChatGPT Plus/Pro, or Claude Pro/Max subscription and wants those models available without provisioning API keys. Do not choose it to serve those subscriptions to anything but this deployment: each vendor's terms govern what a subscription may drive, and this package uses each vendor's own client route rather than a public API.

### Sign in

Every provider is signed in from Settings → Model providers, in its Subscriptions group. **Sign in** opens the vendor's sign-in page in a new tab and completes through the harness's local callback, so nothing is entered in Settings. Grok Build and Codex also offer **Sign in with code**, a device-code flow that shows a code to enter on the vendor's page; it comes first when the browser is not on the harness host, because the local callback would reach the wrong machine. Claude Code is browser only. Settings closes the provider tab it opened once the sign-in lands; Grok's consent page confirms delivery itself because the local callback lets `https://accounts.x.ai` read its answer. Credentials live under `${AVN_HOME}` in one file per provider, readable only by the operator, and are never rendered in the browser.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `imagineTransport` | `auto` | `xai-api` uses a configured `XAI_API_KEY`; `grok-build` uses the subscription's OAuth token; `auto` prefers the key and falls back to the subscription. |
| `imagineApiTimeoutMs` | `180000` | Imagine API request ceiling. The subscription route proxies generation through the Grok Build chat proxy and is slower than the direct xAI API. |
| `capabilities.codexSearch` | `false` | Publish Codex-backed web search, which spends Codex quota. |
| `capabilities.codexFast` | `false` | Publish the Codex Fast route when the live catalogue confirms priority eligibility. |
| `capabilities.searchResults` | `5` | Upper bound on results returned by that search. |

Image and video generation are not configurable. They are part of the subscription rather than a deployment choice, so they are fixed on with their limits at the provider maximum, and the Settings page does not offer them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

Each provider is one `OAuthProviderSession` over a per-provider credential file, plus `GrokBuildSession` for Grok. Every route offers its shipped catalogue: nothing fetches a provider's model list automatically, and a listing cached by an earlier fetch is not restored. `createCodingOAuthAdapter` publishes each signed-in provider as an LLM route and resolves a refreshed access token per request.

Usage reporting normalizes three unrelated vendor payloads into one projection (`src/usage-view.ts`): remaining percent per window and epoch-second resets, whatever the vendor reports. Codex answers `wham/usage` with used-percent windows and a credit balance, Claude answers `/api/oauth/usage` with three utilization buckets and a monthly extra-usage allowance, and Grok answers `/billing?format=credits` with one billing period, a per-product split, and a prepaid cent balance. Money balances carry their ISO 4217 currency and are shown in its minor unit. Each reader caches a successful read briefly and a refusal for much longer, because only a sign-in change can alter a refusal.

Media generation reaches the model two ways: the harness media seam, which the `image.generate` tool drives with a provider picker, and this package's own Imagine and Codex image tools. Tool advertisement is gated on credential readiness rather than on a setting — a tool whose backend holds no usable credential is withdrawn rather than offered and failed.

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

- **Vendor endpoints are private and undocumented.** Quota reads and the Grok Build media route call each vendor's own client endpoints. A vendor may change or withdraw one without notice, and the failure surfaces as a refused tool rather than a build error.
- **The Grok Imagine image model has two names.** The direct xAI API calls it `grok-imagine-image-2.0` and the Grok Build proxy calls it `grok-imagine-image-quality`. Both spellings are accepted and normalized to the transport in play, so a model picker offering either id works whichever credential resolves.
- **Grok's billing redirect is not observed.** The official client hides quota for accounts whose remote settings carry `usage_billing_redirect_url`. This package does not fetch remote settings, so such an account sees numbers its own vendor client would decline to show.
- **The compatibility BOM is now redundant.** `compatibility/avn-bom.json` and `AVN_EXACT_BOM` detect cross-repository version drift, which workspace resolution makes impossible. They are kept until the package settles in the harness, then removed.
- **The package spans several product roles.** OAuth sessions, an LLM adapter, media providers, tools, and a client UI live in one package. It is expected to split along those roles before promotion out of `experimental/`.
- **Credential files are the only durable state.** They hold refresh tokens, and removing a provider's last account deletes its document — a full sign-out that also discards the refresh token, recoverable only by a fresh browser sign-in.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
