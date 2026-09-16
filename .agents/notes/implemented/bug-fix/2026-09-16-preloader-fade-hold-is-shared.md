# Agent Note: the shell preloader's fade hold is shared, so it lives in one place

Status: implemented

English | [中文](2026-09-16-preloader-fade-hold-is-shared.zh.md)

## Problem

The first-paint cover plays two fades — `opacity` and `filter` — that must start together, and a fallback timer must outlast both so a shell that never signals readiness still reveals the application. Two files owned those timings: the inlined sheet `apps/web/src/preloader.css`, which plays the animation, and `packages/client/web/src/preloader.ts`, whose `FADE_DELAY_MS` and `FADE_MS` the fallback timer adds up.

`00147ac181` set the sheet's hold and the constant to the same 500 ms. `56264f4338` later moved only the constant, to 300 ms, and recorded the reason nowhere. The two sides then disagreed, and `packages/client/web/tests/preloader-styles.client.spec.ts` — which derives its expectation from the constants — failed against the shipped sheet. The sheet states that it is the authority: both fades wait 500 ms, and its comment names `FADE_DELAY_MS` as the repetition of that delay.

## Decision

`FADE_DELAY_MS` is 500 again, matching the sheet and its comment. The hold is one number owned by the animation that plays it; the TypeScript constant repeats it for the fallback timer and must be changed with it.

The visible consequence is the no-signal fallback window, which grows from `300 + 400 + 100` to `500 + 400 + 100` ms. That window only elapses when the shell never reports readiness — the normal path reveals on the shell's own signal — and it now waits out the fade the sheet actually plays instead of releasing the cover 200 ms into it.

## Alternatives considered

**Move the sheet to 300 ms instead.** Rejected as a silent product change: it shortens the hold the cover was designed around, shortens it for every user rather than only the fallback path, and the later commit that introduced 300 ms recorded no intent to change the animation. If a shorter hold is wanted, that is a design decision that moves the sheet, its comment, and both constants in one change.

**Derive the constant from the sheet at build time.** Removes the class of drift, but the sheet is inlined into the boot HTML before the client bundle exists and the constant is read by the shell entry, so the derivation would have to run in the same build step that inlines it, for one number.

**Leave the constant at 300 and relax the spec.** The spec exists to hold the two sides together; relaxing it would ship a fallback that releases the cover mid-fade and call that verified.

## Consequences

The control and the animation agree again, so the spec that reads both passes without being weakened. A future change to the hold must move `FADE_DELAY_MS` and the sheet's two `transition` declarations together, which is what the sheet's comment already asks for and what this note records.

## Testing

`packages/client/web/tests/preloader-styles.client.spec.ts` pins the sheet's hold to `FADE_DELAY_MS` and its duration to `FADE_MS`, so a sheet or constant that moves alone fails the gate.
