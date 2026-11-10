# Agent Note: Bots run where their task can run

Status: implemented

English | [中文](2026-11-10-bot-placement.zh.md)

## Problem

A bot's definition syncs to every Host of its account, and the hosted Host is one of those Hosts. Any Host that held the definition's lease admitted its scheduled runs: `runsHere` answered true for every Host of a synced account and ignored `executionTarget`. The hosted Host could therefore take a bot that reads a folder on the user's computer and fail every run, and a laptop could take a bot that only reads mail and stop running it when the lid closed. Nothing in a definition said what its task needs, so no Host could decide otherwise, and the `/bots` page could not say where a bot runs.

## Decision

A definition carries what its task needs from the owner's own computer and the owner's choice, and every Host derives the placement from them with the same pure function ([`placement.ts`](../../../../packages/core/automations/src/placement.ts)).

- **Requirements.** `requires` lists device capabilities: `files`, `browser`, `computer-use`. `automation_create` requires the model to declare it, and the owner confirms it in the approval that already covers the task. Everything else a run uses (web search, connected accounts, files the run creates) exists on every Host and is not declared.
- **Owner's choice.** `runOn` is `auto` or `device`. The `/bots` page switches it for a bot that needs nothing from a computer.
- **Host profile.** The composing profile gives each Host `placement.kind` (`cloud` or `device`) and `placement.provides`. The web bundle is a `device` that provides all three capabilities; the hosted bundle is a `cloud` Host that provides none.
- **Derived placement.** No requirements and `runOn: auto` place a bot on the cloud Host. Any requirement, or `runOn: device`, places it on a device Host that provides every requirement. A definition without `requires`, stored before this change, runs on any Host as before. Cloud, device, and hybrid are results of this derivation; no definition stores one.
- **Enforcement.** `admit` refuses a scheduled, manual, or inbound run on a Host the placement excludes, and the scheduler does not claim the lease there.
- **Cloud first, device as fallback.** Every Host writes its profile to the `hosts` map of the account's synced `automations` document. A device Host admits a cloud-placed bot at once while that map names no cloud Host. Otherwise it waits `sync.fallbackDelayMs` (two minutes) and admits only when the definition's synced `lastAdmittedAt` shows that the cloud Host did not, then gives the lease up.
- **Manual cloud runs.** Run-now and retry requests target one registered cloud runner through the account document. The relay acknowledges the request before the client receives its queued run. Only that runner admits it, using the request id as the durable run id so reattaching sync cannot replay it. Execution snapshots return through the same document; deleting finished history leaves a request tombstone so a disconnected Host cannot restore it. Client shutdown does not cancel cloud work.
- **Page.** Each bot card shows a third fact, "Runs on", and the open card explains why and offers the `runOn` switch.

The `automations` domain stays at version 3: the two fields are optional or defaulted when a stored definition is read, so existing bots open unchanged.

## Alternatives considered

A stored bot type (`local`, `cloud`, `hybrid`) was rejected: it would need rewriting whenever the task or the account's Hosts change, and hybrid is a property of a run that uses two Hosts, not of a definition.

Letting the model choose where a bot runs was rejected. The model states what the task needs, which the owner can read and confirm; the Host decides, and a prompt cannot move a bot to a Host that lacks a capability.

Deriving `provides` from the tools mounted on a Host was rejected: several packages register those tools, some only after the user enables them, so the answer would change while the Host runs.

A heartbeat per Host was rejected for knowing whether the cloud Host is alive: it writes to every account's document every minute. The shared admission watermark already shows whether the cloud Host admitted an occurrence.

## Consequences

Placement trusts the declaration. A bot declared without `files` that reads a local file fails in the cloud, and nothing checks a run's tool calls against `requires`.

A bot that needs a computer does not start in the cloud, and the hosted page refuses to run it manually. A cloud run that uses a device's files is the next change on this path; see the [remaining phases](../../proposed/feature/2026-10-12-automations-next-phases.md).

An account whose cloud Host is registered but stopped gets scheduled cloud-placed bots two minutes late, from a device. Manual cloud requests wait for the addressed cloud Host rather than starting on the requesting device. A Host is never removed from the `hosts` map.

An older build rejects a definition that carries `requires` or `runOn`, so a device that has not updated stops receiving bots created or edited on an updated one.

The generated cordis API catalog was not regenerated in this change: `gen-cordis-api` stops at a type of the uncommitted sandbox work in the same checkout.

## Verification

The keyless automation suites cover cloud completion after requester shutdown, offline cloud requests, retries of interrupted local runs, admission deduplication after sync reattachment, shared-history removal, and device-only execution. Live desktop checks at 320, 496, and 900 CSS pixels confirm that the card keeps Runs on left-aligned on its own row at narrow widths and right-aligned alongside the other facts at wide widths, without horizontal page overflow.

In the dev desktop app, signed in to a synced account, the Host opened the existing version 3 `automations` domain. One message asked for two bots: the model declared `requires: []` for a daily web news brief and `requires: ["files"]` for a daily check of the Downloads folder, and both were created after approval. The `/bots` page showed "Runs on: Your computer" on both cards. The open news card read "This bot runs on your computer while Aeven is open there.", because no cloud Host has registered for the account, and its switch changed `runOn` to `device` and back with the text following. The Downloads card named "your files" as the reason and offered no switch. `pnpm run build` is green. A cloud Host running this change was not observed: the hosted deployment does not carry it yet, so cloud-first admission and the two-minute fallback are unverified on real Hosts.
