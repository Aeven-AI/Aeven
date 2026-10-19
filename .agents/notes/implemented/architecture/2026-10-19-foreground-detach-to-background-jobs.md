# Agent Note: Foreground commands detach to background jobs

Status: implemented

English | [中文](2026-10-19-foreground-detach-to-background-jobs.zh.md)

## Problem

A foreground `bash`/`pwsh` call owned the whole turn: the model waited, the user waited, and the executor's own budget (120 s by default) eventually killed the command. Whether a long command ran in the background was a *judgement the model had to remember to make* — `run_in_background: true` — so a session whose context carried the habit (a memory, a user instruction such as "long commands go to the background so the chat stays responsive") behaved differently from a fresh install that carried neither. The capability existed; the default did not.

Two smaller facts made the default worth fixing rather than documenting:

- A foreground command that outlived `timeoutMs` was killed and reported `timedOut`, so the model lost work it could have collected.
- `bash` opts out of `ctx.toolCallTimeout`, so a foreground call had no other bound; "make the chat responsive" cannot be a prompt convention alone.

## Decision

**The tool decides when to stop waiting; the executor performs the handoff.** `tool-bash` and `tool-pwsh` own a `detachAfterMs` Config field (default 20 000 ms, the deployment-varying choice). A foreground call carries it into `ctx.shell.run()` as `ShellExecSpec.detachAfterMs`, and the tool registers the returned handle as a `ctx.jobs` job exactly as it registers an explicit `run_in_background` start — one producer path, two triggers.

The seam gained one outcome shape and one sibling method — `run()` keeps its settled-result contract so no existing caller changes:

- `ShellRunOutcome = ShellRunResult | ShellDetachedRun`, where `ShellDetachedRun` is `{ detached: true, process: ShellProcess, detachAfterMs }` and `isDetachedRun()` is the discriminant reader.
- `ShellExecSpec.detachAfterMs` is the caller's threshold; providers implement only the wait.
- The executor's timeout keeps its meaning. Whichever comes first wins: a threshold that elapses first hands the still-running process back with no timeout applying afterward; a timeout or caller abort that fires first still kills the command and settles as `ShellRunResult`, so `timedOut`/`aborted` classification is unchanged.

**The deadline is releasable.** `@aeven/timeout` gained `releasableDeadline()` — the same fused timeout/upstream signal with `release()`, which stops the timer and stops forwarding upstream cancellation. `deadline()` is now that function without the release handle. The handoff releases the deadline before returning: after the tool call returns a job id, neither the executor's timeout nor the tool-call abort may kill work whose new owner is the job registry. The forwarding is done by hand rather than through `AbortSignal.any` for exactly this reason — a fused source cannot be detached.

**No byte is lost at the handoff.** The foreground path collected output through offset readers without consuming them, so the adopted `ShellProcess` reads the same collectors from byte 0; output a command wrote before the threshold is in the job ring. `LocalBashExecutor`/`PwshLocalExecutor` build the background handle in one `adopt()` used by both `start()` and the detach path, with `killedByUpstream` as a parameter: a detached process answers `false`, because the tool-call signal no longer owns it and a later abort must not relabel its exit as killed.

**Sandbox facts follow the settlement, not the call.** A detached confined process has not settled, so `SandboxBashExecutor`/`SandboxPwshExecutor` retain the provider's classification facts against the adopted handle; `onProcessDone` stamps `process.sandbox` at settlement, where every background process's facts come from.

**The shipped prompt says what the default is.** Both tool descriptions and prompt sections now lead with "start anything whose duration you cannot bound in the background", and the description states the threshold it will apply. A fresh install therefore behaves the way a well-briefed session does, without a memory or a user instruction.

## Alternatives considered

**Background by default (`run_in_background` defaults to true).** The smallest diff, and literally "by default run in background". It lost on the fast path: `ls`, `git status`, and every command that finishes in milliseconds would cost a second `job_output` call, and the model would lose the output in the same turn. A threshold keeps the one-call fast path and still never blocks.

**Prompt-only change (a stronger `run_in_background` instruction).** Free and testable, but it depends on the model's compliance for every single call and leaves the 120 s kill in place. It is now the *wording* half of this change, not the mechanism.

**Tool-level race over `ctx.shell.start()`.** `tool-bash` could have started every command as a background handle and raced a timer itself, avoiding the seam change. Rejected because it moves timeout ownership into the tool: `timeoutMs`, its default and cap, and the first-cause `timedOut`/`aborted` classification all live in the executor, and a tool-side kill would duplicate them. `packages/AGENTS.md` requires a capability to own its termination.

**Detach at timeout instead of a separate threshold.** Turning the existing `timeoutMs` from "kill after" into "hand back after" removes the only kill switch the model has for a hanging command and rewrites the documented meaning of `timeoutMs`. A second, earlier threshold keeps both.

## Consequences

Bought: a long command no longer holds the conversation on a fresh install, and the executor's timeout no longer destroys work that could continue. The model sees the same acknowledgement shape it already knew (`kind: 'background'` + `jobId`), extended with `detached`/`detachAfterMs` so the card and the text can say why it moved; `presentResult` treats that acknowledgement as a generic card through the shared `BACKGROUND_ACK` prefix.

Cost: the seam now names the choice twice. `runDetachable()` is the only entry point that can return a `ShellDetachedRun`, so a caller that wants the handoff must ask for it by name instead of setting a field on a spec, and a provider that cannot hand work back inherits a waiting default rather than failing. That is the price of leaving `run()`'s contract — and every existing consumer — untouched. A detached run also outlives the tool call, so its cleanup belongs to job disposal and composition teardown, exactly like an explicit background start.

Deferred: persistent-shell (`tool-terminal`) sends and the subagent tools keep their own background semantics; neither runs through `ctx.shell.run()`. A Windows-only composition sees the same behavior through `pwsh-local`, whose detach suite self-skips without a usable `pwsh` and is exercised on the Windows matrix.
