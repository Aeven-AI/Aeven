# Agent Note: Script runners and command runners

Status: implemented

English | [中文](2026-09-21-macos-provider-script-runners.zh.md)

## Problem

`@aeven/computer-use-macos-provider` assembles the macOS stack, and its constructor built one runner — `createMacCommandRunner()` — then handed that same object to both consumers. The two answer different questions. The desktop adapter drives *programs*: it spawns the accessibility walk and the readiness probes through `execFile(command, args)`. The Apple Events handler runs *scripts*: it evaluates text through `osascript -l <language> -e <script>`, calling `runner.run(script)` for JavaScript and `runner.run(script, 'AppleScript')` for the one AppleScript mechanism.

Given the command runner, neither call can work, and they fail differently, because `createMacCommandRunner` spreads its second argument into argv. The JavaScript paths pass no second argument at all, so `[...undefined]` throws a `TypeError`, which that runner catches and reports as exit code 1 with the type error as its diagnostic. The AppleScript path spreads the language string into eleven single-character arguments, so `execFile` looks for a program named after the script text and reports ENOENT. Both symptoms read as a broken mechanism — an unusable script, or a missing tool — rather than as a mis-wired seam, and that is what makes this worth recording: the symptom pointed at the recipe and the environment, while the fault was three lines up in the provider.

The mix-up is not subtle to the compiler. `MacCommandRunner` is not assignable to `AppleEventsRunner`, because a `run` taking `(command, args, signal)` cannot stand in for one taking `(script, language)`. The package existed only in the working tree when the wiring was written — `packages/computer-use/computer-use-macos-provider/` untracked, its two aggregate entries (`tsconfig.base.json`'s path alias and `tsconfig.host.json`'s project reference) equally uncommitted — so no gate had compiled it, and `tsc -b tsconfig.host.json` rejected it with the offending argument named the first time it ran against that tree.

## Decision

The provider constructs one runner of each kind and gives each to the consumer whose contract it satisfies: `createMacCommandRunner()` to `MacDesktopAdapter`, and `createOsascriptRunner()` to the `apple-events` handler that both the `TaskExecutor` and the `ComputerUseSession` receive.

Both factories stay exported, and the seam is the function type each returns rather than the call site: an Apple Events handler accepts an `AppleEventsRunner` and a desktop adapter a `MacCommandRunner`, so a deployment injects its own transport — a recording runner in a test, a remote executor in a hosted deployment — without the provider knowing which implementation it was handed. The provider is the only package that imports both, which is what makes it the provider rather than more code inside either adapter.

`tsc` is what pins this wiring, and it is the only thing that does. Both runners are objects with a `run` method that resolves a non-zero exit as a value instead of rejecting, so with the transport stubbed, the mechanism handler's own tests pass with either one installed.

## Alternatives considered

**One runner that infers its own shape.** A single `run` whose second argument is either a language tag or an argv array would have made the provider's single construction legal. Rejected: that ambiguity is precisely what made the mix-up invisible, since every call site would then carry knowledge the type could have stated, and a wrong call would fail at the first Apple Event rather than at compile time.

**Name the factories after their consumers.** `createAppleEventsRunner` beside `createAdapterRunner` would make the wrong pairing read as wrong at the call site. Rejected because a runner is not a consumer: the `osascript` runner serves any script-running seam, and a name bound to today's single caller would have to change the day a second one appears — while the return type already distinguishes them.

## Consequences

The Apple Events mechanisms now reach their transport, so the semantic recipes that assert application state — a calendar holding an event, a note existing — can run, and the [provider spec](../../../../packages/computer-use/computer-use-macos-provider/tests/provider.spec.ts) exercises both factories directly: a failing script resolves with a status instead of throwing, and a successful one returns its stdout.

The cost is one extra `promisify(execFile)` closure per provider instance, which is not worth avoiding: the adapter and the handler legitimately need different argv shapes, and the runner type is where that difference is stated. A deployment wanting one transport for both can inject two runners backed by the same code.

The same `tsc -b tsconfig.host.json` run surfaced a second defect of this batch in [`resolveExpectations`](../../../../packages/computer-use/computer-use-executor/src/expectations.ts), which wrote `undefined` into optional expectation fields in violation of `exactOptionalPropertyTypes`. That fix carries no decision of its own: consumers read those fields through `=== undefined`, and JSON serialization drops an undefined property either way, so the resolved expectation is now shaped as it was declared rather than as the code happened to build it.
