# Agent Note: the desktop Host skips unchanged memory shards, runs browser MCP servers without npx, and loads motion and mail libraries on first use

Status: implemented

English | [中文](2026-11-13-host-memory-footprint.zh.md)

## Problem

The desktop app's process tree used about 2.6–2.8 GB, roughly twice Claude Desktop's 1.2 GB, while its Electron processes used less than Claude's. The difference came from the Host and its children:

- Each start, `MemorySyncMirror.start()` queued every stored document, and each one replayed its full update history into a `Y.Doc` and compared every row with SQLite. On one account (3,034 documents, 79,103 stored updates, 484 MB) the Host heap rose from 215 MB to 681 MB in the first minute and its footprint reached 1–1.1 GB; macOS kept most of those pages after the heap shrank, leaving the footprint at 525 MB.
- `chrome-devtools-mcp` and `@playwright/mcp` started through `npx -y`. Each `npm exec` process stayed resident as the server's parent at about 180 MB, 367 MB for both, and fetched the package on first use.
- `@hyperframes/*` (with its font tooling, Babel and recast), `imapflow`, `nodemailer` and `mailparser` loaded at Host start through static imports, although most Hosts never render a film or connect a mail account.

## Decision

- `Sync.storedDocuments(owner)` returns each document's version, and `Sync.documentVersion(owner, id)` reads one. The Yjs provider's version is the store's device id and the document's newest `doc_updates.seq`; the column is `AUTOINCREMENT`, and a compaction inserts its merged update as a new row, so every change to the stored state yields a version never used before in that store, and a recreated store yields another device id.
- `MemorySyncMirror` records, in its own `sync_state`, a stamp per applied shard: the version read before opening the document, this device's embedding model, and the table's local columns. `start()` queues only shards whose current stamp differs, so a model switch or a MemOS schema change still applies every shard again. Republishing clears the stamps. Publishing records none, so the shards this device wrote are applied once more at the next start.
- `@aeven/web-app/node-mcp` resolves a server's `bin` entry from the bundle's own dependencies and starts `@aeven/mcp-client` with `process.execPath`. Both browser servers are exact dependencies of `@aeven/web-app` at the versions `npx` pinned.
- Motion and mail modules import those libraries with `await import()` at their first call.

## Alternatives considered

- **Merge each Google and Microsoft connector into one server per provider.** Rejected: each connector is its own consent with its own token and tool namespace, so merging needs a combined consent and renames model-visible tools. Connector children already stop after `connectorIdleMs`.
- **Unload the Whisper worker when idle.** Rejected: a cold worker compiles its Metal kernels for tens of seconds before the first transcription.
- **Start the browser MCP servers on first use.** Deferred: their tools must be in the tool index before a model can call them.
- **Lower `compactAfter`.** Not needed for the start cost once unchanged shards are skipped; it trades background CPU for store size.

## Consequences

The first start after this change applies every shard once and records its stamp; later starts open only shards that changed. A stamp is only ever a reason to skip a shard whose state, model and columns all match the recorded ones, so a mismatch costs one extra apply and never skips a change.
