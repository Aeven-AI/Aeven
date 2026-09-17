---
description: "The signed-in Aeven reader's avatar and account menu in the Web Session header: their picture or initial, a link to the Aeven account page, night mode, and sign out."
kind: "package-reference"
---

# @aeven/client-ui-account-aeven

English | [中文](README.zh.md)

## Summary

`avn-client-ui-account-aeven` puts the signed-in reader's avatar in the Web Session header and opens their account menu from it, so a reader can see who they are signed in as, reach their Aeven account page, switch night mode, and sign out. It shows whoever the Aeven authority already restored and asks Aeven for nothing of its own, so it costs no request of its own. With nobody signed in there is no reader to show and the seat stays empty. Enable it together with the Host authority; alone it renders nothing.

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

Mount the row in a Web composition that also mounts an Aeven authority, and the header grows an avatar that opens the account menu.

### When to choose it

Choose it whenever a deployment authenticates readers against Aeven and wants them to see and manage that session. Without an authority there is no reader, so the row renders nothing — enable and disable it together with `identity-user-aeven` rather than on its own.

### Minimal configuration

The row takes no configuration; it is a browser plugin whose host half is empty:

```yaml
- id: ui-account-aeven
  name: '@aeven/client-ui-account-aeven'
```

The browser half injects `slots`, `locale`, and `theme`, so a composition that omits any of them leaves the row waiting rather than mounted.

### What the menu offers

The avatar shows the reader's uploaded picture, or a generated gradient with their initial when they have set none. The menu carries a night-mode toggle and sign out. It links to the Aeven account page only when the deployment named a web client through `webUrl`: a harness that cannot name that page does not invent one, so the row is simply absent.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section covers how the menu is wired; observable behavior is covered in [Use this package](#use-this-package).

### Reading the reader without importing the gate

The authentication gate is statically linked into the boot kernel, which no plugin bundle can import. So the gate states the reader on the page as a global and this plugin reads it from there, the same way the Host states the Aeven endpoints. The plugin therefore holds no session logic and makes no Aeven call: signing out is a function the gate published alongside the reader.

### An empty host half

The feature exists only in the browser, but a browser-only row still has to be addressable from the host-owned Loader overlay. The node half is therefore an empty `apply`, and the `avn.client` manifest section carries the roster entry, its injects, and the `web` platform.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Empty host half keeping the browser-only row addressable |
| [`src/client/index.ts`](src/client/index.ts) | Reads the published reader, registers locales, and claims the header seat |
| [`src/client/AccountMenu.tsx`](src/client/AccountMenu.tsx) | The menu: account link, night mode, sign out |
| [`src/client/Avatar.tsx`](src/client/Avatar.tsx) | Uploaded picture, or the generated gradient and initial |
| [`src/client/locales.ts`](src/client/locales.ts) | The `account.aeven` locale namespace and its keys |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the menu alone is not enough: the surface that establishes the session, the authority that verifies it, and the slot system that seats the avatar.

- [avn-client-ui-auth-aeven](../ui-auth-aeven/README.md) — the sign-in surface that publishes the reader this menu shows.
- [avn-identity-user-aeven](../../identity/user-aeven/README.md) — the Host authority, and the `webUrl` that decides whether the account link appears.
- [avn-client-ui-slots](../ui-slots/README.md) — the slot map that gives the avatar its header seat.
- [client group map](../README.md) — the browser family this package belongs to.

-----

<a id="model-experience"></a>
## Model Experience

None, as the account menu is browser-side UI that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the menu, not a task backlog.

- **The account link needs a configured web client** — without `webUrl` the deployment cannot name an account page, so the menu offers none rather than guessing one.
- **The reader is read once from the page** — the menu reflects the session the gate restored at boot. A profile edited in the Aeven client during the same page life is not picked up until the next document load.
- **Aeven-shaped by design** — the row reads the Aeven reader global specifically, so a different authority would need its own account row rather than reusing this one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The row owns no durable state; the reader it draws is owned by the authentication gate, and locale and seat registration are covered by the package's own tests.
