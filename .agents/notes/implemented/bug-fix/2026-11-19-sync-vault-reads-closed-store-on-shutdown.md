# Agent Note: the sync vault read its closed store during shutdown

Status: implemented

English | [中文](2026-11-19-sync-vault-reads-closed-store-on-shutdown.zh.md)

## Problem

Restarting the hosted Host on 2026-11-19 ended the old process with exit code 1. A status timer in `AccountVault` fired after the provider had closed the account's SQLite store and called `SyncStore.pending()`, which threw `The database connection is not open` from a timer callback and crashed the process during its stop. `dispose()` cleared the pending timer first, but its own `detach()` changed the state and `changed()` scheduled a new one while disposal waited for the apply, catch-up, maintenance, and outbox passes. The relay socket's close event and a late frame took the same path: `detach()` and `receiveFrame()` read `store.enabled()` after the provider closed the store.

## Decision

`AccountVault.dispose()` sets a `disposed` flag before anything else. While it is set, `changed()` schedules and sends no status report, `detach()` only drops the relay and connection, and `receiveFrame()` drops the frame unread; that frame stays on the relay after the stored cursor and arrives again on the next connection. The provider keeps its order: close the relay, close the local network, dispose the vault, close the store.

## Alternatives considered

- **Clear the timer again at the end of `dispose()`.** It would cover the timer but not the socket's close event or a late frame, which arrive whenever the network delivers them.
- **Close the store later in the provider.** The vault still has no bound on when the socket's close event arrives, so any order leaves a window.

## Consequences

Stopping the Host or quitting a desktop no longer crashes in `sync-yjs`, and systemd records a clean stop. No status change is reported once disposal starts, which matches the account being shut down. `packages/sync/sync-yjs/tests/vault.spec.ts` disposes an online vault, closes its store, then delivers a frame and closes the socket, and fails on any read of the closed store.
