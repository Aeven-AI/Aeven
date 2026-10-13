# Agent Note: Desktop subscription sign-in

Status: implemented

English | [中文](2026-10-10-desktop-subscription-sign-in.zh.md)

## Problem

The desktop overlay disables the subscription plugin because it requires `webServer`. Electron also denies the blank popup used by its sign-in UI, so enabling the plugin alone leaves authentication unusable.

## Decision

Desktop enables the existing HTTP carrier on `127.0.0.1` with an OS-assigned port. Its framed-pipe Fetch dispatcher forwards only `/plugins/avn-grok-build/` requests from `avn-app://app` to that listener, rejecting foreign origins and cross-site Fetch metadata before assigning the loopback origin. The listener retains the subscription owner-request checks. The frontend uses the existing connector `openExternal` bridge for sign-in and provider links; Web opens a separate tab during the click for both browser and device flows. Existing callback, polling, credential persistence, and model-selection implementations remain the owners of authentication.

The [desktop packaging decision](../architecture/2026-08-25-electron-desktop-packaging-and-updates.md) retains the framed-pipe transport for application traffic. The subscription HTTP listener is a local exception to its port-free transport choice.

## Consequences

Subscriptions contribute their Providers cards in Electron as in Web. The local HTTP carrier adds a loopback listener for the desktop process lifetime. Provider credentials stay in the existing owner-only stores. Validation is limited to TypeScript compilation and build at the user's request; live provider authentication is unverified.

## Alternatives considered

**Enable only the cards.** Their sign-in, usage, and model-selection requests require working Host routes.

**Replace subscription HTTP routes with new RPC endpoints.** That duplicates the existing route implementation and changes the Web path for a desktop transport gap.

**Open an embedded Electron authentication window.** The existing connector bridge opens the reader's default browser, preserving that browser's provider session and avoiding embedded-browser restrictions.
