# Agent Note: The Hosted Chat Answers on Several Names

Status: implemented

English | [中文](2026-11-16-hosted-page-hosts.zh.md)

## Problem

The hosted Host on pink serves chat.aeven.io, and the owner wants chat.aeven.app to serve the same Host as a second public name rather than redirect to it. The request fence already takes a comma-separated list in `AVN_HOSTED_TRUSTED_HOSTS`, but `identity-user-aeven` writes `AEVEN_API_URL` (`https://chat.aeven.io/api`) into every page as configured. A page loaded from chat.aeven.app would therefore send its sign-in and account calls to chat.aeven.io: a cross-origin request that the Aeven API's credentialed CORS list refuses, with cookies that belong to the other host. Only loopback spellings followed the page's host.

## Decision

`@aeven/host-webserver` gains `sameDeploymentUrl(configured, origin, hosts)`. When both the configured URL's host and the request's host are among the deployment's own public hostnames, it returns the URL on the request's host; loopback spellings still follow `sameHostLoopbackUrl`, and both share one host-swapping helper. `identity-user-aeven` takes the hostnames as an explicit `pageHosts` field and states every page URL through it, and the hosted bundle fills `pageHosts` from `AVN_HOSTED_TRUSTED_HOSTS`, the list the request fence uses. A page on chat.aeven.app is handed `https://chat.aeven.app/api`, while aeven.io's socket, provider sign-in and web URLs pass through unchanged.

## Alternatives considered

- Redirect chat.aeven.app to chat.aeven.io at Cloudflare. Rejected by the owner: the second name should serve chat, not forward.
- Add chat.aeven.app to the Aeven API's `CREDENTIALED_ORIGINS` and keep cross-origin calls. The session cookies would be third-party on chat.aeven.app, which Safari and Brave block.
- Configure `apiUrl` as a relative path. The Host also fetches `<apiUrl>/.well-known/jwks.json` itself, which needs an absolute URL.

## Consequences

Provider sign-ins keep their callbacks on aeven.io (`WEB_DOMAIN`), so X, Apple, Google and the connectors need no new registration; the Aeven API must list each name in `OAUTH_CLIENT_ORIGINS` so a sign-in can return to it. Sessions, installed web apps and browser storage stay per name: a reader signed in on one name signs in once more on the other.

## Verification

`tsc -b` passes for `@aeven/host-webserver`, `@aeven/identity-user-aeven` and the hosted bundle, and the configuration catalog validates. Called directly, `sameDeploymentUrl` turns `https://chat.aeven.io/api` into `https://chat.aeven.app/api` for a chat.aeven.app request and leaves it unchanged for chat.aeven.io, for an unlisted host, and when `hosts` is empty; `wss://aeven.io/socket` and `https://aeven.io/oauth/x` pass through, and `http://127.0.0.1:9000` still follows a `localhost` page.
