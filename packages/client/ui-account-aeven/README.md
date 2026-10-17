---
description: "The signed-in Aeven reader's avatar and account menu in the Web Client's resident navigation band: their picture or initial, app settings, and sign out."
kind: "package-reference"
---

# @aeven/client-ui-account-aeven

English | [中文](README.zh.md)

## Summary

`avn-client-ui-account-aeven` puts the signed-in reader's avatar in the Web Client's resident navigation band and opens their account menu from it, so a reader can see who they are signed in as and which plan they are on, reach their account page, and sign out. The band belongs to the conversation column rather than to a Session, so the avatar is there in the no-Session hero and beside a live Session alike: whether anyone is signed in is a fact about the app, and a fresh deployment opens on that hero. It shows whoever the Aeven authority already restored, and makes one call of its own: the plan the menu names, read from the account's subscription route as soon as the page draws a signed-in reader. With nobody signed in there is no reader to show and the seat stays empty. Enable it together with the Host authority; alone it renders nothing.

Account settings also owns the reader's picture: a photo control opens the picker and stores the file the reader picks, a delete control appears beside it once there is a picture and clears it so the avatar returns to the initial, and the picture itself opens the picker as well. Both go through the published reader, which republishes itself, so whoever draws the reader next shows the stored picture rather than the one the page booted with.

Account → Security provides a two-factor authentication switch. Enabling it opens QR-code enrollment and requires an authenticator code before activation; recovery codes appear once. Disabling requires an authenticator or unused recovery code. The switch reflects confirmed protection; cancelling or a refused code leaves it unchanged. Unavailable status disables the switch and offers a retry. These controls stay inside Account settings. The page calls these operations through the published reader’s authenticated `mfa` method.

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

Mount the row in a Web composition that also mounts an Aeven authority, and the column's navigation band grows an avatar that opens the account menu, with or without a Session open.

### When to choose it

Choose it whenever a deployment authenticates readers against Aeven and wants them to see and manage that session. Without an authority there is no reader, so the row renders nothing — enable and disable it together with `identity-user-aeven` rather than on its own.

### Minimal configuration

The row takes no configuration; it is a browser plugin whose host half is empty:

```yaml
- id: ui-account-aeven
  name: '@aeven/client-ui-account-aeven'
```

The browser half injects `slots` and `locale`, so a composition that omits either of them leaves the row waiting rather than mounted.

### What the menu offers

The avatar shows the reader's uploaded picture, or, when they have set none, the first letter of their display name (or of their email address when they have no name) on a black disc. Opening it states the reader and the plan the account is on: the plan is read from the account's subscription route as soon as the page draws a signed-in reader, so the panel names it in the frame it opens rather than a moment after, and the answer is kept for later openings. An open that still has no plan asks again. The picture and the name form one row that closes the menu and emits `settings/open` with `account`, so the reader lands on their own page. Below it, Settings emits `settings/open` for the settings shell's landing page and sign out ends the session. Theme selection lives in the Appearance setting, which also offers following the system.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section covers how the menu is wired; observable behavior is covered in [Use this package](#use-this-package).

### Reading the reader without importing the gate

The authentication gate is statically linked into the boot kernel, which no plugin bundle can import. So the gate states the reader on the page as a global and this plugin reads it from there, the same way the Host states the Aeven endpoints. The plugin therefore holds no session logic: signing out is a function the gate published alongside the reader, and the one Aeven call the menu makes is the plan read, through that reader's authenticated `cloud` method.

### An empty host half

The feature exists only in the browser, but a browser-only row still has to be addressable from the host-owned Loader overlay. The node half is therefore an empty `apply`, and the `avn.client` manifest section carries the roster entry, its injects, and the `web` platform.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Empty host half keeping the browser-only row addressable |
| [`src/client/index.ts`](src/client/index.ts) | Reads the published reader, registers locales, and claims the navigation-band seat |
| [`src/client/AccountMenu.tsx`](src/client/AccountMenu.tsx) | The menu: the reader and plan, their account page, settings, sign out |
| [`src/client/AccountSection.tsx`](src/client/AccountSection.tsx) | The Account page: the reader's picture, the plan, credits, usage, and security |
| [`src/client/Avatar.tsx`](src/client/Avatar.tsx) | Uploaded picture, or the initial on a black disc |
| [`src/client/locales.ts`](src/client/locales.ts) | The `account.aeven` locale namespace and its keys |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the menu alone is not enough: the surface that establishes the session, the authority that verifies it, and the slot system that seats the avatar.

- [avn-client-ui-auth-aeven](../ui-auth-aeven/README.md) — the sign-in surface that publishes the reader this menu shows.
- [avn-identity-user-aeven](../../identity/user-aeven/README.md) — the Host authority, and the `webUrl` that decides whether the account link appears.
- [avn-client-ui-slots](../ui-slots/README.md) — the slot map that gives the avatar its navigation-band seat.
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
- **The plan is read once per page** — the menu holds the plan it read when the page drew the reader, so a plan changed from the account page or in another client appears there after the next document load. A failed read costs the line for that page until an open asks again.
- **The resident avatar repaints on its next render** — the reader is stated on the page at boot and after each picture change, but it is not a subscription: the navigation-band avatar shows a new picture the next time it renders, which opening the menu or leaving settings does.
- **One square picture** — the API re-encodes an upload to a square WebP at its configured size, so a non-square picture is cropped rather than letterboxed and an animated one keeps its first frame.
- **Aeven-shaped by design** — the row reads the Aeven reader global specifically, so a different authority would need its own account row rather than reusing this one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The row owns no durable state; the reader it draws is owned by the authentication gate, and locale and seat registration are covered by the package's own tests.
