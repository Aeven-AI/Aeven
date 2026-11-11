# Agent Note: The Aeven Account Socket Ends Sessions and Carries the Language

Status: implemented

English | [中文](2026-11-11-aeven-account-socket.zh.md)

## Problem

The Aeven website (aeven.io) and the web client (chat.aeven.io) share one Aeven session: the website reads it from the refresh cookie the client's API set. Signing out on the website ended the session at the API, but an open client tab kept working until its held access token lapsed, up to two hours later. The tab presents that token, which still verifies locally at the Host and on its signature at the API, and the watcher asks the API only when it renews. The account's language had the same gap. The client wrote it to the account (`prefs.locale`) for mail, but read its own Host preference only, so a language chosen on the website never reached it.

## Decision

The client holds the Aeven API's account socket for as long as a page's session stands. `watchSession` opens it through `openAccountSocket` and closes it in its disposer. The socket URL is a deployment fact: `identity-user-aeven` takes `socketUrl` and states it in `__AVN_AEVEN__` beside `apiUrl`, under the request's loopback spelling. The hosted bundle sets it from `AEVEN_SOCKET_URL`, defaulting to `wss://aeven.io/socket`, the API's socket, not the Host's own `/socket`. Without it the client opens nothing and behaves as before.

A browser cannot set `Authorization` on a WebSocket, so the page offers its access token as the subprotocol `aeven.bearer.<token>` beside `aeven.account`. The API answers with `aeven.account` and never echoes the token. The Remote stream socket uses the same shape. The refresh cookie is not used, because it belongs to whichever host set it and names whichever account signed in last.

Two frames are acted on, and the client checks their shape at the wire:

- `{"type":"session.ended"}`: the API sends it to every socket of a session before closing them, when the session is signed out from any page or revoked. The client calls `leaveForSignIn`, which discards the held bearer, so the client's other tabs follow through their storage listener as well as their own sockets.
- `{"type":"account.locale","locale":"…"}`: the API sends it to every socket of the account when `/set-locale` stores a language. The watcher records it on the session and tells `onAccountLocale` listeners. The published reader carries `locale`, the account's language from `/get-profile`, and `onLocale`. `ui-account-aeven` applies the language when it boots and when the listener fires, through `ctx.locale.setLocale`. A language the app does not offer, or the one already active, changes nothing.

A socket that closes on its own reopens after five seconds with the token the page holds then. One whose handshake was refused before it opened reopens with a renewed token, so a token that no longer names a session is not offered again, and a session that really ended surfaces as the renewal's refusal. Close codes 1000 (after `session.ended`) and 1008 (no live session) are final.

The API resolves a socket's session from the token's `sid` claim, which every token pair carries and rotation keeps. The website and the client hold different access tokens for one session, and the session row stores only the latest hash, so matching by hash alone would leave one of them unmatched.

## Alternatives considered

**A hidden same-site iframe from chat.aeven.io that clears the client's storage.** The client's existing storage listener would sign its tabs out, and no client code would change. It needs a page whose only job is reaching into another origin's storage, and it cannot carry the language, which lives in the Host preference rather than in browser storage.

**A cookie shared across `aeven.io` subdomains.** It needs no server change, but a cookie change is observable as it happens only through the Cookie Store API, which not every browser supports. Elsewhere it would mean polling, and the language would still need client code to read it.

**Re-check the session when a tab becomes visible.** It closes the gap only when the reader returns to the tab, it costs a refresh-token rotation per visit, and it carries no language.

**Having the API refuse access tokens of ended sessions.** It is a separate hardening step. It ends the revocation window for a token copied out of a page, but an open tab would still learn of the end only on its next request.

## Consequences

Each signed-in client tab holds one more WebSocket, to the Aeven API. Signing out anywhere signs every open page of that session out at once, and a language set anywhere reaches every open page of the account, on every device. The local-verification revocation window recorded in `identity-user-aeven` remains for a token taken out of a page. A deployment that does not set `socketUrl` keeps the previous behavior, where an ended session is learned at the next renewal.
