# Agent Note: Eager Render-Family Loading Outside Sign-In

Status: implemented

English | [中文](2026-09-07-eager-render-family-loading.zh.md)

## Problem

The Web shell statically reached UI primitives, KaTeX, highlight.js, and the mdast pipeline. Under a slow connection those payloads occupied the shell's dependency graph and delayed authentication even though the sign-in screen does not render markdown. Application-batch preload hints also competed at the default priority, while authentication was discovered through a later dynamic import.

Moving UI primitives behind an eager dynamic import introduced an additional requirement: `ClientModuleSystem` snapshots `staticModules` into its seed map during construction. Adding UI primitives to the caller's object after construction leaves signed-in plugin factories without that platform module and causes a runtime `require()` miss.

## Decision

Authentication code and styles are explicit initial shell chunks. The shell starts the UI-primitives dynamic import at module evaluation, which immediately discovers its KaTeX, highlight.js, and mdast dependencies, but the authentication gate does not await that request. Application fonts also begin loading immediately; only full application mounting waits for them.

An authenticated boot awaits UI primitives and adds the resolved module to `staticModules` before calling `window.__ModuleLoader__.create()`. Plugin prefetch begins only after this complete table has been snapshotted. An unauthenticated boot mounts sign-in and returns while the rendering-family request continues in parallel.

Rollup uses `onlyExplicitManualChunks` with explicit `auth`, `react`, `primitives`, `katex`, `hljs`, and `mdast` assignments. This preserves named cache families without pulling a manually named async chunk's dependency closure back onto the shell execution path. Host application-batch hints remain eager, appear after the shell's own head assets, and use low fetch priority so they do not delay the authentication resources.

## Verification

The client boot test requires UI primitives in `staticModules` at module-system construction, then evaluates an application batch through the real client module system. The built-artifact test requires a dynamic primitives import in the entry, named render-family chunks in `dist/assets`, and no HTML modulepreload for primitives, KaTeX, highlight.js, or mdast. Injection tests require application preloads after the shell module and with low fetch priority. An authenticated browser reload must reach the application without a loader-entry or module-table failure.

## Alternatives considered

**Create the module system before authentication and mutate the input table later.** The system owns a snapshot map, so later mutation cannot update plugin `require()` resolution.

**Await the render family before authentication.** This restores the slow-connection delay that the split removes.

**Remove application plugin preloads.** The plugins are needed immediately after authentication. Low-priority eager hints preserve early transfer without allowing those large requests to outrank sign-in.

## Consequences

Sign-in can render as soon as its shell, React, authentication chunk, and session request are ready. Rendering libraries and application bundles start promptly but do not block that surface. Signed-in startup still waits for the complete platform seed before any plugin factory executes, preserving synchronous shared-module identity.
