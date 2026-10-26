---
description: "The Aeven sign-in, sign-up, OAuth-result, and naming screens for the AVN web client, plus the session restore, bearer refresh, and authenticated-transport helpers the boot kernel calls before the plugin graph exists."
kind: "package-library"
---

# @aeven/client-ui-auth-aeven

English | [中文](README.zh.md)

## Summary

`avn-client-ui-auth-aeven` gives the AVN web shell its Aeven authentication surface: it restores an existing Aeven session, presents the sign-in, sign-up, and OAuth-result screens when there is none, asks a reader Aeven holds no name for what to call them, and attaches the Aeven bearer to every AVN RPC call afterwards. The web boot kernel calls it directly, before any plugin runs, so a reader either arrives at an authenticated application or at a sign-in screen and never at a half-booted one. A session started in the Aeven client is understood here and the reverse, because both use the same storage keys and the same `appBearers` shape. Nothing in this package is model-facing.

After choosing a name, new readers go straight into the application; two-factor authentication is set up from Account settings. Accounts with two-factor authentication enabled complete an authenticator or recovery-code prompt after password or social sign-in. Pending sign-in challenges remain in memory and expire after five minutes.

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

### When to use it

This is a library, not a plugin: the authentication gate runs before the plugin graph exists, so its code cannot arrive through the module system that delivers plugins. It is statically linked into [`avn-client-web`](../web/README.md), which is its only caller. Reach for it when you are changing the web shell's boot sequence; a feature that merely needs to know who is signed in should read the published reader instead of importing this package, because a plugin bundle cannot reach it.

### Entry point

The boot kernel gates on session restore and hands the container to a screen when nobody is signed in:

```text
import { restoreSession, mountAuthScreen, requireSignIn, installAuthenticatedTransport } from '@aeven/client-ui-auth-aeven'

const result = await restoreSession()
if (result.state === 'authenticated') installAuthenticatedTransport()
else if (result.state === 'unnamed') mountNameScreen(container, location.pathname)
else if (result.state === 'unauthenticated') { requireSignIn(location.pathname); mountAuthScreen(container, location.pathname) }
```

`restoreSession` answers `authenticated`, `unnamed`, `unauthenticated`, or `disabled`. `unnamed` is a restored session whose profile has no chosen name: the naming step owns the page until the reader gives one, which the API stores against the account. `disabled` means no Aeven API is configured in the served page, and the shell boots as it does without any authority. Success publishes the reader on the page, which is how a plugin bundle later reads it. That reader carries the account's own picture operations: `setImage` sends the file the reader picked to `/upload-avatar` as multipart and republishes the reader with the stored picture, and `removeImage` clears it through `/delete-avatar` and republishes a reader without one. Both send the bearer, and the account records the picture, so the next load and every other client draw it.

An Aeven that cannot be reached answers `authenticated` from the last profile it kept, rather than signing the reader out. The Host verifies the year-long refresh cookie against its own copy of the signing secret, so it still identifies the reader while Aeven is down and the application keeps reaching the model and OAuth providers the reader configured themselves. Only Aeven refusing the credential, or a sign-out, ends the session.

### What the screens do on success

The screens report success by leaving the authentication surface, and the boot gate is waiting on exactly that: it boots the application in the document the reader is already in, so a reader who signs in is never sent through a document load. The destination is the path they originally asked for, remembered in `authReferrer`; the naming step reports success the same way after storing the name through `/set-display-name`, and the gate reads the profile again rather than trusting that the reader is done.

