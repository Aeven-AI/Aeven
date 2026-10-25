# Agent Note: The desktop release retries its runtime downloads

Status: implemented

English | [中文](2026-10-25-desktop-release-retries-runtime-downloads.zh.md)

## Problem

The `Release desktop` run for `v0.3.14-alpha` failed in `Build mac-x64`, in `prepare:runtime`, with `[TypeError: fetch failed]` wrapping `getaddrinfo ENOTFOUND nodejs.org`. The job had already installed dependencies and packed the native packages; the runner's name resolution stopped answering for a moment, which nothing in the build controls. `prepare-runtime.ts` fetched each archive exactly once, so that lapse discarded a finished macOS target and, because the release job needs every target, the whole release. The download also wrote straight to the path the cache is read from, so a transfer interrupted midway left a file later runs treated as a complete cached archive and rejected on checksum, failing every build after it.

## Decision

- **`downloadFile` retries the failures another attempt can clear.** One upstream file gets four attempts, waiting 2 seconds before the second and doubling to a 30-second cap. Each attempt carries a 5-minute `AbortSignal.timeout`, because a socket that stops answering never rejects and would otherwise hold the release job without ever reaching a retry. A client answer other than rate limiting throws `MissingUpstreamFileError` and fails at once: the upstream saying the file is not published at that address does not change.
- **Downloads land atomically.** Bytes are written to a sibling `.part` file and renamed into place, and the `.part` file is removed when an attempt fails, so the cache path only ever holds a complete transfer.
- **`verifiedArchive` re-fetches rather than trusting the cache.** A cached archive whose SHA-256 does not match its checksum line is deleted and fetched again before the build fails, and a checksum file that does not list the archive is fetched again once, because an interrupted download leaves a truncated checksum file behind.
- **The workflow caches the pinned archives per target.** `Release desktop` caches `apps/desktop/.desktop-build/downloads` under `desktop-runtime-<target>-<hash of prepare-runtime.ts>`, as the workflow already caches the pinned ffmpeg sources. The signed and unsigned variants of one macOS architecture share the key, so the signed build reuses what the unsigned build beside it fetched, and every cached archive is still verified against its checksum file before use.

## Alternatives considered

**Re-run the failed job and leave the script alone.** A re-run replays the same single-shot fetch, so the next DNS lapse costs another 40-minute macOS target and the release after it. The failure is rare per job but the release builds eight targets per tag.

**Retry the whole `Package` step.** Every step that precedes the fetch has already succeeded by then, so repeating the step re-installs dependencies and rebuilds the native packages to recover one 50 MB download.

**Treat every non-2xx answer, or every failure, as worth retrying.** An archive the upstream no longer publishes is reported the same way on all four attempts; failing on it at once keeps a wrong pin from spending the retry budget in a log that reads like a network fault.

**Vendor the Node.js and Cua Driver archives into the repository.** They total roughly 200 MB of third-party binaries across the six targets, and the checksum files they are verified against are upstream artefacts that would have to be vendored beside them.

## Consequences

- A DNS lapse, a reset connection, or a stalled socket costs seconds to minutes of retry instead of a rebuilt target, and the log names the attempt and the network fault it wrapped.
- A pinned archive that upstream stops publishing, and an archive whose bytes do not match its checksum, still fail the build, the second with the archive name and without retrying a mismatch that a retry cannot fix.
- The checksum re-fetch means a corrupted download cache repairs itself, so no release run needs a manual cache clear before it can start.
- The workflow cache saves one target's archives within a run and across re-runs of the same tag; it does not carry from one tag to the next, because GitHub scopes caches saved on a tag ref to that ref.
