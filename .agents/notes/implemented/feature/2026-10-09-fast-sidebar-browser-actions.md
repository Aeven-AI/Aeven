# Agent Note: Fast actions in the selected sidebar browser

Status: implemented

English | [中文](2026-10-09-fast-sidebar-browser-actions.zh.md)

## Problem

The LinkedIn weekend-post session spent multiple model steps on clipboard paste, localhost fetch, native file selection, and caption repair. The saved session records 19 evaluations taking about 14 seconds in total, while the corresponding step-to-tool intervals total about 246 seconds. Browser action duration alone therefore cannot explain the delay. Character-by-character typing and animation waits add avoidable latency, cancellation stops at the Electron IPC hop, and resetting the pointer's idle clock on each frame prevents its intended wobble.

## Decision

Keep an explicitly selected Electron sidebar for the task, then use external Chrome/CDP when the sidebar cannot perform the required operation. Headless browsing follows the visible surfaces. The browser context, fetch guidance, and shipped in-app-browser skill state that order. The Aeven preset exposes preview tools eagerly so a clean install does not require discovery before ordinary browser actions.

`preview_upload` accepts absolute local paths and either one file input or an Upload-button selector. Button uploads install a chooser listener before clicking, intercept the native dialog, fill its backend node, and release interception within the same action. Ambiguous inputs, multiple files in a single-file input, embedded-frame choosers, and destination-origin changes fail. Remote uploads use the existing approval service with an origin-and-path scope; localhost is exempt. Read-only access denies uploads and action sequences.

`preview_sequence` executes 1–20 validated click, type, press, upload, or condition-based wait actions in order. It stops at the first error and returns the completed count and failed action index. Upload approval precedes sequence execution. Whole-text insertion uses the guest's native insertText with focus checks, preserving the application's composer. Pointer movement and address-bar presentation run independently of native actions.

Each Electron request carries its id, deadline, and cancellation signal through the preload. Cancellation or timeout aborts remaining sequence actions, requests termination of current JavaScript, and detaches the guest debugger to release pending CDP replies. It does not roll back completed input, network requests, or page timers already scheduled. The held pointer starts its idle clock once per wobble cycle, restarts a stopped frame loop when held, normalizes scoot lean by direction, and preserves an existing glide to the same destination.

## Alternatives considered

Clipboard tricks, localhost file servers, and native dialog automation require extra steps and failed in the saved session. Per-character typing and waiting for visual arrival add latency without improving native input targeting. Copying ChatGPT's complete browser runtime would replace existing owners with a substantially larger implementation; the existing Cordis tools, Electron CDP guest, approval service, and spring overlay cover these changes.

## Consequences

The implementation is validated only with TypeScript and builds at the user's request. Upload behavior, cancellation, editor paragraph preservation, and pointer motion still require live Electron verification; no automated tests or recorded snapshots are added. One-second local actions do not imply a one-second post: model scheduling, input processing, reasoning, page readiness, and user approval remain separate waits. The separate-click remembered-chooser flow in the [original proposal](../../proposed/feature/2026-10-09-sidebar-browser-file-upload.md) remains unimplemented; agents use the atomic upload operation instead.
