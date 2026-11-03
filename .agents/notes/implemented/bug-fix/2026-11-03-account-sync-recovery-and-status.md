# Agent Note: Account sync recovery and truthful status

Status: implemented

English | [中文](2026-11-03-account-sync-recovery-and-status.zh.md)

## Problem

A relay refusal can leave a durable upload queued on an open connection without another publication attempt. A new device can also appear up to date before it has applied the relay history, because outgoing counters do not measure downloads. Reading the device list once per connected period misses devices that join later.

## Decision

The vault retains unacknowledged uploads. A transient `server-error` or closed connection ends the publication connection so the provider's configured reconnect loop resumes it. Other refusals remain queued and expose an upload failure; the user can retry through the existing enable operation, which reconnects a failed vault. A failed catch-up closes its connection and resumes from the durable cursor.

`catchingUp` covers both the relay catch-up and received frames being applied. Transfer failures remain visible until that transfer succeeds. Settings uses a muted icon and the existing Menu primitive for details and retry; download catch-up keeps the status at Syncing, and idle status omits an empty counter. Forget device states that removing a list entry preserves its access.

`sync/devices` reports local device-list edits and remote changes to that document. The Remote forwards device and status notifications only to the owning account. Settings coalesces device notifications into one active read and a pending refresh, independently of upload progress. The store reuses prepared upload statements, and inbound batches append to per-document arrays without repeatedly copying their accumulated updates.

## Alternatives considered

**Retry every refusal immediately:** a permanently rejected frame would cause a tight request loop. The existing reconnect delay bounds transient recovery, while other refusals wait for another attempt and retain the data.

**Refresh devices on every status notification:** upload progress can emit several times per second without any device-list change. A separate notification avoids repeated document reads and still observes devices joining during an open settings page.

**Treat online as up to date:** connection availability does not establish that incoming history has been applied. Download work remains an independent status fact.

## Consequences

The provider needs no additional retry timer or configuration. Permanently refused frames remain queued and can block later publication; the popup exposes the failure without deleting data. Device removal remains list management rather than access revocation, as defined by the [account sync design](../../proposed/architecture/2026-10-27-account-sync-network.md#what-ships-today).

Focused provider, vault, Remote, and Client tests cover saved-upload recovery without another edit, refused catch-up, download status, account-scoped notifications, device refresh coalescing, and the failure popup. Owner-local Client snapshots pin English, Chinese, and Spanish download and idle copy; Settings has no recorded-session input. Physical two-device and deployed-relay verification remain separate from these local fixtures.
