# Agent Note: X sign-in survives the X app on a phone

Status: implemented

English | [中文](2026-11-11-x-sign-in-survives-the-x-app.zh.md)

## Problem

On 2026-11-11, Sign in with X on chat.aeven.io failed in Chrome on an Android phone. Over USB debugging, the press sent Chrome to `aeven.io/oauth/x`, which redirected to `x.com/i/oauth2/authorize`. Android opened that URL in the X app, which is the verified handler for x.com, twitter.com and their www and mobile hosts. After Authorize, the X app opened the callback `aeven.io/oauth/x/check` in a Brave Custom Tab. Brave held none of Chrome's cookies, so passport-oauth2's session store found no PKCE verifier and refused the state, and the server fell back to the configured result page: "Oops! … please try again". The Chrome tab stayed on the sign-in screen with the X button spinning.

## Decision

The X strategy keeps its PKCE verifier in Redis under the `state` (servers/node `HandoffStateStore`). The state is `OAuthRedirectTarget.stateFor`'s signed value and is bound to the starting session as before. A callback outside that session verifies only when the state was signed for a handoff. The sign-in screen starts X with `app=web` and the SHA-256 of a verifier, and the signed state carries `web:<nonce>`. A callback in another browser stores the session/challenge pair under the nonce through the desktop handoff store and ends on the server's signed-in page. The waiting page collects the pair from `/oauth/desktop/claim` and finishes it through `/oauth-result`. A callback in the starting browser redirects as before.

The same change gives the sign-in header a `brandUrl` link, set to aeven.io in the hosted bundle, and a language control that keeps its pick in browser storage for these screens. It also removes the underline from the screens' links.

## Alternatives considered

An in-between page that forwards to X without a tap was tested on the phone, and Chrome still handed x.com to the X app, because it counts the forward as part of the tap. X serves its authorize page only on hosts the X app claims: `api.x.com` and `api.twitter.com` answer 400, and `twitter.com` redirects to x.com. Turning off the X app's link handling fixes only one device.

## Consequences

An X sign-in whose callback arrives in another browser no longer signs that browser in; it signs in the page that started, and the other browser shows the server's signed-in page. Apple and Google keep passport's session store and never hand off on the web. The sign-in screens' language pick does not carry into the application after sign-in.

## Verification

servers/node passport unit tests (157) pass, including a full X flow whose callback comes from a fresh browser with no session cookie. The aeven client typechecks and builds. On a local `avn web`, pressing X polled the claim route and navigated through `aeven.io/oauth/x?app=web&nonce=…`, the logo linked to https://aeven.io/, and the language control flipped from white to black at phone width. The full phone flow awaits deployment of servers/node.
