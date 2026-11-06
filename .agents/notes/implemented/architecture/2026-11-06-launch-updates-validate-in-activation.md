# Agent Note: launch-time updates validate the serving Host, starting MCP servers stop at once, and the recent-memory scan runs beside the search

Status: implemented

English | [中文](2026-11-06-launch-updates-validate-in-activation.zh.md)

## Problem

Measurements on macOS arm64 Desktop 0.3.35-alpha, against an empty Aeven home:

- A Host booted in about 1.2 seconds with a warm compile cache and stopped in 2,079 ms in every run. The stop waited on the MCP SDK's stdio close: it ends stdin and waits 2 seconds before SIGTERM. A server that `npx` is still resolving does not read stdin, so a stop shortly after boot paid the full 2 seconds. Fully started servers exited within 0.6 seconds of end of input.
- A launch that installed an update booted the staged Host as a health check, stopped it, activated the profile, and booted the serving Host again: two boots and one 2-second stop on every update launch.
- In the 300 most recent session logs, turns with automatic memory recall waited a median 2.2 seconds (p90 5.2 seconds) between `turn/start` and the first model request; turns without recall waited 29 ms. Recall searched, then scanned up to 1,000 recent person traces, then ran the relevance judgment, one after another. The scan does not depend on the search.

## Decision

`@aeven/mcp-client` sends SIGTERM to a stdio server whose connection is still `connecting` when the plugin disposes, before the SDK's close. Such a server has no session to end. An established connection keeps the SDK's graceful close.

On macOS and Linux, a packaged launch that applies a release validates it by booting the serving Host from the final profile inside activation, the path a first macOS installation already used. A failed boot rejects the transaction, and activation's undo restores the rollback profile. Windows keeps the separate staged boot, which runs from `paths.work`, because a process left by a failed boot from the profile directory can hold that directory against the undo rename.

Turn-start recall starts the recent-person trace scan before the search. The search hits are removed from the scanned traces afterwards, so the candidates equal those of the serial order. The relevance judgment's log line records its duration.

## Alternatives considered

**Shorten the SDK grace for every server.** An established server that flushes state on end of input would lose that window.

**Skip or downsize the relevance judgment.** Its model round trip is most of the remaining recall latency, but it decides which memories the model reads; reducing it trades recall quality for latency.

## Consequences

The same Host stops in 73-121 ms with the change, and no MCP server or `npx` process remains. An update launch on macOS and Linux boots the Host once. Recall's remaining turn-start cost is the search and the judgment's model round trip.
