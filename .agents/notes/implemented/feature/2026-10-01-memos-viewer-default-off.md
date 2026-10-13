# Agent Note: The MemOS Viewer is off unless a composition asks for it

Status: implemented

English | [中文](2026-10-01-memos-viewer-default-off.zh.md)

## Problem

`@aeven/memory-memos` serves the MemOS Viewer — a read/write HTTP surface over **every** owner's stored memory with no sign-in — whenever `viewer` is true, and `viewer` defaulted to `true`. The shipped `avn-web-app` bundle had already opted out (`viewer: false`, with a comment saying why), so no shipped composition exposed it. The default mattered anyway: any other composition that mounted the provider without naming `viewer` — a user's own profile patch, a future bundle, the desktop packaging when it gains a memory row — would have started an unauthenticated surface over all accounts, and nothing in the configuration said so.

`viewerHost` already refused a non-loopback address, so the exposure was local-only. Local is not the same as safe: any process on the machine, and any page that can reach `127.0.0.1`, can read and write the whole memory store through it.

## Decision

`viewer` defaults to `false`: a composition opts into the Viewer rather than inheriting it. `avn-web-app` keeps its explicit `viewer: false`, so no shipped profile changes behaviour. The startup line becomes a warning — ``viewer live at <url> — it serves every owner's memory without sign-in`` — so an operator who did turn it on sees what is answering in the log rather than an info line that reads like any other readiness message.

`packages/memory/memory-memos/tests/viewer-default.spec.ts` pins all three facts: the default is off, an explicit `true` still starts it, and the bind address stays loopback unless a composition names another one.

## Alternatives considered

- **Leave the default on and rely on each composition to opt out.** That is the arrangement that made the shipped bundle carry a security comment; a default that must be remembered in every future composition is a default that gets forgotten.
- **Remove the Viewer.** It is the upstream engine's own inspection surface and the only way to read stored memory without going through the harness; removing it would make a supported engine feature unreachable rather than making it opt-in.
- **Keep the startup line at info level.** Misconfiguration should be visible; enabling a surface with no sign-in is exactly the case where a warning earns its place.
- **Require a token on the Viewer.** It is upstream's surface and its own routes are not ours to authenticate; opting in is the honest boundary.

## Consequences

A deployment that wants the Viewer must now write `viewer: true`, and while it runs the log says what it exposes. Nothing shipped changes: the only composition mounting the provider already had it off.

The remaining exposure is inherent to the engine feature: when it is on, it answers without identity, which is why it is off by default and warned about when it is not.

## Verification

`pnpm exec vitest run packages/memory/memory-memos` passes 9 tests across 2 files, including the three new default-and-bind cases, and `npx tsc -b packages/memory/memory-memos` reports no errors. On a running Host, `lsof -nP -iTCP:18801 -sTCP:LISTEN` shows no listener, and the only composition that mounts the provider (`packages/bundle/web-app/cordis.patch.yml`) sets `viewer: false`.
