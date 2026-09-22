# Agent Note: The ACP session announces only options the client does not hold

Status: implemented

English | [中文](2026-09-22-acp-announces-only-changed-options.zh.md)

## Problem

Nine golden fixtures moved between runs. The same scenario passed five times alone (twice idle, three beside the unit-test suite) and failed inside `pnpm run check:all`, always by exactly one missing `config_option_update` line, with the `session/new` result identical on both sides.

The announcement is a race on provider-registration order. `packages/acp/acp/src/index.ts` listens for `llm/adapters-updated` and asks every live session to republish, and `LlmRuntime.registerAdapter()` emits that event for each provider row as it activates. A client whose `session/new` runs before the last row registers therefore receives the model catalog twice; a client that arrives after it receives it once. The recorded fixtures pinned one side of that race, so the lane's verdict came from machine load rather than from the product. The local Aeven gateway was ruled out: pointing `AEVEN_API_URL` at a dead port changed nothing.

## Decision

A session announces only what its client does not already hold. `AcpSession` records the options it last sent — on every response path, which is `configOptions()` for `session/new` and `session/load` and `setConfig()` for `session/set_config_option` — and `topologyChanged()` skips the notification when the changed topology resolves to that same list. The comparison is structural over the one producer (`AcpModelControl.options()`), so key order is fixed and the check is exact.

## Alternatives considered

Waiting for the LLM topology to settle before answering `session/new` was rejected because activation completing is not the same as every asynchronous registration being done: the routes that need a credential or an account resolve later by design, so "settled" would have to mean a quiescence timeout rather than a signal the runtime actually has.

Making the snapshot harness wait for quiescence before writing its input would remove the flake from the lane without touching the product, but it moves the race into the test: the product would still announce a snapshot the client already held, and the recorded transcript would keep depending on which side of that wait the client landed.

Pinning one side in the fixtures is what the nine files did, and it is what made the lane's verdict a function of machine load — the two sides are equally correct, so no fixture content could be right.

## Consequences

- `config_option_update` means what the protocol says it means: the options the client was given are no longer current. It no longer doubles as "a provider row finished activating", so the transcript stops depending on activation order.
- A real change still announces: a provider that disappears, or an account route that appears after sign-in, resolves to a different list and is published — pinned by the existing topology cases, including "publishes recoverable options when the selected adapter disappears".
- The nine ACP fixtures were refreshed and lost the redundant announcement. `pnpm run test:snapshot` is 114 passed with no failures (previously one scenario failed on drift and these nine flipped with load); `pnpm run test:expected` is 28/28.
- The new case "stays silent when a topology change resolves to the options already published" fails with two announcements when the skip is removed, so it observes the regression rather than the timing.
