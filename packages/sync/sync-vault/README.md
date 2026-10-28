---
description: "Vault cryptography for account sync: device keys, key epochs, encrypted and signed envelopes, key wrapping, the device chain, and the approval code."
kind: "package-reference"
---

# @aeven/sync-vault

English | [中文](README.zh.md)

## Summary

A library on `node:crypto` built-ins: Ed25519 and X25519 device keys, vault key epochs, opaque HMAC ids for document names, AES-256-GCM envelopes signed by the sending device, keyring wrapping for a device or a passkey PRF result, the hash-linked device chain that every device verifies, and the commit-then-reveal six-digit approval code. It holds no state. See the [account sync group](../README.md).

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

- **Shared with the group** — the limits of account sync are listed once in the [group README](../README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
