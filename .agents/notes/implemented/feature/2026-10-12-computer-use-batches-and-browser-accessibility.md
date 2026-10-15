# Agent Note: Computer-use batches and browser accessibility

Status: implemented

English | [中文](2026-10-12-computer-use-batches-and-browser-accessibility.zh.md)

## Problem

The desktop session supports batched recipe execution and independent verification, but a model cannot call it. The in-app browser supports batches but exposes only DOM selectors, which do not address elements inside shadow roots. Browser captures outside the tool pipeline do not produce ordinary logged image results.

## Decision

Each platform provider registers `computer_use_run` over an operation-local `ComputerUseSession`: macOS, and Windows since [Windows computer use mounts through a first-party provider and a COM handler](2026-10-15-windows-computer-use-provider-and-com-handler.md). Each batch contains 1 to 20 steps, reports completed results, stops at the first failure or unverified execution, and forwards cancellation to host commands. Execution requires write access and approval. The Web bundle mounts it with `register: false` alongside the Cua Driver; the driver retains the exclusive registration and its existing interaction tools. This batch supports semantic recipes and does not implement rung downgrade or replay receipts.

`preview_snapshot` offers Chromium accessibility observation with the desktop node fields and snapshot-scoped tokens. The browser resolves tokens to backend DOM nodes for click and text insertion, including shadow-root editors. A token cannot be combined with selectors or coordinates. A new observation or browser action invalidates the token set; document changes and detached, hidden, or disabled elements refuse execution. Frame targeting remains separate work.

`preview_screenshot` captures the visible viewport as JPEG within the browser action deadline, persists it through the attachment store, and returns an ordinary image block. Browser actions race their cancellation deadline even when a Client ignores its signal.

## Alternatives considered

**A parallel browser or an external screenshot command.** These operate outside the user's selected pane or bypass the bounded, logged tool result. The existing browser automation waterfall owns the selected guest and carries both operations.

**Exposing the first-party batch as a replacement desktop driver.** The semantic executor has no vision mechanism handler. Keeping the Cua Driver registration preserves its working accessibility and vision mechanisms without claiming that the batch can downgrade to them.

## Consequences

Verification and per-expectation failures reach the model in one result. Accessibility observation avoids manual shadow-root selector discovery. Tokens require fresh observations after actions, and accessibility output reports truncation. Completed batch steps are not rolled back; repeating them can duplicate application changes. Independent calls do not share observations, and neither provider reserves the desktop across sessions.

## Verification

Host, client, and desktop TypeScript compilation and the repository and desktop builds pass. Automated tests and live application workflows are not run under the requested validation scope.

## Related

The [script-runner decision](../bug-fix/2026-09-21-macos-provider-script-runners.md) continues to own the distinction between the adapter's command runner and the semantic handler's script runner.
