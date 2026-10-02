# Agent Note: Subscription providers as foldout cards with per-model selection

Status: implemented

English | [中文](2026-10-02-subscription-providers-model-selection.zh.md)

## Problem

The Subscriptions group on the Model providers page showed Grok, Codex, and Claude as flat rows: sign-in buttons, including a separate **Sign in with code**, sat on the collapsed row, usage was a second disclosure, and no row listed its models. Every subscription served its whole shipped catalog: a user could not switch a model off, a model the vendor added did not appear until a release, and a model it withdrew stayed in the picker. The subscription image models (Grok Imagine, GPT Image 2) were reachable only through their own tools, never through the harness image-model list. Claude Pro/Max OAuth outside Anthropic's own apps is billed to usage credits rather than plan limits, so the Claude row offered API-key billing under a subscription label.

## Decision

**The page is Providers, and each subscription is a foldout card.** `ui-settings-models` names its section Providers. `avn-subscription-auth` renders Grok, then Codex, as cards built from the Plugins card values: the header names the provider, its plan, and its sign-in state; the open card holds the sign-in steps or the usage and the models; its footer holds **Sign in**, **Cancel sign-in**, or **Sign out** with an inline confirmation. A closed card carries no action. One **Sign in** button starts the browser flow on the harness host and the device-code flow when the page is opened from another machine, so the separate code button is gone.

**Claude is removed.** Its route, provider definition, usage reader, and credits remap are deleted; `CODING_OAUTH_ROUTES` is `grok-build` and `codex-oauth`.

**Selection is stored as exclusions.** `ModelSelection` keeps `${AVN_HOME}/subscription-model-selection.json` as the ids the user switched off per provider. Both sessions filter their served models through it, so the route's model list, the composer picker, and the image-model list follow a change at once. A new model is selected by default; a withdrawn model disappears without touching other choices. The status route reports each provider's models with `imageInput`, `imageOutput`, and `selected`, and `POST /plugins/dsh-grok-build/oauth/models` replaces one provider's selection.

**The model lists sync automatically.** `startModelSync` reads Grok's `/v1/models-v2` and Codex's `/backend-api/codex/models` (without entries Codex hides) at startup, after each sign-in, and every `modelSyncIntervalMs` (default 30 minutes). Each listing is cached under `${AVN_HOME}` and restored at startup; a failed read keeps the last listing. A Codex id the shipped pi-ai catalog does not know inherits the newest catalog entry's transport and limits, so the request provider serves exactly the listed models.

**Subscription image models join the image-model list.** `grok-subscription` and `codex-subscription` register on `ctx.media`, listing their image model only while the subscription holds a credential and the model is selected; a switched-off image model also withdraws its generation tools. `tool-media` gains `listedProviders`, whose live listings are offered after the configured `choices` in the picker, `/image-models`, and call validation; the shipped presets list both subscription providers. This reverses the media-seam paragraph of [Aeven's two image models are the only image models](../architecture/2026-10-01-aeven-image-models-only.md) for providers the presets name explicitly; Aeven Flash stays the default.

## Alternatives considered

**Drive each vendor's CLI as the runtime, as T3 Code does.** Rejected for this change: Anthropic currently bills Agent SDK and `claude -p` use to plan limits but announced and paused a move to a separate credit, so the benefit for Claude may not last, and OpenAI does not restrict Codex OAuth use outside its CLI. The OAuth sign-in stays.

**Persist the selected ids.** Rejected: a model the vendor adds would start switched off, and a withdrawn id would linger in the stored list.

**Keep a separate Sign in with code button.** Rejected: the access mode the status route already reports decides which flow can complete, so the choice is not the user's to make.

**Register subscription image models only on the media seam.** Rejected: `tool-media` limits every selection to its configured choices, so the models would be listed but never selectable.

## Consequences

The Providers page shows every subscription model and its capabilities, and the user's selection reaches routes, pickers, and image tools without a restart. Listing syncs make periodic authenticated calls to two undocumented vendor endpoints; a vendor change surfaces as a stale list rather than an empty one. Removing Claude deletes its stored-credential support: an existing `claude-code-oauth` credential file is no longer read.
