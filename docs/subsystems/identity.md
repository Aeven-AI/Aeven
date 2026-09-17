# Authenticated User Identity

English | [中文](identity.zh.md)

The authenticated-user seam — a [capability seam](../glossary.md#capability-seam) on one `ctx.identityUsers` service: Service Definition ([avn-identity-user](../../packages/identity/user), the resolver registry), Service Providers (authorities that know a real credential), and the request fence as its Consumer. Every subsystem that needs to know who is acting reads this one service and never sees a cookie, a bearer token, or an expiry. Identity is **one optional capability**: with no authority registered the service recognizes nobody and a stock harness stays single-user and unauthenticated.

Source: [`packages/identity/user/src/types.ts`](../../packages/identity/user/src/types.ts)

## What an authority is given

An authority receives headers and nothing else, because headers are what both AVN transports have in common. An HTTP request carries its credential in `authorization`; a WebSocket upgrade carries it in `cookie`, because a browser cannot set a header on the upgrade. Nothing is decoded for the authority — it reads whichever header it recognizes.

`User` guarantees only `id`. That is what a subsystem keys work on and the only field an authority must be able to produce; `email`, `displayName`, and `avatarUrl` are presentation an authority may or may not hold, so a consumer that wants a display name handles its absence rather than assuming a profile was fetched.

## Resolution is synchronous

`resolve` is synchronous by contract. AVN consults the seam inside the request fence that already runs for every HTTP request and every WebSocket upgrade, and that fence answers before dispatch. An authority that had to call a network service could not be consulted there, so an authority verifies locally instead. That is what keeps identifying a caller free of an outbound request, and it is the constraint that shapes every authority: the cost is a revocation window, because a credential revoked before it expires still verifies until it does.

## First match wins

`resolve` walks the registered authorities in registration order and returns the first user any of them recognizes. A composition controls precedence purely by the order it mounts them; nothing ranks authorities, because a deployment with two that disagree about one credential has a composition problem rather than a resolution problem. Registering two authorities under one id throws instead of silently replacing.

## Failure carries no reason

An authority reports a `User` or `undefined` — never why. AVN answers 401 either way, and naming the reason would describe the credential back to whoever supplied it. Consumers therefore handle one case, not three.

## What mounting an authority changes

`enforcing` reports whether any authority is registered, and the request fence reads it. With none, the fence keeps its existing behavior and the launch token still decides which browser may speak to the process. With one, the launch token is replaced: the token grants nothing the sign-in screen does not, and printing one would invite a reader to treat a URL as a credential. The Host/Origin fence still always runs — it answers whether the process will speak to the caller's page at all, which no authentication replaces.

The served index stays readable to anyone once an authority is mounted. It carries no data and it is what presents the sign-in screen; refusing it would leave a reader with nothing to sign in through. Every API route behind it demands a session.


<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxidentityusers--identityusers"></a>

### `ctx.identityUsers` — `IdentityUsers`

Registry of authorities, and the resolution every consumer goes through.

```ts cordis-catalog
/**
 * Register one authority.
 * @param resolver - the authority to add.
 * @returns the disposer removing it.
 */
registerResolver(resolver: UserResolver): () => void

/**
 * Identify the caller through the registered authorities.
 *
 * The first authority that recognizes the credential answers. Order is
 * registration order, which a composition controls by the order it mounts
 * them; nothing here ranks authorities, because a deployment with two that
 * disagree about one credential has a composition problem, not a resolution
 * problem.
 * @param request - the credential-bearing headers.
 * @returns the authenticated user, or undefined when none recognized it.
 */
resolve(request: IdentityRequest): User | undefined
```

Source: [`packages/identity/user/src/index.ts`](../../packages/identity/user/src/index.ts)
<!-- END GENERATED cordis-surface -->

## Packages

| Package | Role |
|---|---|
| [avn-identity-user](../../packages/identity/user/README.md) | Service Definition: the resolver registry, `enforcing`, and first-match `resolve` |
| [avn-identity-user-aeven](../../packages/identity/user-aeven/README.md) | Service Provider: verifies the Aeven access bearer and refresh cookie against the API's own signing secrets |
| [avn-client-ui-auth-aeven](../../packages/client/ui-auth-aeven/README.md) | The browser surface that establishes the session an authority then recognizes |
| [avn-client-ui-account-aeven](../../packages/client/ui-account-aeven/README.md) | The account menu showing the reader an authority restored |

## Related

- [HTTP server](web-server.md) — the server whose request fence consults this seam.
- [Web Client architecture](web-client.md) — the shell whose boot gates on session restore before the plugin graph.
- [User credentials](credentials.md) — the unrelated outbound seam: secrets AVN presents to providers, not callers AVN identifies.
