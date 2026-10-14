# Agent Note: The Remote stream socket is identified by the page's bearer

Status: implemented

English | [中文](2026-10-14-socket-identity-from-page-bearer.zh.md)

## Problem

A reader signed in to the web client with Google saw another account's folders in the sidebar, next to an Ungrouped bucket holding their own Sessions. The page reached the Host through two credentials that could name different accounts. HTTP calls carried the page's access token as `Authorization`. The `/api/remote.mux` WebSocket cannot carry a header, so `identity-user-aeven` identified it by the `refreshToken` cookie, once at the upgrade, for the socket's whole life. That cookie is host-scoped: every tab and port on `localhost` shares it, and it names whichever account signed in last. The Workspace feed runs over the socket, so it listed the email account's Workspaces, while the Session list over HTTP listed the Google account's Sessions. None of those Sessions belonged to a Workspace the socket's account could see, so they fell into Ungrouped.

The mixed view also wrote across accounts. The page offered the email account's folder, and `session.create` attached the Google account's new Sessions to it, because `create` resolved the named Workspace without the owner check that `move` applies.

## Decision

The socket presents the page's own bearer. `ClientTransportHooks.socketCredential` is installed by `ui-auth-aeven` beside its `fetch` hook and exposed as `ctx.connection.socketCredential`. `RemoteStreamMuxClient` reads it for every attempt and offers `avn.remote` plus `avn.bearer.<token>` as subprotocols. The Host's upgrade route maps the bearer subprotocol to `Authorization` and drops `cookie` from the headers the fence and the identity seam read (`remoteStreamTrustRequest`), and the WebSocket server selects `avn.remote`. The hook rejects while the page holds no bearer, which fails that attempt so Connection retries it instead of opening a socket by cookie.

`identity-user-aeven` lets a presented bearer decide alone. An invalid or expired bearer names nobody instead of falling back to the cookie, and the client's existing 401 path renews and retries. The cookie identifies only a request that presents no bearer.

`session.create` answers `workspace/not-found` for a Workspace the caller may not reach, matching `move`.

## Alternatives considered

**Bearer in the socket URL query.** Rejected: URLs reach logs and history, and the token is a live session credential.

**A first-frame authentication message.** Rejected: the mux protocol has no unauthenticated phase, and the fence answers at the upgrade before any frame exists.

**A short-lived ticket minted over HTTP.** Rejected for now: it adds a Host endpoint and ticket state to carry the same fact the access token already carries.

## Consequences

During an Aeven API outage, HTTP still falls back to the cookie once the access token lapses. A socket that reconnects in that window waits for the next renewal, because the cookie cannot prove it belongs to this page's account. Device-hub sockets are admitted by the fence but carry no per-account identity, so they are unchanged. Sessions that were already attached to another account's Workspace stay there until moved; they appear under Ungrouped for their owner.
