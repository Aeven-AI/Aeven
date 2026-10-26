# Agent Note: The desktop shell keeps the Aeven session

Status: implemented

English | [中文](2026-10-26-desktop-keeps-the-aeven-session.zh.md)

## Problem

A desktop reader should stay signed in until they sign out. Four paths ended or weakened the session:

- Only the open window renewed the two-hour access token. Background mode keeps the shell and its Host running with no window, and the Host presents the reader's access token to Aeven's model route, so automations lost Aeven models within two hours of the last window closing.
- The Host held the API's public keys in memory only. A Host started while Aeven was unreachable verified nobody, and once the access token lapsed during an outage the window had no credential the Host accepted, so the reader was sent to the sign-in screen.
- The gateway's cookie authentication and WebSocket upgrade accepted any validly signed refresh token, so a signed-out or password-reset session kept working there for up to a year.
- Electron writes cookies to disk lazily. A crash soon after a rotation could restore a refresh token the API refuses once the 60-second reuse grace has passed.

## Decision

The shell's main process keeps the session ([aeven-session.ts](../../../../apps/desktop/src/aeven-session.ts)) in the cookie jar the window shares. It renews the access token five minutes before it lapses, whether or not a window is open, and hands each token to the Host's credential handover route; each renewal rotates the year-long refresh token. It writes the cookie store to disk whenever the refresh cookie changes and mirrors that cookie onto the Host's loopback origin. When the window has no fresh access token, its requests carry the mirrored cookie, and [`identity-user-aeven`](../../../../packages/identity/user-aeven/README.md) verifies it locally. That authority now keeps the last key set in `jwksCacheFile` and starts from it, refreshing in the background. The gateway (`servers/node`, `services/AuthService.js`) requires the session record to hold a refresh token on the cookie and WebSocket paths, with the same reuse grace `/refresh-token` applies.

A first sign-in still requires Aeven: nothing else can establish who the reader is.

## Alternatives considered

**Give the window the refresh token.** The window's script could then present it, but the token is `httpOnly` so that page script cannot read it.

**Accept expired access tokens offline.** The Host cannot tell an outage from a revoked session, and every expired token would become a credential.

## Consequences

A running shell renews indefinitely, and a reader signed in before stays signed in through an outage of any length within the refresh token's year. A session revoked elsewhere keeps working on an offline machine until it reconnects. Its next renewal is then refused, the API clears the cookie, and the mirror follows. The window's own renewal and the shell's can coincide; the gateway's reuse grace answers the later one with the rotated tokens. An adopted Host started by `avn web` is kept the same way, provided it composes `identity-user-aeven` with the same API.
