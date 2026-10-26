# Agent Note: Desktop sign-in is collected by the app

Status: implemented

English | [中文](2026-10-26-desktop-sign-in-is-collected-by-the-app.zh.md)

## Problem

Desktop provider sign-in (Google, X, Apple) opened a loopback listener on an OS-assigned port and sent the system browser through it, so the gateway returned the finished sign-in to `http://127.0.0.1:<port>/oauth-result/...`. The reader saw a local address instead of the Aeven site, and a sign-in that outlived the listener (timeout, replacement, restart) landed on a dead page.

## Decision

The shell draws a verifier and opens the provider route in the system browser as `?app=desktop&nonce=<sha256(verifier)>` ([oauth-browser.ts](../../../../apps/desktop/src/oauth-browser.ts)). The gateway (`servers/node`, `passport/OAuthRedirectTarget.js`) remembers the hash on the session, and for Apple's cookieless form-post callback also in the signed `state`. When the provider finishes, the gateway stores the session/challenge pair, or the refusal, in Redis under the hash for ten minutes (`passport/DesktopHandoff.js`) and leaves the browser on `https://aeven.io/oauth-result/desktop`, a brand page that says "You are signed in to Aeven. You can close this page and return to the app." The shell posts the verifier to `/oauth/desktop/claim` once a second, receives the pair once, and exchanges it through the session that holds the API's refresh cookie. Network failures and server errors count as nothing collected yet. The gate's cover rises from the press on and the pressed provider button shows progress; a reader who comes back without finishing gets the form again after two seconds of focus, or five when the browser never took it. The shell exchanges the pair before it brings the window forward and then reports `signed-in`, so the window raises its cover at once; a timeout or failure reports `ended`, which clears the progress. A reader returning from the browser therefore never sees an idle sign-in form while their sign-in finishes.

## Alternatives considered

**Keep the loopback listener.** It shows a local address in the browser and depends on the listener outliving the sign-in.

**Return through an `aeven:` URL scheme.** The browser asks the reader to open the app, and another application registering the scheme could read the pair.

## Consequences

The browser never visits a local address or opens the app, and reading the start URL or the browser history yields only the hash, which collects nothing. The gateway change must be deployed before a desktop build that uses it ships; an older gateway ignores the marker and returns to the configured web client. A gateway without Redis leaves the browser on the failed page. The headless `avn` sign-in in `@aeven/web-app/sign-in` still uses a loopback listener.
