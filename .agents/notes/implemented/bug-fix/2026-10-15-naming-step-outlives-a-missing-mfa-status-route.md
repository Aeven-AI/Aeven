# Agent Note: The naming step outlives a missing MFA status route

Status: implemented

English | [中文](2026-10-15-naming-step-outlives-a-missing-mfa-status-route.zh.md)

## Problem

The naming step stored the reader's name and then asked `GET /mfa/status` whether to offer authenticator enrollment. Every failure of that second call set the step's failure state, so an Aeven API that serves no `/mfa` routes — the deployment that predates the authenticator work — answered a stored name with "I could not save that name. Please try again" and held the reader there, because the naming gate keeps the application from booting until the step reports a name. The refusal was also a line under the button, while every other refusal on this surface is a popup.

## Decision

The step reports what happened to the name, and only that. A refused `/set-display-name` raises the surface's popup — the `show:modal` event carrying `modal.oops` over `name.saveFailed` — and leaves the reader on the step. The step makes no second call, so neither a `/mfa/status` request nor an enrollment offer stands between the stored name and the application ([signup stops offering authenticator setup](2026-10-23-signup-stops-offering-authenticator-setup.md)); enrollment lives in Account settings.

The naming gate boots the application only after the name is stored, so a reader never reaches the product ahead of it.

## Alternatives considered

**Keep the line under the button and only stop the status call from setting it.** The line is a departure: sign-in and sign-up report their refusals in the popup, and a line below a button reads as a field error.

**Offer enrollment when the status cannot be answered.** The enrollment screen's own setup call fails the same way, so the reader would be moved onto a screen it cannot finish; the offer's copy already promises the protection can be turned on later from settings.

**Require the status route and refuse to boot without it.** Two-factor authentication is optional, so an unanswered status call must not gate the application.

## Consequences

An API older than the authenticator work names readers normally, because the step reads nothing else from it. The step does not separate "no protection" from "cannot tell": with protection enabled, the reader reaches the application and the extra factor is required at the next sign-in, as it already is for a session that predates enabling it.

## Verification

`packages/client/ui-auth-aeven/tests/name-check.client.spec.tsx` covers both paths: a refused name raises the popup and leaves the reader on the step, and a stored name boots the application. The screen was also rendered in a browser at 1728x997 and driven through those two answers, with the prompt measured centred over the name field.
