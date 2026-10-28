---
description: "Account sync Consumer for settings: every namespace that declares the account reach is the same on every device of the account."
kind: "package-reference"
---

# @aeven/settings-sync

English | [中文](README.zh.md)

## Summary

Mirrors the account namespaces of each account that `ctx.sync` serves: every namespace registered with `reach: 'account'` — theme, language, default model — lives in the `settings/account` document, and each device applies a section another device changed through `ctx.settings.replace`. An empty document is seeded from this device; otherwise the account's stored settings win over this device's, and a namespace that keeps the device reach (ports, paths, provider keys, device support) never leaves the device. See the [account sync group](../../sync/README.md).

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="model-experience"></a>
## Model Experience

Indirectly, through a namespace another device changed, which reaches a later request as the packages owning that setting render it; this package registers no prompt, schema, or result of its own.

#### KV Cache effect

None of its own; a changed namespace reaches a request the way a local settings edit does.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Merged per namespace** — a whole section is replaced when it changes, so two devices editing the same namespace at once keep the later section rather than merging fields within it.
- **The device's section is lost on first contact** — a device that joins an account whose settings document already holds a namespace adopts the account's section.
- **Shared with the group** — the rest of account sync's limits are in the [group README](../../sync/README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The reach declaration lives in `@aeven/settings`; this package reads `describe()` and never keeps its own list of namespaces, so a new account-scoped setting syncs without a change here.

</details>
