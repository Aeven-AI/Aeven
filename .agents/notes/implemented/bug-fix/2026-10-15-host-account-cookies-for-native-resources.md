# Agent Note: Host account cookies for browser-native resources

Status: implemented

English | [中文](2026-10-15-host-account-cookies-for-native-resources.zh.md)

## Problem

With an identity authority enforcing sign-in, the page authenticates Host RPC with a JavaScript-held bearer. The Aeven refresh cookie belongs to the upstream API, and the Host launch cookie grants no account identity. Browser-native image, file, and video requests cannot attach that bearer, so the Host returns 401 to their resource reads ([issues 83 and 84](https://github.com/Aeven-AI/Aeven/issues/83)).

## Decision

Each admitted bearer request under `/api`, including `HEAD /api/credential`, renews a host-only `avn-account-<authority hash>` cookie. `BrowserAuth` signs `{version, authority, userId, issuedAt, expiresAt}` with the durable `client-connection/browser-session` secret. Verification checks the signature, exact authority, issue time, expiry, and this kind's own 12-hour lifetime bound. Attributes are `HttpOnly; SameSite=Strict; Path=/api`, without `Secure` for loopback HTTP. Ordinary API traffic re-mints the cookie, so a short life keeps it fresh while bounding how long a signed-out account keeps reading resource bytes.

The fence resolves identity credentials first, then the account cookie only when Authorization is absent. A cookie request is admitted only for `GET` and `HEAD` on a registered exact Fetch route — the byte routes a browser loads on its own, such as `/api/file`, `/api/attachment-file`, and `/api/attachment-image` — and dispatches through `identityUsers.runAs({id: userId}, work)`, so account ownership checks retain their caller. RPC channels, WebSocket streams, and every other method keep requiring the page's own credential, so the cookie never becomes a second key to the tool-capable API. The launch cookie remains unusable under an enforcing identity authority, preserving [per-account isolation](../architecture/2026-09-30-per-account-isolation-on-a-shared-host.md).

Resource URLs remain directly openable and retain the attachment-file route's Range support for video seeking. Markdown local paths resolve against HTTP(S) and `avn-app:` origins.

## Alternatives considered

**Load resource bytes into browser blobs.** This requires separate plumbing for each image, video, file-opening, and sidebar consumer, and replaces directly openable resource URLs.

**Accept the launch cookie under identity enforcement.** It identifies no account and cannot support account ownership checks.

## Consequences

Browser-native subresource reads use the last account cookie stored at that origin: last sign-in wins for these reads, and each later admitted bearer request can replace the cookie again. RPC and WebSocket requests presenting a page's bearer retain that page's identity. The Host account cookie remains valid until its own expiry — at most 12 hours after the last admitted bearer request — even if the upstream bearer expires or the page signs out; rotating the signing record takes effect on Connection reactivation.

Desktop spawn mode dispatches `avn-app://app` byte requests through `dispatchApi` without `requestRejection`; its existing unauthenticated byte routes remain separate work. Fence tests do not cover desktop attach/spawn rendering, tool previews, file opening, video playback/seeking, or sidebar images; these require manual verification.

## Verification

Fence tests cover cookie minting and renewal, persistent-secret verification, expiry, wrong authority, forged signatures, launch-cookie rejection, explicit-bearer precedence, account attribution through the real identity service, and the cookie's own admission limit: `GET` and `HEAD` on a registered byte route, refused for another method, an RPC path, or a request that states no request line at all. The browser image URL and attachment Range implementations remain intact.
