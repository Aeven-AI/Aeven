# Agent Note: The Aeven session survives renewal and ends visibly

Status: implemented

English | [中文](2026-09-14-aeven-session-survives-and-ends-visibly.zh.md)

## Problem

A signed-in reader occasionally lost their Aeven session, and the page did not return to the sign-in screen: every RPC call failed and the shell stayed on its loading state until a manual reload.

Two defects combined. The Aeven API rotates the refresh token on every `/refresh-token` exchange, accepts only the latest token (`Session.findOne({ userId, refreshToken })`), and clears both cookies when it refuses. `currentBearer` (`packages/client/ui-auth-aeven/src/client/auth/services/tokens.ts`) refreshed independently per caller, so when the access token lapsed, the parallel RPC calls a booted shell makes each presented the same cookie; the first exchange rotated it and the others were refused, which cleared the cookie and ended the session. Separately, the gate restores the session only before the plugin graph boots, and nothing after boot turned a refusal into a sign-in screen, so the page stayed booted with no credential.

## Decision

Refresh is serialized. Callers in one tab share one in-flight renewal, and renewals across tabs of an origin hold the `aeven-session-refresh` Web Lock and re-read the stored token after acquiring it, adopting another tab's fresh token instead of exchanging a rotated cookie. `currentBearer(rejected)` never returns a token the caller saw refused.

`installAuthenticatedTransport` also starts `watchSession` (`auth/services/watch.ts`). It renews the bearer when it stops being usable (two minutes before expiry), and again when the page becomes visible or the network returns; each renewal rotates the year-long refresh token, so an open page stays signed in. A Host 401 renews the bearer and retries the call once. A refusal (`/refresh-token` answering 400 or 401) or a bearer removed by another tab's sign-out calls `leaveForSignIn`, which deletes the held bearer, records the path in `authReferrer`, and loads `/sign-in`. A transport failure or 5xx keeps the session and retries after 30 seconds.

## Alternatives considered

**Accept the previous refresh token for a grace period on the API.** This also removes the race, including between different clients sharing a cookie jar, but it changes the Aeven server's token model and does not address the missing sign-in redirect. The client-side serialization is needed either way; a server grace period remains a complementary hardening.

**Redirect on any Host 401.** A Host that rejects a bearer Aeven still accepts (a secret mismatch or clock skew) would loop between the sign-in gate, which restores the session, and the booted page. Only Aeven's refusal decides that the session ended.

**Keep the held bearer when leaving.** The token still verifies locally until it expires, so the gate would restore the session from it and boot back into the same failure.

## Consequences

An open page renews its session indefinitely, and an ended session produces a sign-in screen instead of a failing shell. A plain-HTTP deployment has no Web Locks, so two tabs of it can still race; each tab serializes its own callers. A WebSocket carrier refused while no HTTP call runs is noticed at the next renewal, visibility change, or network return rather than immediately.

## Testing

`packages/client/ui-auth-aeven/tests/watch.client.spec.ts` covers single-flight renewal, adoption of another tab's token under the lock, forced renewal of a refused token, the redirect and bearer deletion on refusal, retention on transport failure, the Host-401 retry, cross-tab sign-out, and timed renewal before expiry.
