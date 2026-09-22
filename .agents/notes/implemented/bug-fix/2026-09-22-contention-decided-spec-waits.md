# Agent Note: Spec waits that contention decided

Status: implemented

English | [中文](2026-09-22-contention-decided-spec-waits.zh.md)

## Problem

`pnpm run check:all` runs its gates concurrently, and four specs that pass alone failed under that contention. Each failed for its own reason, and each reason named a different mistake rather than "too little time".

- `packages/experimental/inspector/tests/integration.host.spec.ts` — "cancels Client Runtime work when the Worker deadline expires" configured `clientRuntimeTimeoutMs: 20`, one budget shared by every Client Runtime command on that inspector. The case's subject is the deadline firing on a never-resolving promise, but the follow-up evaluate that proves the runtime still works had to finish inside the same 20 ms, so on a loaded host it timed out instead.
- The same file's "keeps captured EventSource data readable when the caller aborts after response headers" was one of twelve waits in that file written as a bare `vi.waitFor(...)`, which vitest bounds at one second. Every one of them watches a CDP event round-tripped through a real Worker, so a second is the wrong budget: the case failed waiting for `Network.loadingFinished` after an abort, and the teardown that followed then exceeded its hook budget.
- `packages/storage/storage-json/tests/external-watch.spec.ts` — "reports a foreign write the sweep finds, and stays silent on a self-write the sweep sees" wrote a document and stamped it as its own in two separate awaits while a 30 ms sweep was running. A sweep tick landing between them reported the self-write, which the unit's own comment says is allowed ("an unstamped self-write costs one redundant report, which the domain diffs away") — the spec asserted a stronger property than the watcher guarantees.
- `packages/boot/app-boot/tests/user-patches.spec.ts` — the HMR case drives four filesystem notifications through a real chokidar watch, and the helper that awaits each one bounded it at 30 s while the case's own budget was 120 s. Load decided which of the two expired.
- `packages/experimental/code-runtime-python/tests/runtime-budgets.spec.ts` — "charges a forked descendant against the run CPU budget" had each child spin for 1.2 s of *wall* time (`while time.time()-t<1.2: pass`), so how much CPU the child had burned when it exited depended on how the host scheduled it.

## Decision

Each fix removes the input the load decided, and names the state that is awaited:

- The inspector case keeps a deadline as its subject but sizes it above a loaded round trip (1 s, asserted as "timed out after 1000ms"). The never-resolving promise is still the only thing that exceeds it.
- The storage case runs on the file's own deterministic idiom — `sweepOnly` with a hand-driven pass — so the pass runs after the stamp instead of racing it. The assertion became exact (`toEqual([{ table: 't', key: 'foreign' }])`), which is a stronger statement than the previous "never contains `mine`", and the live-sweep trigger keeps its own cases in the same file.
- The HMR case's wait takes the case's own 120 s budget, because the awaited work is a notification plus the loader re-activation it triggers, repeated four times beside three sibling workers.
- The Python case's children spin on the CPU (`while True: pass`) and are stopped by their own inherited soft `RLIMIT_CPU`, so each contributes its full second regardless of scheduling.
- The inspector file's twelve waits go through one named helper that gives them fifteen seconds and states what is awaited — a CDP event through the real Worker.

## Alternatives considered

Raising every timeout was rejected because it leaves the awaited state unnamed, and for the storage case no amount of time could help: the assertion was stronger than the watcher's contract, so a longer sweep window only makes the redundant report rarer, never impossible.

Retrying the cases, or making each one run alone, was rejected for the reason [the reliability skill](../../../../.agents/skills/avn-ci-test-reliability/SKILL.md) gives: a retry hides the input that the load decides rather than removing it, and a sequential block cannot protect a host resource from another file or process — the same watcher, deadline, and meter are shared with specs outside this file.

Keeping the 20 ms inspector budget and asserting only the timeout message was rejected because it drops the half that matters: a deadline that cancels a request and leaves the runtime unusable is the defect this case exists to catch.

## Consequences

- Contention no longer decides these cases; a genuinely broken watcher, deadline, or meter still fails them, and each fix is visible in the assertion rather than in a longer sleep.
- The inspector case takes about 1 s and the external-watch case is unchanged in cost; the HMR case pays its budget only when it would otherwise fail.
- The Python case now spends the child's inherited budget instead of the host's wall clock, which also removes the clock's dependence on `time.time()` moving under the run.
- Evidence: the files pass (`19` external-watch cases, `17` user-patches cases, the inspector file's `10` cases, the budgeted inspector case in 1.4 s, the Python case three times in a row), and `check:all` (55 passed) is the acceptance run.
