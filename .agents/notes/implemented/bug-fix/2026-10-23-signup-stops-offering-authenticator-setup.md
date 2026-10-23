# Agent Note: Signup stops offering authenticator setup

Status: implemented

English | [中文](2026-10-23-signup-stops-offering-authenticator-setup.zh.md)

## Problem

The naming step stored the reader's name and then asked `GET /mfa/status` whether to offer authenticator enrollment, which put a security decision between a new reader and the product. The offer also made a stored name depend on a route some deployments do not serve: an API older than the authenticator work answered a stored name with the step's failure state until the step treated an unanswerable status as "no protection" ([the naming step outlives a missing MFA status route](2026-10-15-naming-step-outlives-a-missing-mfa-status-route.md)). Enrollment is reachable in Account settings, where the security section describes it and its own setup call runs.

## Decision

`NameCheck` stores the name and calls `onNamed()`. The step makes no `/mfa/status` request, holds no enrollment-offer state, and renders no authenticator form; a refused `/set-display-name` still raises the surface's popup and leaves the reader on the step.

`MfaForm` accepts `mode: 'setup' | 'disable'` and renders one body for both. The `offer` mode, its intro paragraph, and its primary and skip buttons are absent, and `MfaKey` no longer names `mfa.intro`, `mfa.setup`, or `mfa.skip`. The dictionaries of both `ui-auth-aeven` and `ui-account-aeven` drop those three keys from their English, Chinese, and Spanish tables.

Account settings is the one place to enroll: `AccountSection` renders `MfaForm` in its cells layout with `mode` at `setup` or `disable`, keeps the confirmed On/Off state beside it, and its `security.info` copy states that signing in requires a code from the authenticator app.

## Alternatives considered

**Keep the offer and the status call in the naming step.** The step's job is the name, and enrollment is already reachable from settings, so the offer added a second decision to signup and made a stored name depend on a status route that deployments may not serve.

**Keep `MfaForm`'s `offer` mode for a later caller.** After the naming step stopped rendering it, no composition passed `mode: 'offer'`; keeping it would leave an unreachable branch with three copy keys in two dictionaries for a screen nothing shows.

**Require two-factor enrollment during signup.** Protection is optional at Aeven, so a reader who does not want it would have to obtain an authenticator app before reaching the product.

## Consequences

- Signup ends at the name, so a new reader reaches the product without a security decision, and the step makes one API call where it made two.
- A deployment that serves no `/mfa` routes needs no status answer to finish signup; the step's only refusal is a refused name.
- Enrollment is reached from Account settings alone; `MfaForm` renders a single body and `infoKey` switches between `mfa.scan` and `mfa.disableInfo`.
- The three removed copy keys leave both packages' English, Chinese, and Spanish tables, so each dictionary stays complete against its key type.
- `packages/client/ui-auth-aeven/tests/name-check.client.spec.tsx` waits for `onNamed` after a stored name without an intermediate screen, keeps the refused-name and ended-session cases, and the offer-form snapshot is deleted with the offer.
