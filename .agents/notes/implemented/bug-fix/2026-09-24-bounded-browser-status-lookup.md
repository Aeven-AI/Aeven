# Agent Note: Bounded browser status lookup

Status: implemented

English | [中文](2026-09-24-bounded-browser-status-lookup.zh.md)

## Problem

`@aeven/tool-browser` reads the open page on the first step of every turn through the `browser/automation` waterfall, before the loop appends `step/start`. In a web composition that waterfall is forwarded by `@aeven/api-remotes` to the Typert gateway, which delivers it to every connected Client and settles it only after each delivery answers. A pending forwarded waterfall has no deadline by design: an approval or a user question must wait for a Client to connect.

The lookup awaited that waterfall with only the turn's signal. With no Client able to answer, every new turn in every session stopped between `turn/start` and `step/start`, while turns already past step 1 continued. On 2026-09-24 four turns, including two subagent turns, stalled for up to 16 minutes and all resumed at the instant a new browser tab connected and answered the pending lookups. The `preview_*` tools had the same unbounded wait and declared no tool timeout.

## Decision

Every wait on the waterfall is bounded by a validated `Config` field:

- The first-step lookup runs under a `deadline` of `statusTimeoutMs` (default 2000 ms) fused with the turn signal. The bounded signal travels in the request, so the gateway cancels the pending event when it fires, and the plugin also races the waterfall against it, because a listener is not obliged to honor the signal. An unanswered lookup is logged at debug level and the step proceeds without the browser context; a listener failure is logged as a warning.
- Each `preview_*` tool declares `actionTimeoutMs` (default 60000 ms) as its `timeoutMs`, so `@aeven/tool-call-timeout-policy` aborts the call and the model receives `TOOL_TIMEOUT` instead of a call that never returns.

## Alternatives considered

**Settle forwarded waterfalls with `next` when no Client is connected.** This would fix every optional forwarded lookup at once. It loses because the gateway's pending lifetime is what lets an approval or a user question reach a Client that connects later; a best-effort reader must not change that for callers that must wait.

**Remove the first-step lookup.** It loses the ambient page context the model uses to decide whether a request concerns the open page.

## Consequences

- In a web deployment with no Client connected, each new turn spends up to `statusTimeoutMs` before its first step instead of stalling indefinitely.
- A Client that answers after the deadline no longer contributes its page to that turn.
- `packages/web/tool-browser/tests/tool-browser.spec.ts` pins the bounded wait, cancellation of the request signal, turn cancellation during the wait, the declared tool timeout, and config validation.
