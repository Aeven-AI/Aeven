---
description: "Syncthing Service Provider for file sync: one supervised Syncthing process configured through its loopback REST API."
kind: "package-reference"
---

# @aeven/file-sync-syncthing

English | [中文](README.zh.md)

## Summary

The `ctx.fileSync` provider. It runs one Syncthing process per Host through the subprocess capability, with its home under `$AVN_HOME/file-sync/syncthing`, a REST listener on a free loopback port, and a random API key; usage reporting, crash reporting, and automatic upgrades are off, and it runs at low priority. Every shared folder is a send-and-receive folder shared with this device and its account's listed peers, or the subset its `peers` names, with staggered versioning, the configured ignore patterns (by default `.git` and dependency and build directories), a one-second watcher delay, and no pull delay. Devices and folders a previous run configured that no current account lists are removed at start, so a device taken off the account while the Host was stopped is not trusted again. A process that exits unexpectedly restarts with backoff. Configuration: `binary`, `home`, `listenAddresses`, `discoveryServers`, `localDiscovery`, `relays`, `watcherDelayS`, `pullerDelayS`, `rescanIntervalS`, `versionRetentionDays`, `ignores`, and the process budgets.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="model-experience"></a>
## Model Experience

None, as file sync moves files between devices and adds nothing to model requests.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Shared with the group** — the limits of file sync are listed once in the [group README](../README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No runtime invariant companion is published because Syncthing's own configuration is the only copy of the folders and devices the provider writes.
