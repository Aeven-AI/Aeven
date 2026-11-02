---
description: "Vault cryptography for account sync: the account key, opaque document ids, and AES-256-GCM envelopes."
kind: "package-reference"
---

# @aeven/sync-vault

English | [中文](README.zh.md)

## Summary

A library on `node:crypto` built-ins: 32-byte account keys, HKDF-derived content keys per document or stream id, opaque HMAC ids for logical names, AES-256-GCM envelopes whose plaintext header is the associated data, and the key proof devices exchange when they link on a local network. It holds no state. See the [account sync group](../README.md).

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

**Runtime invariant:** No runtime invariant companion is published because envelope authentication and opaque-id derivation are checked over its bytes in package tests, and nothing publishes a divergent in-process pair.
