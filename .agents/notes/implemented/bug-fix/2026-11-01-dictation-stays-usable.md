# Agent Note: Dictation stays usable across a closed stream and a cold worker

Status: implemented

English | [中文](2026-11-01-dictation-stays-usable.zh.md)

## Problem

Dictation failed in two ways a reader could not distinguish from a broken app.

The composer's ready state comes from one Host stream (`speech.follow`). A `RemoteStream` reports a silent end as a terminal error, and its carrier retry gives up after the second failure while the client still sees a live connection; either outcome finished the consumer. `ui-voice-input` opened that stream once per plugin mount and never listened for `connection/reset`, so after a socket loss or a Host restart the mic could not record until the whole page booted again. Other Client domains (settings, model selection, sessions) restart their streams on that event; voice did not.

The recognizer's cold start is expensive. The macOS worker build embeds the Metal kernel source and compiles it at process start — about twenty seconds before it prints `{"ready":true}`. With `idleTimeoutMs` at five minutes the worker was stopped between dictations, so a reader who paused paid that compile inside what looked like a hung transcription. A recording that is running when the worker is reaped waits for a process that does not exist yet.

## Decision

The readiness mirror owns its stream for the plugin's lifetime and reopens it. After any end it waits with exponential backoff (two seconds doubling to thirty), and a `connection/reset` interrupts the wait, resets the backoff, and restarts the live generation; the catalogue the UI already has stays published while a new generation opens. Disposal aborts the wait and joins the loop, so the plugin effect still releases everything.

The app composition starts an already verified worker during activation (`warmOnActivation`) and keeps it (`idleTimeoutMs: 0`). `warm()` waits for the activation inspection, refuses to start when the model is not verified — an unverified model still waits for the explicit Settings download — and otherwise runs the ordinary preparation path, which publishes `waking` and then `ready` like any other start. The cost moves from the reader's first recording to Host boot.

The mic never captures audio it cannot transcribe. When the recognizer is unusable the control's tooltip names the reason (stream closed, model unprepared, preparation failed, preparation running), starts a new preparation when the phase is `unprepared`, `failed` or `cancelled`, and opens the voice section; before this change a `failed` model made the button do nothing at all.

Acceleration stays automatic and optional. `use_gpu` asks whisper.cpp for any GPU or integrated-GPU device the build offers and appends the CPU buffer list unconditionally, so a machine without one runs on the CPU. The native builds decide what is offered: Metal on macOS, AVX2/FMA on x64, dotprod on Windows ARM64, CPU only on Linux. Nothing in the composition requires a GPU.

## Alternatives considered

**Restart the whole readiness plugin on reset** — the plugin's registrations, dictionaries and capture set are effects of one fiber; remounting it to recover a stream would rebuild UI registration for a transport failure.

**Keep the idle teardown and reopen the worker on demand** — that preserves nothing but the old bill: the compile happens on the path a reader is waiting on.

**Warm the worker only when a page subscribes to the catalogue** — a subscription arrives on every page load, including reloads a reader makes without ever dictating, so this pays the compile more often than activation does and still misses the app that boots straight into a session.

**Precompile the Metal library at build time** — the honest fix for the twenty seconds, and it needs a metallib artifact per platform package, a build-toolchain dependency for contributors, and a new native release; the warm worker removes the delay from the reader's path today and leaves the build change open.

**Detect a GPU and choose a model or thread count from it** — whisper.cpp already selects the device at load time, and the recording is one serial job, so a second selection layer would only add a way to disagree with it.

## Consequences

A closed or failed readiness stream no longer costs a page reload: the mic recovers on its own within thirty seconds, and at once when the client sees a new Host generation. In exchange the mirror can reopen against a Host that keeps failing, so a broken speech Remote now produces a repeating error rather than one dead stream; the backoff caps that traffic at one attempt every thirty seconds.

The app holds a resident worker — the small model's weights plus its runtime — for as long as the Host process lives, instead of releasing it after five idle minutes. Boot uploads that memory and the platform's compile cost in the background; a machine that never dictates pays both. `warmOnActivation` defaults to false and `idleTimeoutMs` to five minutes, so only a composition that opts in (the web app bundle does) takes that trade.

Recording is now impossible to mistake for a broken button: the mic either starts, or says why it cannot.