A provider sign-in follows the flow the deployment states ([`oauthFlow`](../../identity/user-aeven/README.md#provider-sign-in-flow)). Under `redirect` this document goes to the provider and the provider returns it to `/oauth-result`, where the exchange runs. Under `window` a window of its own reaches the provider, exchanges the answer on its landing, and closes; this document keeps the page the reader asked for and picks the session up by reading it, so nothing about the application's document changes. The gate lends the screen its cover (`mountAuthScreen`'s `cover`), which rises from the press on. The pressed provider button shows progress, and pressing any provider again starts over. A reader who comes back without finishing gets the form back as it was, with no provider in progress, once this document has held focus for two seconds after losing it, or for five seconds without ever losing it; finishing in the other window afterwards still signs them in. A sign-in that finished in another window resolves `authenticated` with `elsewhere`, and the gate then raises the cover without fading it in. A shell that runs the provider sign-in itself, as the desktop app does in the default browser, dispatches `aeven:provider-signed-in` on `window` once the session exists, which makes this document read it at once, and `aeven:provider-sign-in-ended` when the sign-in ended without one, which puts the form back the same way.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section covers how the surface is assembled; observable behavior is covered in [Use this package](#use-this-package).

### Ported screens with a supplied service layer

The screens are carried over from the Aeven client as they stand, so the service objects they reach for are assembled here from small local modules rather than edited out of the markup. That keeps the two clients' sign-in behavior identical and confines the port to one seam. React is brought forward for this one purpose, because the screens must be on screen before the UI renderer that normally supplies it.

### Two credentials, two transports

The refresh token is an httpOnly cookie nothing here can read; the API exchanges it for a fresh access token. Every authenticated call goes through `currentBearer`, which returns the held token when it is unexpired and names the right user, and otherwise refreshes. HTTP presents the bearer as `Authorization`. A browser cannot set a header on a WebSocket upgrade, so the Remote stream socket offers the same bearer through the `socketCredential` hook, which rejects while the page holds none rather than letting the socket fall back to a refresh cookie another tab may have replaced. Both are installed through the transport hook the connection plugin already reads, rather than teaching that plugin about Aeven.

### Serialized refresh

The API rotates the refresh token on every exchange, refuses the token it replaced, and clears both cookies when it refuses. Two exchanges presenting the same cookie therefore end the session. Callers in one tab share a single in-flight renewal, and renewals across tabs of one origin run under the `aeven-session-refresh` Web Lock, which re-reads the stored token before exchanging so a renewal another tab just completed is adopted. A plain-HTTP deployment has no Web Locks and serializes within each tab only.

### Session lifetime after boot

`installAuthenticatedTransport` also renews the access token shortly before it expires, and again when the page becomes visible or the network returns; each renewal rotates the year-long refresh token, so an open page stays signed in. A Host 401 renews the bearer and retries the call once. A Host 401 to a request that presented no bearer cannot be renewed — the refresh cookie identified nobody either — so the page records the refusal and signs in again. When the API refuses a renewal with 400 or 401, or another tab's sign-out removes the stored bearer, the page discards the held bearer and tells whoever owns the page through `onSessionEnded` — the boot kernel, which disposes the plugin tree and runs its gate again, so the reader reaches the sign-in screen in the document they are in rather than in a new one. Installing the transport a second time, as a page that boots again does, replaces the watcher rather than adding one. A transport failure or 5xx leaves the session in place and retries.

**One document holds one account.** `appBearers` and `userId` are shared by every tab of the origin, so a sign-in in another tab changes what this one would present. A stored id or an exchange grant naming another account than the page restored is never adopted: the page ends its own session and runs its gate again as the account the browser now holds, so the reader, the navigation and the Sessions on screen all move together. The account that replaced it keeps its bearer — only the tab that signed in signs out. Between sessions (`pageIsLeaving`) the transport presents nothing at all and answers the caller `401` without reaching the Host, because a request sent then would be authenticated by whichever account replaced this one's.

While Aeven is unreachable the access token lapses and no renewal can replace it, so calls go out with no `Authorization` header and the Host authenticates them by the refresh cookie alone. Requests keep succeeding, and the first renewal after Aeven returns restores the bearer. A Remote stream socket that reconnects in that window waits for the renewal instead, because the cookie alone cannot prove it belongs to this page's account.

### The kept profile

Every `/get-profile` answer is kept under `aevenProfile`, and a boot that cannot reach Aeven restores the reader from it, so the account menu shows their name and picture instead of a bare user. A name the reader chooses is written back into that kept entry, so the next load does not ask again. A sign-out discards it along with the bearer; an unparsable entry, or one naming nobody, is treated as absent and the reader signs in. A Host refusal — a 401 this document had no bearer to renew — also outranks it for the pass that follows, because a cookie that identified nobody cannot carry an application whose every call needs a credential.

### Following the page's own loopback host

A configured `localhost` origin is rewritten to the page's own hostname when both are loopback. `localhost` and `127.0.0.1` are different sites to a browser, so a cookie the API set under one is never returned under the other. A configured non-loopback host is a deployment's deliberate choice and is left alone.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | The gate: `restoreSession`, `requireSignIn`, and `installAuthenticatedTransport` |
| [`src/client/auth/mount.tsx`](src/client/auth/mount.tsx) | Mounting a screen, following in-surface navigation, and handing over on success |
| [`src/client/auth/views/NameCheck.tsx`](src/client/auth/views/NameCheck.tsx) | The naming step: the greeting, the name field, and Continue |
| [`src/client/auth/services/tokens.ts`](src/client/auth/services/tokens.ts) | Held bearers, usability check, and the serialized refresh exchange |
| [`src/client/auth/services/watch.ts`](src/client/auth/services/watch.ts) | Background renewal, leaving for the sign-in screen when the session ends, and ending this document's session when the browser holds another account |
| [`src/client/auth/services/errors.ts`](src/client/auth/services/errors.ts) | `AevenApiError`, the session-refusal classification, and the identity-change code |
| [`src/client/auth/services/api.ts`](src/client/auth/services/api.ts) | The Aeven authentication routes the screens call |
| [`src/client/auth/services/config.ts`](src/client/auth/services/config.ts) | Reading the injected endpoints and the loopback-following rule |
| [`src/client/auth/services/reader.ts`](src/client/auth/services/reader.ts) | Stating the restored reader on the page for plugin bundles |
| [`src/client/locales.ts`](src/client/locales.ts) | The `auth.aeven` dictionaries and the browser-language lookup the screens read copy through |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the surface alone is not enough: the shell that calls it, the authority that verifies what it establishes, and the menu that shows the result.

- [avn-client-web](../web/README.md) — the boot kernel that gates on this library before the plugin graph.
- [avn-identity-user-aeven](../../identity/user-aeven/README.md) — the Host authority that verifies the credential and states the endpoints this library reads.
- [avn-client-ui-account-aeven](../ui-account-aeven/README.md) — the account menu that reads the reader this library publishes.
- [client group map](../README.md) — the browser family this package belongs to.

-----

<a id="model-experience"></a>
## Model Experience

None, as the authentication surface is browser-side UI and transport wiring that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the surface, not a task backlog.

- **Signing in costs a document load** — the screens report success by navigating, and the gate re-runs on the fresh document. Handing control to the application in place would require the boot to stay suspended while a screen owns the page.
- **The surface picks its language from the browser alone** — an explicit locale preference lives in Host user settings, which only a signed-in reader has, so the sign-in screen cannot honour one. A reader whose chosen language differs from their browser's sees the sign-in screen in the browser's language.
- **Storage failures degrade to a session-less page** — private modes and blocked site data make the bearer store unreadable, which reads as no session. The page still works; the reader signs in again.
- **Only one Aeven account at a time** — the page session is a module-level singleton, matching what the ported screens expect.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The library owns browser-local session state with no independently observable relationship; restore, refresh, and route matching are covered by the package's own tests.
