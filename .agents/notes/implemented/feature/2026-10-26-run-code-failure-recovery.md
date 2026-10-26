# Agent Note: `run_code` failures carry the recovery step

Status: implemented

English | [中文](2026-10-26-run-code-failure-recovery.zh.md)

## Problem

A failed `run_code` program told the model what happened and left it to work out what to do. `code run failed (timeout): compute budget exhausted (60000ms busy)` names the cause with no next step, and the same holds for `worker-exit`, `invalid-output`, `output-limit`, and `abort`. Three sibling rejections — `not dispatched`, `tool call abandoned`, `result discarded` — shared a prefix but never said that the call had no effect, so a model could retry a write it believed had landed.

The opposite assumption was also worth measuring before changing anything: `run_code`'s own schema is about 930 characters, 2.6% of the `ptc` prompt, while the generated `tools:sdk` declarations are 81% of it. Trimming the tool text would have bought almost nothing; the failure path was where the model actually lost time.

## Decision

### One recovery clause per failure kind

`RECOVERY_BY_KIND` maps the runtime's `CodeRunFailure['kind']` union to the instruction that changes the next program: fix and re-run while completed calls still stand; do less per program after a budget expiry; re-run after a cancellation or a dead runtime process; return JSON-serializable values; print less or spill to a file. The table is typed against the runtime's own union, so a new kind fails `typecheck` here instead of reaching a model with no advice.

The composed text stays `code run failed (<kind>): <message>`, then the clause, then the conditional `Captured output:` block. The runtime taxonomy, the log, and the tool schema are untouched: these strings are result content, which is already model-visible and already logged as `tool/result`.

### One message for every ended-run rejection

`runOverMessage` builds all three sub-call rejections from one shape: the abort reason, the tool's name, what happened to that particular call, and the consequence — the run had already ended, so the call changed nothing, and the program has to be re-run if the result still matters.

`invalid description` names its fix as well, so the two validation paths a model hits with malformed arguments both say what to send instead.

## Alternatives considered

**Trim the `run_code` description instead.** Measuring first ruled this out: the schema is about 930 characters, 2.6% of the `ptc` prompt, while the generated `tools:sdk` declarations are 81%. A model that lost a minute to a failure would have regained microseconds.

**One generic recovery sentence for every kind.** A single `fix the problem and re-run` is wrong where it matters most: after a compute-budget expiry the fix is a smaller program, after a cancellation it is a re-run, and after `invalid-output` it is a serializable return value. The runtime's kinds already form a closed union, so the table can be exhaustive instead of vague.

**Push the advice into the prompt.** A prompt section costs tokens on every step of every turn and still cannot know which failure occurred; the recovery clause is paid only when a call fails and names the failure it answers.

**Return a structured error object the model must interpret.** `run_code` results are text the model reads directly, and a JSON envelope adds a parsing step at the one moment the model is already recovering.

## Consequences

- The runtime's failure taxonomy, the session log, and the tool schema are unchanged: the change is result content, which is already model-visible and already logged as `tool/result`.
- `RECOVERY_BY_KIND` is typed against `CodeRunFailure['kind']`, so a new failure kind fails `typecheck` here rather than reaching a model with no advice.
- The three ended-run rejections share one shape that states the call changed nothing, so a retried write is a decision the model makes knowingly.
- No snapshot scenario changes, because the composed strings appear only on failure paths.

## Verification

`packages/core/tools/tests/ptc.spec.ts` pins both composed texts — the abandoned sub-call message and the full `output-limit` failure with its captured output. The tool description and schema are unchanged, so `docs/tool-catalog.md` and the recorded `tool-schemas` snapshots stay valid; no new event, config field, or model-visible input is introduced.
