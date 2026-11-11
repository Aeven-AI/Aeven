---
description: "Hosted-Host metering of Aeven Cloud work: jailed CPU time, account storage and own-model turns reported to the Aeven API, and the gate that stops new cloud work once an account's credit is spent."
kind: "package-reference"
---

# @aeven/cloud-meter

English | [中文](README.zh.md)

## Summary

`@aeven/cloud-meter` bills the cloud work a hosted Host does for each account to that account's Aeven credit. It meters three things under the session owner, whose `AEVEN_TOKEN` pays:

- the CPU seconds of the account's jailed commands, from `sandbox-jail/usage`;
- the bytes of the account's folder, measured once a day;
- each turn on a provider whose inference the Aeven API does not bill.

It sends them to `POST /api/cloud/meter/charges`, where the Aeven API prices them from its `cloud` configuration, applies the plan discount and charges the plan allowance first, then the purchased balance. An account the API reports as unfunded starts no jailed command and no turn on an unbilled provider.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The `avn-hosted-app` bundle mounts it when `AVN_CLOUD_BILLING=1`, with `apiUrl` from `AEVEN_API_URL` and `accountsRoot` set to the jail's accounts folder. Turn the variable on once the Aeven API serves `/api/cloud/meter`; prices and discounts are edited there, not here.

### Configuration

| Field | Default | Effect |
| --- | --- | --- |
| `apiUrl` | required | Aeven API origin the reports and quotes go to. |
| `credentialRef` | `AEVEN_TOKEN` | Credential holding each owner's Aeven session. |
| `flushIntervalMs` | `60000` | Milliseconds between sends of the queued reports. |
| `quoteTtlMs` | `60000` | Milliseconds an owner's funding answer stays fresh. |
| `accountsRoot` | none | Directory whose children are account folders named by owner; omitted, storage is not metered. |
| `storageIntervalMs` | `86400000` | Milliseconds between storage measurements; the first runs one minute after start. |
| `billedProviders` | the `@aeven/llm-aeven` provider (`aeven-cloud`) | Providers whose turns the Aeven API bills as inference; turns on any other provider are metered. The default is read from `llm-aeven`'s own constant. |
| `maxQueuedPerOwner` | `10000` | Reports kept per owner while the API is unreachable; the oldest are dropped first. |

### What an unfunded account sees

A jailed command fails with `SANDBOX_UNAVAILABLE`, and a turn on an unbilled provider fails before its model request. Both carry the same message, telling the user to add credit or upgrade the plan. An unreachable API, or an owner without a token, admits the work, and the reports wait in the queue.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Reports and ids

CPU seconds add up per owner until the next send, which turns them into one `sandbox` report with a random id. A turn's id is `turn:<session id>:<turn>`, and a storage report names its UTC day; a day's report still waiting makes a later measurement of that day add nothing. A report keeps its id until the API accepts it, so a report resent after a failed request is charged once; the API's ledger is keyed on the account and that id, and on the day for storage. A `400` answer drops the batch, because resending it cannot succeed; any other failure keeps it.

### Funding

`GET /api/cloud/meter` answers `funded`, and so does every accepted send. The answer is cached per owner for `quoteTtlMs`. `sandbox-jail/admit` is synchronous, so it answers from the cached quote and refreshes a stale one for the next command; the `agent/request` listener awaits the quote before a turn's first request.

### Source map

| File | Role |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Plugin entry: config, the report queue, quotes, the jail and turn listeners, storage measurement |
| [`tests/cloud-meter.spec.ts`](tests/cloud-meter.spec.ts) | Reports, resends, the funding gate and storage against a scripted API and a stand-in `du` |
| — | No runtime invariant companion is published; the plugin keeps a send queue and a quote cache whose authority is the Aeven API's ledger, so no second local observation can contradict them. |

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Refusal of an unfunded account

#### What the model sees

The plugin registers no tool, schema, or prompt section. For an account the Aeven API reports as unfunded, a jailed command's tool result carries `SANDBOX_UNAVAILABLE` with this message, and a turn on an unbilled provider fails before its model request with the same text:

##### Refusal message

```markdown
This account's Aeven credit is used up, so Aeven Cloud cannot run this. Add credit or upgrade the plan in Settings, Account, to continue.
```

#### Token effect

None while the account is funded; a refused command adds this one sentence to its tool result.

#### KV Cache effect

Prefix-stable: the plugin changes no request content, and a refusal is appended as a tool result.

## Known Limitations and Deferred Work

- **Queued reports live in memory**: a Host restart loses at most one interval of CPU seconds and any reports the API had not accepted.
- **CPU time, not wall-clock**: a command that waits or sleeps costs nothing while it waits, and a command using both CPUs of its account's limit counts double.
- **Storage is measured with `du -sk`**, the disk space a folder takes: each account folder is walked once a day, which takes longer as folders grow.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
