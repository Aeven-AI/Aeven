# Agent Note: The Host's console carries only what the Host wrote

Status: implemented

English | [中文](2026-08-29-host-console-is-the-hosts.zh.md)

## Problem

`avn web` printed eight lines before its own first line. None of them were the Host's:

```
npm warn Unknown env config "manage-package-manager-versions". ...
(node:38214) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
chrome-devtools-mcp exposes content of the browser instance to the MCP clients ...
[chrome-devtools-mcp] The connecting client did not negotiate the MCP roots capability. ...
avn web: http://127.0.0.1:3080/?token=...
```

Two independent sources produced them.

**A stdio MCP server's stderr was inherited.** The SDK spawns with `stdio: ['pipe', 'pipe', params.stderr ?? 'inherit']`, and `createTransport` passed no `stderr`, so every configured server wrote onto the Host's file descriptor. The banner is the server's own; the `npm warn` line is from the `npx` that execs it, which is why it appeared with no `npx` in sight. Output the Host neither authored nor formatted arrived interleaved with output it did, and a server that is merely chatty was indistinguishable from one reporting a fault.

**Reading `localStorage` to test for it is what announced it.** `attachPersistence` guarded with `typeof localStorage === 'undefined'`, on a comment stating that non-browser runs have no such global. Node has one: an accessor that warns when Web Storage is off and then answers `undefined`. The guard reached the right decision and printed a Node warning on the way to it, once per Host boot.

## Decision

**Stdio servers are spawned with `stderr: 'pipe'`, and each complete line is logged at debug level under the server's label.** The lines are diagnostics about a subprocess, which is what the logger is for; the console belongs to the Host. `forwardDiagnostics` buffers a chunk that ends mid-line until the newline completes it, so one line is never split across two entries, and flushes a last line the server wrote without a trailing newline.

**A runtime is asked what storage it has before the global is read.** `webStorage()` answers from `window` in a browser, and on a Host reads only an own data property — which is what a test installs through `vi.stubGlobal` — so Node's accessor is never invoked. A descriptor read does not run a getter, which is what makes the check silent.

## Testing

`avn web --no-open --port 3199` now prints one line, its own. The forwarding is covered twice: through a real spawned process whose stderr carries a blank line and an unterminated last line, and through the plugin lifecycle, where a server's line is asserted to reach `ctx.logger.debug` under its label and a mid-line chunk is asserted not to appear until it is complete. The store's browser arm is covered by a stubbed `window`, its Host arm by the existing suite, which runs without one.

The SDK stand-ins in `apply.spec.ts` and `reconnect.spec.ts` now expose a readable `stderr`, as the transport they stand in for does under `stderr: 'pipe'`.

## Alternatives considered

**Log the server's stderr at warn or info.** Rejected: most of it is a greeting. Reporting a banner as a warning trains a reader to skip the level that a real fault would arrive on, and the connection path already reports failures with their own message.

**Pass `--no-webstorage` in the `avn` bin script.** Rejected: it silences the symptom for one launcher, leaving the same warning for every other entry point and for anything embedding the client tree, and the flag is not available across the whole supported engines range.

**Drop persistence whenever `window` is absent.** Rejected as measured: the store's own suite runs on Node and installs Web Storage through `vi.stubGlobal`, so a `window` test alone disables the persistence those cases exist to check.

## Consequences

An MCP server's stderr is no longer visible by default. It is one `debug` level away, under the server's own label, which is more than it had when it was interleaved with unrelated output and attributed to nothing.

The store persists in a browser and wherever Web Storage is installed as an own property, and nowhere else. A Host that one day runs with `--localstorage-file` would still not persist through it; no consumer has asked, and the client store's durable state belongs to the session log rather than to the Host's disk.
