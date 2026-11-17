# Agent Note: Desktop startup payload, idle sync status traffic, and the Host abort at quit

Status: implemented

English | [中文](2026-11-17-desktop-startup-payload-and-quit-crash.zh.md)

## Problem

DevTools metrics from the 0.3.57-alpha desktop app showed three defects. The startup `session/list` response for a home with 1,289 sessions was 4.3 MB, and 2.5 MB of it was two projection values, `fileIntake` (upload limits and the accepted extension list) and `imageLimits`, repeated identically in every row; the chat waits for that response before drawing. While the app was idle, the Host pushed `sync/status` often enough that the sign-in popup re-read the status every two seconds, although the status itself had not changed. Every quit of the Desktop Host, and of a Host run from source, ended in `SIGABRT` with a macOS crash report: the onnxruntime-node binding that MemOS embeddings load aborts in its environment destructor during `exit()` (microsoft/onnxruntime#24579).

## Decision

- **List rows omit Session-independent projections** (`avn-api-session-controller`): `list()`, the `api-session/added` summary, and imported-session summaries drop `imageLimits` and `fileIntake`. Both units are registered in `list.ts` with null state and a view that reads Host configuration, so every Session carries the same value. The client treats list projections as a partial baseline, and the history snapshot that opens a Session carries its complete projection set, so no consumer loses a value. Session-dependent values such as `turnOutline`, `sessionStats`, and `todos` stay in the row for the reason the [DSH improvements note](../feature/2026-11-17-dsh-improvements.md) records.
- **`sync/status` fires only on a changed status** (`avn-sync-yjs`): the vault reports every possible status change, including a frame queued and acknowledged within one `statusMs` window. The provider serializes the account status at each report and notifies listeners only when it differs from the status it last published for that account.
- **Only Intel macOS seeds pin onnxruntime-node 1.23.2** (`apps/desktop`): `desktopDependencyOverrides(target)` substitutes 1.23.2, the newest release with a darwin/x64 binding, only for a darwin-x64 profile. Every other target installs the release Transformers.js pins (1.24.3), which contains the exit fix (microsoft/onnxruntime#26445) and ships binaries for darwin-arm64, Linux, and Windows; its darwin-arm64 build requires macOS 14, the app's existing floor. Seed preparation passes the release target, and the installed Desktop verifies its profile against its own platform. The seed store pruner carries one rule per release, each active only on the targets that install it.

## Alternatives considered

**One startup read per Client cache.** Settings, model catalog, plugin inventory, credentials, and subagent reads run twice at startup: once when the plugin mounts and once on the first `connection/reset`. The second read covers a change made between the first read and the moment the event socket subscribes, and the six reads together cost a few milliseconds on loopback without delaying the first paint. Gating each eager read on an established connection would move every plugin's first data behind the socket handshake. Not taken.

**Gzip on the Desktop webserver.** The webserver supports `compression: 'gzip'`, and gzip shrinks a session list about twentyfold for about 2 ms of CPU. On loopback the transfer it saves is already a few milliseconds; the list's 200–280 ms is spent building and serializing the response. Deployments that serve remote browsers directly can enable it in their configuration. Not changed.

**Upgrading the root workspace's onnxruntime-node.** The repository lockfile is shared by every development machine, including the `macos-15-intel` runner that builds the Intel desktop, and pnpm cannot select a version per architecture. The root override stays at 1.23.2, so a Host run from source still aborts at quit.

**Releasing the embedding pipeline at shutdown.** The abort comes from destruction order of static objects inside the 1.23.2 binding, not from open sessions, so releasing sessions before `exit()` does not remove it.

## Consequences

The startup list shrinks by the two repeated values, about 58% for the measured home, and so does the Host's serialization work. A Session opened from the sidebar receives its upload limits with the history snapshot rather than with the list; the composer's file pre-check is unavailable until that snapshot arrives, as it already was for a Session opened before the list loaded. Status listeners, including the sign-in popup and the Host plugins that attach on each status event, no longer wake on reports that change nothing. Desktop builds for every target except Intel macOS exit without a crash report; Intel macOS builds and Hosts run from source keep the abort until onnxruntime publishes a darwin/x64 binding with the fix.
