# Agent Note: The Client retains Console events and replays them on enable

Status: implemented

English | [中文](2026-08-29-client-console-replay-on-enable.zh.md)

## Problem

`ClientConsoleObserver` installed its console hooks on the first `enable(sessionId)` and captured nothing before that. Enabling is not local: the Worker's `ClientRuntimeRouter.subscribeConsole` sends `client-console/enable` over the ingest socket, and the Client installs its hooks only when that frame is dispatched. Nothing acknowledges the frame, so the Worker announces `Runtime.executionContextCreated` to DevTools as soon as `attachConsole` returns.

A DevTools client therefore learns the Client context exists strictly before the Client is observing it. Anything the Client logs in that window is not delivered late — it is never captured, and no later request can recover it.

`packages/experimental/inspector/tests/integration.host.spec.ts > forwards Client Console objects through isolated realm sessions` sits exactly in that window: it logs as soon as the announcement arrives. The test passed on timing alone and began failing on every run when unrelated changes shifted the window; adding any logging to the Worker moved it back to passing, which is what identified the race rather than a lost subscription.

## Decision

**The Client observes its own console for the whole life of a transport generation, not for the life of a Console session.** `reset()` — already called at the start of every `connect()` and on socket close — installs the hooks and clears what the previous generation retained. `disable()` no longer uninstalls them, so the window between one session leaving and the next arriving is still observed.

**Captured events are retained and replayed to each session as it enables.** `enable(sessionId)` delivers the retained events to that session before live delivery begins, and ignores a repeated id so a duplicate enable cannot replay twice. Replay materializes each event against the enabling session's own object table, so the per-connection object isolation the Runtime domain guarantees is unchanged.

**The retention bound is a fixed constant, not configuration.** `MAX_BUFFERED_CONSOLE_EVENTS` caps what one generation's pre-enable window can hold. It bounds the memory a Client retains on behalf of a debugger that may never attach; it is not a deployment-varying choice, and no consumer has asked to size it.

This is what Chrome's own Runtime domain does — `Runtime.enable` replays console history rather than starting from the moment of the call — so the behavior a DevTools user already expects is the behavior that removes the race.

## Testing

The inspector suite runs 137 tests green across 20 files. The specific spec failed 6 of 6 runs before the change and passes 4 of 4 after. No test asserts the old drop, because the old behavior was a race rather than a stated contract.

## Alternatives considered

**Acknowledge `client-console/enable` before announcing the context.** Rejected as the wrong guarantee to buy at this price: it adds a message type, its codec, and dispatcher cases on both faces, and it holds the `Runtime.enable` response behind a socket round-trip to every Client. It would order the announcement correctly and still lose anything logged before the Worker decided to subscribe, which replay covers and an acknowledgement does not.

**Synchronize the test instead.** Rejected: the drop is silent and permanent, and a Client that logs during startup is the normal case rather than a test artifact. Encoding the race as intended behavior would leave the defect for the first real user who looks for a log that the Client did emit.

## Consequences

The Client's `console` methods stay wrapped for the life of the transport generation rather than only while a DevTools session is attached. The wrapper already calls through to the original first and swallows its own failures, so the observable console behavior is unchanged; the cost is one indirection per call and the retained events, both bounded.

Retained events hold strong references to the logged values until the generation resets, so a Client that logs large objects keeps them reachable up to the retention bound. This is the same trade a browser makes for console history.
