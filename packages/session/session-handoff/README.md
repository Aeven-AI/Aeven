---
description: "Service Definition for conversation handoff (`ctx.sessionHandoff`): typing into, approving, and taking over a conversation another device writes."
kind: "package-reference"
---

# @aeven/session-handoff

English | [中文](README.zh.md)

## Summary

The `ctx.sessionHandoff` Service Definition. A conversation of a synced account has one device writing it at a time, and every other device that holds a copy still takes the user's input for it: `forward` sends a prompt, an approval decision, or a cancel to the writing device, which applies it as its own input through `session-handoff/input`, and `publishLive`/`liveOf` carry that device's running state and queue to the rest. `catalog` lists the account's conversation metadata before bodies arrive, `fetch` downloads one on open, `runnerOf` names the writing device, `claim` makes this device the writer once no turn runs there, and taking it over publishes `session-handoff/released` on the device that stops writing. `@aeven/session-sync` provides it. See the [account sync group](../../sync/README.md).

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="model-experience"></a>
## Model Experience

None, as the handoff moves input between devices and adds nothing to a model request: a forwarded prompt becomes an ordinary `user/message` in the log of the device that writes the session.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Forwarded input waits for its writer** — input reaches the writing device when that device is online or directly linked on one local network; otherwise it waits in the account's inbox stream.
- **A claim needs a complete copy** — a device takes a session over only after importing every event its writer published, so a claim on a lagging copy answers `{ claimed: false }`.
- **Shared with the group** — the rest of account sync's limits are in the [group README](../../sync/README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The input vocabulary belongs to the Consumer that forwards and applies it; this Service Definition carries it unchanged as an operation name and a JSON request, so a new control (a steer, a tool answer) needs no change here.

</details>

**Runtime invariant:** No runtime invariant companion is published because the handoff state is the durable conversation itself, and the seam adds no second copy to compare.
