# Agent Note: Connector sign-ins settle in the background

Status: implemented

English | [中文](2026-10-23-connector-consent-settles-in-background.zh.md)

## Problem

A provider sign-in that the Aeven API had already completed stayed off in Settings. `AccountIntegrations` turns a completed consent into a connector only in `settleConsents`, and only `list()` called it, so the connector appeared when the Settings page happened to re-list: on mount, on a window `focus` event, or on `skills/change`. A reader who watched the provider's "connected" page with Aeven still visible beside it gave the window no new focus, and the connector stayed off until they reopened the page.

## Decision

`authorize()` starts `watchConsents()`, which settles every owner's pending consents every `consentPollMs` (default 2000) until none is pending. Settling a completed consent stores the connector and calls `invalidateSkills()`, whose `skills/change` event the Settings page already listens to, so the page re-lists and shows the connector within one interval. A failed consent, and a failed Slack sign-in, also call `invalidateSkills()` so the page shows the failure the same way. The watch timer is cleared with the service's connector-scope effect.

The background watch and a Settings `list()` can both reach the same completed consent; `settleConsents` re-checks `consent.completion` after the API answers, and the second caller awaits the first one's completion instead of completing the consent twice.

## Alternatives considered

**Poll from the Settings page while a sign-in is pending.** Each poll would run the whole `list()` — skill listings, connector checks, and the WhatsApp and Telegram refreshes — to learn one consent's state, and only an open Settings page would ever settle it.

**Have the Aeven API push the completion to the Host.** No channel from the API to a local Host exists; the broker answers status requests only.

**Emit a dedicated integrations event instead of `skills/change`.** The page already re-lists on `skills/change`, and a completed connector does change the skills its provider contributes; a second event would add a forwarded name for the same refresh.

## Consequences

- A connector switches on within `consentPollMs` of the provider returning to the Aeven API, whether or not Settings is open.
- While a consent is pending the Host sends one status request per pending consent every interval, for at most the consent's `consentLifetimeMs`.
- A failed consent emits `skills/change` although no skill changed, which makes other skill observers re-read their catalogs once.
- The watch was typechecked but not exercised against the Aeven API here.
