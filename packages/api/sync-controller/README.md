---
description: "The `sync` Remote: the signed-in user's account sync status, this device's switch, the passkey step that protects or unlocks the account, and the account's devices."
kind: "package-reference"
---

# @aeven/api-sync-controller

English | [中文](README.zh.md)

## Summary

A Typert Remote over `ctx.sync` that acts only for the caller of the running request. `startPasskey` returns the `/passkey/vault` page on `siteUrl` and collects the sealed result in the background for up to `passkeyMs`, polling every `passkeyPollMs`; the step shows in `status` until it succeeds and emits `sync/status` when it ends. `unprotect` hands the key back to the relay and `acceptServerKey` confirms a key the relay took back. See the [account sync group](../../sync/README.md).

Status includes conversation publication progress collected through `sync/progress`, pending and queued relay-frame counts, download catch-up, and upload or download failures.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="model-experience"></a>
## Model Experience

None, as account sync moves stored data between devices and adds nothing to model requests. Imported conversations and memory reach a model only through the packages that already own them.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Shared with the group** — the limits of account sync are listed once in the [group README](../../sync/README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No runtime invariant companion is published because this Remote forwards each call to `ctx.sync` and derives no state of its own.
