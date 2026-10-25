# Agent Note: Startup keeps authentication readiness

Status: implemented

English | [中文](2026-10-25-startup-keeps-authentication-readiness.zh.md)

## Problem

Optional MCP handshakes and eager debugger artifacts delay desktop startup. Skipping authentication readiness with persisted verification keys can admit requests before current signing keys arrive.

## Decision

Authentication retains its awaited initial key fetch. Optional desktop MCP rows activate without waiting; discovery publishes their tools later through the existing supervisor, which still owns reconnection and teardown. Fatal startup requires awaited discovery. Client source maps and single-plugin responses materialize on demand from immutable snapshots; prepared source caching distinguishes plugin ids sharing a buffer.

## Alternatives considered

**Persist verification keys and refresh after readiness.** A rotated key can reject a restored session while a retired key remains trusted. **Defer all startup work.** Mandatory identity and application dependencies must be ready before requests arrive.

## Consequences

Startup removes optional tool and debugger work from the critical path without changing token verification or sign-in transport. Tools may arrive after the first page loads. Focused lifecycle tests cover delayed discovery, disposal and invalid configuration; client tests cover loaders, immutable responses and source maps. Build and installed-app checks remain necessary for artifact delivery; timing alone does not establish successful sign-in.
