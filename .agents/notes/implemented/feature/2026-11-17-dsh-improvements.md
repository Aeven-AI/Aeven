# Agent Note: DSH improvements from dsh-v0.2.1-rc.3 to dsh-v0.2.2-rc.3, adapted to Aeven

Status: implemented

English | [中文](2026-11-17-dsh-improvements.zh.md)

## Problem

The DeepSeek Harness releases dsh-v0.2.1-rc.3 through dsh-v0.2.2-rc.3 also shipped performance and feature work for packages Aeven shares with it. Aeven streams every chat on chat.aeven.io and phones over one uncompressed WebSocket, re-downloads every file-backed chat image on each display, spends a model call reading the output of each finished background job, and runs read-only search and listing tools one at a time. Aeven's account sync and multi-device input have diverged from DSH, so each change had to keep sessions, prompts, and attachments that move between devices and builds working.

## Decision

- **WebSocket compression** (`avn-api-gateway`): the Remote stream mux negotiates `permessage-deflate` (zlib level 1) by default, configurable as `websocketCompression: 'none' | 'deflate'`, and compresses only frames whose JSON text reaches 1,024 characters. A peer that offers no extension gets today's uncompressed connection. DSH also lowers the receive limit to `max(streamInboxBytes, 1 MiB)`; Aeven keeps the `ws` default limit, which `ws` applies to the inflated size as well, because Aeven's mux has no uplink inbox and a lower limit could close a connection that carries a large payload today.
- **File revalidation** (`avn-api-session-controller`): `/api/file` responses carry the file version as `ETag` with `Cache-Control: private, no-cache`, and a matching `If-None-Match` gets an empty 304 after one `stat`. DSH instead redirects to a versioned URL cached as `immutable` for a year; that needs the desktop `avn-app:` protocol handler to follow redirects and would keep bytes readable after the 12-hour account cookie of a signed-out browser has expired, so Aeven revalidates every load through authentication.
- **Job output in completion notices** (`avn-tool-jobs`): a completion notice carries the job's unread output when the complete notice fits `inlineOutputBytes` (default 2048) and the producer's `outputLimitBytes`; otherwise it keeps pointing at `job_output`. The notice names a multi-line label by its first line. A `job_output` call while the notice is still pending returns the held output and withdraws the notice. Aeven already ends a `job_output` wait when the user sends a message, so DSH's steer-ends-wait change was not needed.
- **Parallel-safe read-only tools**: `glob`, `grep`, `job_list`, `cordis_inspect_list`, `cordis_inspect_query`, and `list_agents` declare `isConcurrencySafe`, so sibling calls in one step overlap. Aeven's `schedule_list` runs inside a schedule transaction and signals a durable change, so it stays exclusive.
- **Glob pruning** (`avn-tool-fs-search`): a pattern that starts with literal directory names adds ripgrep directory-only globs, so traversal skips unrelated subtrees; patterns with wildcards in a directory segment, `.`/`..`, VCS names, or an explicit `path` are unchanged.
- **Per-side image limit** (`avn-attachment-local`): `maxImageDimension` defaults to 65,535 pixels, so a panorama is bounded by the 64-million-pixel limit rather than an 8,192-pixel side. DSH also raised the per-image byte limit to 50 MiB; Aeven keeps 20 MiB so uploads through the relay and attachments synced between devices do not grow. Stored images keep their normalized long edge of at most 8,192 pixels, so older builds read them unchanged.
- **Request history copies** (`avn-llm`): stripping another adapter's replay state keeps the request and message identities when nothing changes and resolves the caller's adapters at most once per request instead of once per assistant message.

## Alternatives considered

**Session-list rows without `turnOutline`, `sessionStats`, and `todos`** (DSH 92f9e79fac) — the client copies a list row's projection values into that session's local projection store when the Host or another device adds the session, so removing them would leave unopened sessions with stale values until opened. Not taken; the list stays as it is.

**DSH's composer, Search API, MCP manager, and other UI features** — the composer changes need a design decision first, Aeven's web search does not use the DeepSeek Search API, and Aeven's connectors live server-side. Not taken in this change.

## Consequences

Large stream frames cost a little Host CPU for zlib. File-backed images cost one revalidation round trip per display instead of a full download. A job notice that carries its output adds those bytes to the conversation in place of a later `job_output` result. A `job_output` call after the inline notice was delivered returns `(no new output)`.
