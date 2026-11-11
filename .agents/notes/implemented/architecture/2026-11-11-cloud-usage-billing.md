# Agent Note: hosted cloud work is metered and billed from the account's credit

Status: implemented

English | [中文](2026-11-11-cloud-usage-billing.zh.md)

## Problem

Aeven Cloud ran jailed commands, kept account folders and ran turns for any account at no charge. An account could buy one dollar of credit, then choose its own model key or a free provider, and keep using the hosted sandbox, its storage and cloud bots without paying for any of it. Only inference on Aeven models drew on credit.

## Decision

Cloud work is billed on top of inference, from the same credit: the plan allowance first, then the purchased balance.

- The Aeven API (Nodejs-Server #149) prices cloud work from a `cloud` section of `inference_config`, which operators edit like the plans and rate cards. The shipped prices are: $0.10 per sandbox CPU-hour, billed per second; $0.10 per GiB-month above 1 GiB of storage, charged daily; and $0.002 per turn on a provider whose inference it does not bill. Plan discounts are 0% on free, 20% on pro, 30% on heavy and 40% on superheavy, and stay below the margin over the measured OCI cost. Turns on Aeven models carry no cloud fee.
- `avn-sandbox-jail` reports each account's CPU time from its cgroup's `cpu.stat` as `sandbox-jail/usage` and asks `sandbox-jail/admit` before it confines a command. CPU time replaces wall-clock time because the account cgroup counts it exactly, including Python zygote runs moved into the group, and `confine()` never sees a command exit.
- `@aeven/cloud-meter` sends the sandbox, storage and turn reports to `POST /api/cloud/meter/charges` with the owner's `AEVEN_TOKEN`, under ids that make a resent report charge once. An account the API reports as unfunded starts no jailed command and no turn on an unbilled provider. The hosted bundle mounts it when `AVN_CLOUD_BILLING=1`, so it is turned on only after the API serves the meter.
- An unreachable API admits cloud work and keeps the reports queued, the same choice the inference gateway makes when Redis is unreachable.

## Alternatives considered

- **Bill sandbox time by wall clock** — `confine()` never sees a command exit, so wall-clock time cannot be measured per command, while the account cgroup's `cpu.stat` counts CPU time exactly, including Python zygote runs.
- **A separate cloud balance** — accounts would fund two balances, and the plan allowance could not cover cloud work; one credit charged in one order keeps a single number to top up.
- **Refuse cloud work while the API is unreachable** — an API outage would stop every hosted command and turn, including funded ones; admitting and queueing matches the inference gateway's choice when Redis is unreachable.
- **A flat monthly cloud fee.** Rejected: it charges light users for heavy users' compute and does not stop an account with no credit from running work.
- **Gate cloud work in the Host without reporting usage.** Rejected: it closes the free ride only for accounts at zero and leaves every funded account's cloud work unbilled.

## Consequences

Remote turns that run on the user's desktop are not cloud work and are not metered. Queued reports live in memory, so a Host restart loses at most one interval of CPU seconds.
