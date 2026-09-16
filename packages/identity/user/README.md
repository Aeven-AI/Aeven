---
description: "The authenticated-user seam: ctx.identityUsers, which every DSH subsystem reads to learn who is acting, and the resolver contract an authority package registers into."
kind: "package-reference"
---

# @aeven/identity-user

English | [中文](README.zh.md)

## Summary

`dsh-identity-user` gives a composition one place to answer "who is making this request", so a subsystem that needs the acting user reads `ctx.identityUsers` instead of learning about cookies, bearer tokens, or expiry. Mount it, then mount an authority package that knows a real credential; without one the service recognizes nobody and the request fence keeps its existing behavior, so a stock harness stays single-user and unauthenticated. Resolution is synchronous by contract, because DSH consults it inside the fence that answers before dispatch. The service registers nothing model-facing.

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

Mount this row, mount an authority beside it, and every consumer that needs the acting user reads one service.

### When to choose it

Mount it when a deployment must know who is acting — to fence requests, to attribute work, or to show the signed-in reader. Mounting it alone changes nothing observable: the seam is the registry, and an authority package supplies the credential knowledge. A single-user local harness needs neither row.

### Minimal configuration

The row takes no configuration; an authority mounts after it and injects the service:

```yaml
- id: identity-user
  name: '@aeven/identity-user'

- id: identity-user-aeven
  name: '@aeven/identity-user-aeven'
  inject: [identityUsers]
```

The service exposes three members: `registerResolver(resolver)` adds one authority and returns the disposer that removes it, `enforcing` reports whether any authority is registered, and `resolve(request)` identifies the caller from credential-bearing headers.

### What resolution answers

`resolve` hands the request to each registered authority in registration order and returns the first user any of them recognizes, or `undefined` when none does. A composition controls precedence purely by the order it mounts authorities. The reason a credential failed is deliberately not reported — DSH answers 401 either way, and naming the reason describes the credential back to whoever supplied it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section covers how the registry is built; observable behavior is covered in [Use this package](#use-this-package).

### Design concept

The seam is deliberately thin: a `Map` from authority id to resolver, plus a first-match walk. It holds no credential knowledge of its own, so adding an authority never edits this package. Registering a duplicate id throws rather than silently replacing, because two authorities under one name is a composition mistake that would otherwise surface as an unexplained resolution result.

### Why resolution is synchronous

DSH consults the seam inside the request fence that already runs for every HTTP request and every WebSocket upgrade, and that fence answers before dispatch. A resolver that had to reach a network service could not be consulted there, so the contract forbids it: an authority verifies locally, which is what keeps identifying a caller free of an outbound request.

### The request vocabulary

An authority is given headers only, because that is what both DSH transports have in common — HTTP carries the credential in `authorization`, and a WebSocket upgrade carries it in `cookie` because a browser cannot set a header on the upgrade. Nothing is decoded for the authority; it reads whichever header it recognizes.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The `IdentityUsers` service: resolver registry, `enforcing`, and the first-match `resolve` |
| [`src/types.ts`](src/types.ts) | `User`, `IdentityRequest`, and the `UserResolver` contract an authority implements |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the seam alone is not enough: the authority that implements it, the fence that consults it, and the browser surface a reader signs in through.

- [dsh-identity-user-aeven](../user-aeven/README.md) — the Aeven authority that verifies a real credential against this contract.
- [dsh-client-ui-auth-aeven](../../client/ui-auth-aeven/README.md) — the browser sign-in surface that establishes the session an authority then recognizes.
- [dsh-client-connection](../../client/connection/README.md) — the request fence that reads this service and decides 401.
- [identity group map](../README.md) — the family this package belongs to.

-----

<a id="model-experience"></a>
## Model Experience

None, as the seam only identifies the caller for host-side consumers and registers no prompt, tool, or result.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the seam, not a task backlog.

- **Authorities must verify locally** — `resolve` is synchronous by contract, so an authority that must call a network service to check a credential cannot be registered here. Local verification is what keeps the fence free of an outbound request, and the cost is that a credential revoked before it expires still resolves until it does.
- **No failure reason reaches the caller** — a resolver reports only a user or `undefined`. Distinguishing absent, malformed, and expired credentials is deliberately unavailable to consumers.
- **No ranking between authorities** — precedence is mount order and nothing else. A deployment whose authorities disagree about one credential has a composition problem the seam does not arbitrate.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The registry owns one map with no independently observable relationship; registration and disposal are covered by the package's own tests.
