---
description: "Aeven authority for the authenticated-user seam: verifies the Aeven access bearer and refresh cookie locally against the API's own signing secrets, and states the Aeven endpoints in the served page."
kind: "package-reference"
---

# @aeven/identity-user-aeven

English | [中文](README.zh.md)

## Summary

`dsh-identity-user-aeven` makes an Aeven account the credential a DSH deployment authenticates against, so a reader signed in to Aeven is signed in here without a second login. It verifies both credentials the Aeven client presents — the access bearer on HTTP calls and the `refreshToken` cookie on a WebSocket upgrade — locally against the API's own signing secrets, so identifying a caller costs no request to Aeven. Mounting it makes the request fence demand a session instead of the launch token, which is a decision a deployment operating an Aeven API makes deliberately. It also states the Aeven endpoints in the served page, which is what gives the browser its sign-in screens.

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

Mount it after the seam, give it the Aeven API's two signing secrets, and the Web surface presents Aeven's sign-in screens to anyone without a session.

### When to choose it

Choose it when DSH and an Aeven API are operated together and readers should reach DSH with their Aeven account. Local verification is only sound under that condition, because it depends on sharing the API's secrets. A deployment that does not run an Aeven API must not mount this row: with an authority present and no reachable API, every `/api` route answers 401 and no reader can sign in.

### Minimal configuration

The row injects the seam and reads its secrets from the environment:

```yaml
- id: identity-user-aeven
  name: '@aeven/identity-user-aeven'
  inject: [identityUsers]
  config:
    apiUrl: 'http://localhost:9000'
    accessSecretEnv: AEVEN_JWT_SECRET
    refreshSecretEnv: AEVEN_REFRESH_SECRET
```

| Field | Default | Meaning |
|---|---|---|
| `id` | `aeven` | Registry key under the seam |
| `accessSecretEnv` | `AEVEN_JWT_SECRET` | Environment variable holding the access-token secret |
| `refreshSecretEnv` | `AEVEN_REFRESH_SECRET` | Environment variable holding the refresh-token secret |
| `refreshCookieName` | `refreshToken` | Cookie carrying the refresh token on a WebSocket upgrade |
| `apiUrl` | none | Aeven API origin the browser signs in against; absent leaves the client with no authentication surface |
| `webUrl` | none | Aeven web client origin the account menu links to |
| `mediaUrl` | none | Origin serving uploaded media that profile-image paths are relative to |
| `xOAuthUrl`, `appleOAuthUrl`, `googleOAuthUrl` | none | Provider sign-in URLs; an absent one hides that provider's button |

The generated [configuration catalog](../../../docs/config-catalog.md#aeven-identity-user-aeven) is the exhaustive source for every accepted field.

### Serve DSH from the same site as the API

A WebSocket upgrade carries no header, so it authenticates by cookie alone, and a browser returns a cookie only to the site that set it. `localhost` and `127.0.0.1` reach the same machine but are different sites: serving DSH on one while the API answers on the other signs a reader in over HTTP and then refuses their socket. The browser configuration follows the page's own loopback host to keep both on one site whichever address was typed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section covers how verification and injection are built; observable behavior is covered in [Use this package](#use-this-package).

### Two credentials, one resolver

The resolver reads the bearer first: an HTTP call carries the access token, the shorter-lived of the two and the one the client keeps fresh. It then falls back to the cookie, which is the only credential a WebSocket upgrade can present. Each is verified against its own shared secret, mirroring the Aeven API's own `authenticate` and `authenticateSocketUpgrade`. A missing or empty secret disables that path rather than accepting anything.

### Why verification is local

The seam resolves synchronously, so the authority cannot call Aeven. It checks the signature with the API's secret instead, which makes identifying a caller free of an outbound request. The price is a revocation window: a token revoked before it expires still verifies here until it does. A sign-out invalidates the credential at its source, which is what keeps that window narrow in practice.

### Stating the endpoints in the page

The Aeven origins are deployment facts, not build facts, so the Host states them rather than the browser bundle carrying them. The plugin pushes a `__DSH_AEVEN__` global onto the `webserver/index-inject` table; the browser authentication library reads it and treats an absent `apiUrl` as "no Aeven authority configured", which is how a composition without this row behaves.

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

- [dsh-identity-user](../user/README.md) — the seam and the resolver contract this package implements.
- [dsh-client-ui-auth-aeven](../../client/ui-auth-aeven/README.md) — the sign-in screens and the session this authority then recognizes.
- [dsh-client-ui-account-aeven](../../client/ui-account-aeven/README.md) — the account menu showing the reader this authority restored.
- [dsh-client-connection](../../client/connection/README.md) — the fence that drops the launch token once an authority is mounted.
- [Generated configuration catalog](../../../docs/config-catalog.md#aeven-identity-user-aeven) — every accepted config field and its source declaration.

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
- **DSH and the API must share a site and a secret** — the cookie path requires one site, and local verification requires the API's own `JWT_SECRET` and `REFRESH_SECRET`. This authority suits DSH and Aeven operated together, not a third party integrating against a public Aeven.
- **Mounting it fences the whole surface** — there is no per-route opt-out. A deployment with no reachable Aeven API must remove the row rather than expect a degraded mode.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The authority owns no durable state; resolver registration, token verification, and index injection are covered by the package's own tests.
