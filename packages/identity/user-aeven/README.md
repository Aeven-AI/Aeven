---
description: "Aeven authority for the authenticated-user seam: verifies the Aeven access bearer and refresh cookie locally against the public keys the API publishes, and states the Aeven endpoints in the served page."
kind: "package-reference"
---

# @aeven/identity-user-aeven

English | [中文](README.zh.md)

## Summary

`avn-identity-user-aeven` makes an Aeven account the credential a AVN deployment authenticates against, so a reader signed in to Aeven is signed in here without a second login. It verifies both credentials the Aeven client presents — the access bearer on HTTP calls and the `refreshToken` cookie on a WebSocket upgrade — locally against the ES256 public keys the API publishes at `/.well-known/jwks.json`, so identifying a caller costs no request to Aeven and this Host holds nothing that can sign a token. Mounting it makes the request fence demand a session instead of the launch token, which is a decision a deployment operating an Aeven API makes deliberately. It also states the Aeven endpoints in the served page, which is what gives the browser its sign-in screens.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it after the seam, point `apiUrl` at the Aeven API, and the Web surface presents Aeven's sign-in screens to anyone without a session.

### When to choose it

Choose it when AVN and an Aeven API are operated together and readers should reach AVN with their Aeven account. The Host fetches the API's public keys when it starts, so the API must be reachable from the Host. A deployment that does not run an Aeven API must not mount this row: with an authority present and no reachable API, every `/api` route answers 401 and no reader can sign in.

### Minimal configuration

The row injects the seam and names the API whose keys it verifies against:

```yaml
- id: identity-user-aeven
  name: '@aeven/identity-user-aeven'
  inject: [identityUsers]
  config:
    apiUrl: 'http://localhost:9000'
```

| Field | Default | Meaning |
|---|---|---|
| `id` | `aeven` | Registry key under the seam |
| `jwksRefreshIntervalMs` | 60000 | Least time between two fetches of `<apiUrl>/.well-known/jwks.json` |
| `jwksTimeoutMs` | 10000 | Budget for one key set fetch |
| `refreshCookieName` | `refreshToken` | Cookie carrying the refresh token on a WebSocket upgrade |
| `apiUrl` | none | Aeven API origin the browser signs in against; absent leaves the client with no authentication surface |
| `webUrl` | none | Aeven web client origin the account menu links to |
| `mediaUrl` | none | Origin serving uploaded media that profile-image paths are relative to |
| `xOAuthUrl`, `appleOAuthUrl`, `googleOAuthUrl` | none | Provider sign-in URLs; an absent one hides that provider's button |
| `oauthFlow` | none | How a provider sign-in reaches the provider, stated whenever a provider URL is: `redirect` leaves the reader's document for the provider, `window` reaches it from a window of its own. The plugin refuses to load when a provider is offered without one |

The generated [configuration catalog](../../../docs/config-catalog.md#aevenidentity-user-aeven) is the exhaustive source for every accepted field.

<a id="provider-sign-in-flow"></a>
### State the flow a provider sign-in takes

A provider is reached either by navigating the reader's document or from a window of its own, and the page cannot tell which a deployment means. A public deployment states `redirect`: provider registrations are written for that shape, and the popup blockers a browser applies to `window` are not a risk it has to reason about. An application serving its own page from a scheme or a loopback origin states `window`, because a redirected document there is a second shell to boot.

The flow is required exactly when a provider URL is configured. A deployment that offers none states nothing, and a stated flow without a provider to describe is ignored rather than refused.

### Serve AVN from the same site as the API

A WebSocket upgrade carries no header, so it authenticates by cookie alone, and a browser returns a cookie only to the site that set it. `localhost` and `127.0.0.1` reach the same machine but are different sites: serving AVN on one while the API answers on the other signs a reader in over HTTP and then refuses their socket. The browser configuration follows the page's own loopback host to keep both on one site whichever address was typed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section covers how verification and injection are built; observable behavior is covered in [Use this package](#use-this-package).

### Two credentials, one resolver

The resolver reads the bearer first: an HTTP call carries the access token, the shorter-lived of the two and the one the client keeps fresh. It then falls back to the cookie, which is the only credential a WebSocket upgrade can present. Both are ES256 tokens under one key; the `typ` claim (`access` or `refresh`) keeps one from standing in for the other, mirroring the Aeven API's own `authenticate` and `authenticateSocketUpgrade`. The plugin becomes active only after the first key set fetch completes or fails within `jwksTimeoutMs`, so a Host that waits for its plugin tree admits no request before tokens can verify. If that fetch fails, or without an `apiUrl`, no token verifies until a later fetch succeeds.

### Why verification is local

The seam resolves synchronously, so the authority cannot call Aeven. It checks the signature against the API's public keys instead, held in memory, which makes identifying a caller free of an outbound request. A token naming a key id the Host does not hold starts a background refetch, rate-limited by `jwksRefreshIntervalMs`, so a rotated key verifies from the caller's next request. The price is a revocation window: a token revoked before it expires still verifies here until it does. A sign-out invalidates the credential at its source, which is what keeps that window narrow in practice.

### Stating the endpoints in the page

The Aeven origins are deployment facts, not build facts, so the Host states them rather than the browser bundle carrying them. The plugin pushes a `__AVN_AEVEN__` global onto the `webserver/index-inject` table; the browser authentication library reads it and treats an absent `apiUrl` as "no Aeven authority configured", which is how a composition without this row behaves.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Config, the resolver reading bearer then cookie, and the index-injection listener |
| [`src/jwt.ts`](src/jwt.ts) | Signature and expiry verification producing the user id |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the authority alone is not enough: the seam it registers into, the browser surface that establishes the session, and the fence that enforces it.

- [avn-identity-user](../user/README.md) — the seam and the resolver contract this package implements.
- [avn-client-ui-auth-aeven](../../client/ui-auth-aeven/README.md) — the sign-in screens and the session this authority then recognizes.
- [avn-client-ui-account-aeven](../../client/ui-account-aeven/README.md) — the account menu showing the reader this authority restored.
- [avn-client-connection](../../client/connection/README.md) — the fence that drops the launch token once an authority is mounted.
- [Generated configuration catalog](../../../docs/config-catalog.md#aevenidentity-user-aeven) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

None, as the authority only identifies the caller for the request fence and registers no prompt, tool, or result.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the authority, not a task backlog.

- **Revoked-before-expiry tokens still verify** — local verification cannot observe a revocation the API recorded. The window closes when the token expires.
- **AVN and the API must share a site** — the cookie path requires one site, and the Host must reach the API to load its public keys. This authority suits AVN and Aeven operated together, not a third party integrating against a public Aeven.
- **Mounting it fences the whole surface** — there is no per-route opt-out. A deployment with no reachable Aeven API must remove the row rather than expect a degraded mode.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The authority owns no durable state; resolver registration, token verification, and index injection are covered by the package's own tests.
