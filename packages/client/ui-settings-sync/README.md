---
description: "Settings → Sync: this device's switch, protecting the account with a passkey, and the account's devices; and the passkey popup."
kind: "package-reference"
---

# @aeven/client-ui-settings-sync

English | [中文](README.zh.md)

## Summary

The Settings section over the `sync` Remote, refreshed by the forwarded `sync/status` event: this device's switch, the upload meter, the passkey switch, which turns protection on only after a confirmation that the user acknowledges the data cannot be recovered without a device or the passkey, and the passkey count, unlocking, and the account's devices. A `shell.overlay` popup offers protection after a sign-in on the page (the reader's `signedInThisPage`), asks for the passkey while this device is locked, and asks before syncing under a key the relay took back; it reads the status at most every two seconds. A passkey step opens its page in the system browser from the click. Copy lives in the `settings.sync` dictionaries (English, Chinese, Spanish). See the [account sync group](../../sync/README.md).

The upload counter and progress bar appear while uploads are pending. Download catch-up keeps the status at Syncing; an idle device shows Up to date without an empty counter. A muted status icon opens a standard menu with failure details and a retry action.

Conversation preparation shows the complete discovered backlog separately from upload batches. The status stays syncing while conversation preparation, queued uploads, or download catch-up remain. Device-list changes refresh the list independently of upload status, and overlapping notifications share one active read and one pending refresh. Forget device removes a list entry without revoking access.

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

**Runtime invariant:** No runtime invariant companion is published because a Client presentation package renders the injected sync snapshot and owns no runtime relation.
