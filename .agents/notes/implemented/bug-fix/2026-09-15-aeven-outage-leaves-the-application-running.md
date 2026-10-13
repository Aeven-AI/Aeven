# Agent Note: An Aeven outage leaves the application running

Status: implemented

English | [中文](2026-09-15-aeven-outage-leaves-the-application-running.zh.md)

## Problem

With the Aeven API stopped, a page load presented the sign-in screen even though the reader's credentials were intact and nothing they were working with had failed. Signing in was impossible — the screen posts to the same unreachable API — so the harness was unusable until Aeven came back.

`restoreSession` (`packages/client/ui-auth-aeven/src/client/index.ts`) called `getProfile` inside a `catch` that treated every failure alike. An unreachable API rejects `fetch` with a `TypeError`, which carries no status, so an outage was indistinguishable from a refusal and both answered `unauthenticated`. The web boot kernel then mounted an authentication screen over the application.

The rest of the package already drew the distinction. `isSessionRefusal` (`auth/services/errors.ts`) admits only `AevenApiError` with 400 or 401, so the post-boot renewal in `auth/services/watch.ts` correctly kept the session through outages and 5xx. Only the boot gate collapsed the two.

## Decision

Aeven is an identity provider, not an availability dependency. The local node leads: when Aeven cannot be reached, the application boots and runs.

`restoreSession` distinguishes refusal from unreachability. A refusal ends the session as before. Any other failure restores the reader from the profile kept under `aevenProfile` and answers `authenticated`, so the application boots and keeps reaching the model and OAuth providers the reader configured themselves — the providers a packaged app exists to run, none of which Aeven serves.

The Host needs no change, which is what makes this sound. `identity-user-aeven`'s resolver (`packages/identity/user-aeven/src/index.ts`) tries the access bearer and then the `refreshToken` cookie, and `verifiedUserId` checks both against secrets held in the local node's own environment. The fence at `rpc-host.ts` admits whatever that resolver identifies. So a lapsed bearer falls through to the year-long cookie, verified locally, and `/api` keeps answering with Aeven down. The deployment is already required to serve AVN from the same site as the API, so the cookie reaches the local node whatever port it listens on.

Every `/get-profile` answer is kept in `localStorage`, because the profile is what names the reader in the account menu and it cannot be read during an outage. `signOut` discards it with the bearer.

## Alternatives considered

**Send the lapsed access token rather than omitting the header.** It does not work: `verifiedUserId` rejects an expired token, so every call would 401 and fall back to the cookie regardless. Omitting the header reaches the same authority in one hop.

**A grace period on the Host for recently expired bearers.** This weakens the access token's expiry for every caller to solve a problem the refresh cookie already solves, and it would have to be configured to match the outage it anticipates.

**Hold the boot on a retry screen until Aeven answers.** It keeps the reader from a broken-looking application, but it also keeps them from a working one: the local providers are reachable, and a packaged app that refuses to start because a remote identity service is down has made that service leading.

**Treat a 401 from `/refresh-token` as an outage too.** A rotated cookie answers 401 during normal cross-tab races, but so does a revoked or expired one. Admitting it would leave a genuinely ended session unable to reach the sign-in screen.

## Consequences

An Aeven outage is invisible to a signed-in reader: the application boots, the account menu names them from the kept profile, and calls authenticate by cookie. The access token's expiry stops being enforced for the duration, since the long-lived cookie carries the request instead — the cost of the decision, bounded by the cookie's lifetime and accepted deliberately.

A reader who has never signed in on this browser still reaches the sign-in screen during an outage, and cannot sign in until Aeven returns. A revoked session persists until Aeven is reachable enough to refuse a renewal, widening the window `identity-user-aeven` already documents for local verification.

This reverses the [2026-09-14 note's](2026-09-14-aeven-session-survives-and-ends-visibly.md) treatment of a credential-less page. That note made an ended session produce a sign-in screen rather than a failing shell, and its reasoning holds for refusals, which still redirect. It did not distinguish an unreachable authority, and this note governs that case.

## Testing

`packages/client/ui-auth-aeven/tests/gate.client.spec.ts` covers the kept profile written on a successful read, boot through a transport failure and through 5xx, the sign-out redirect preserved on 400 and 401, a first visit during an outage, an unparsable or empty kept profile, sign-out discarding it, and the unconfigured harness.
