# Agent Note: session sync reads the workspace registry at each use and files every unfiled conversation

Status: implemented

English | [中文](2026-11-06-session-sync-reads-the-registry-at-use.zh.md)

## Problem

On the hosted Host, a desktop conversation stayed out of every workspace, and a conversation started on the web was published with no workspace, so the desktop could not file it either. `SessionMirror` received `ctx.get('workspaceRegistry')` and `ctx.get('attachments')` once, when the account's mirror started. A mirror that starts before the registry is provided, as a Host that keeps every account connected does, files nothing and publishes no workspace for as long as it runs; a registry replaced later leaves it answering from the old instance.

Filing also ran only over conversations whose copy here was behind the index and that no device was running. A conversation that ran on another device while its copy here kept up was never behind afterwards, so it was never filed.

## Decision

- `SessionMirror` takes the registry and the attachment store as readers (`() => ctx.get(...)`) and reads them at each use; late-filing observation moves to the current registry at each import pass.
- Every import pass files every unfiled conversation the account owns, whether or not its copy here is behind or another device runs it.

## Alternatives considered

Start each mirror only once the registry exists. Rejected: the registry is optional, and a registry replaced while the mirror runs would still leave a stale instance.

## Consequences

The desktop app takes the same paths; a conversation that ran elsewhere while this device kept up is now filed there too.
