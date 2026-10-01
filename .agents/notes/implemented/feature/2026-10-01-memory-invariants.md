# Agent Note: Confirmed invariants are present in every request

Status: implemented

English | [中文](2026-10-01-memory-invariants.zh.md)

## Problem

Recall is a lookup, and a lookup can return nothing. Measured on this deployment before the identifier fix, seven of forty-five turn-start recalls lost every candidate, five returned no memory at all, and the turn carried on looking normal. A fact the user stated once and expects to hold — how they want questions answered, which port a service runs on — has no floor beneath retrieval, so a silent miss costs the session that depended on it.

Presence alone is not a design. A block in the system prompt is paid for on every request and the model cannot skip it, which means a wrong entry there is wrong permanently and occupies attention that the current request needed. The failure mode of always-present memory is not that it is missing; it is that it cannot be ignored and cannot be wrong.

## Decision

`@aeven/memory-context` renders a small always-present block of the owner's **confirmed invariants** as a system-prompt section, ordered ahead of the memory guidance.

The block is Aeven's own file, `avnHomePath('memory', 'invariants')/<owner>.json`, read through the caller's own home rather than configured, so presence needs no configuration and no opt-in. It is bounded by `invariantsMaxChars` (500 by default) and an invariant that does not fit is left out whole rather than clipped. The section registers per agent, in the agent's own scope, with `text` as a provider evaluated at each assembly; the store answers from a cache keyed by the file's size and modification time, so an assembly costs one `statSync` and a parse only when the document moved.

Two properties make the block safe to make unskippable:

- **Only the user promotes an entry.** Nothing here is written on the model's own initiative, so a memory the model inferred — the case most likely to be confidently wrong — can never become a permanent part of every request.
- **It is context, not authority.** The block is read like a recalled memory and can be ignored the same way. It never reaches an enforcement point; a statement that must bind an action belongs to a guard.

## Alternatives considered

- Copying the frozen-snapshot design: a large curated block, roughly 3,500 characters, written by the model and injected at session start. Rejected on three counts. The cost is paid every request; the snapshot does not see anything saved during the session that wrote it; and model-written prose in the prompt is exactly the content that cannot be recalled if the model was wrong.
- Promoting every memory that was recalled often, or that carries outcome evidence. Frequency shows a memory was repeated, not that it was right, and an invariant is the one tier where being wrong is permanent.
- Keeping invariants in the memory provider. The provider is deliberately replaceable, and the tier that must survive a provider change is the last one that should depend on it.
- An auxiliary model call to consolidate the block. It would run on the request path, which this plan forbids; the block is read and rendered without a model call, and the store costs one filesystem stat.

## Consequences

The block contributes nothing until something writes an owner's document, and the promotion surface is not built yet: this change ships the store, the bound, and the renderer, and the Settings → Memory path that fills them is next. An absent or unreadable document renders no block rather than a partial one, so the failure mode is an empty tier and not a wrong statement.

`memory-context` now reads the host's home path service and registers per agent, so it takes `agents` as a dependency. A composition with no Aeven home — an SDK or single-user test — contributes no block.

The block is advisory, so a user who promotes an invariant gets presence, not compliance. Making it bind is a separate mechanism: promoting a recalled preference into a rule an enforcement point reads.

## Verification

A twelve-case spec covers a readable document, unreadable JSON, an unknown version, an entry missing a field, an empty owner, framing and order, an over-long entry left out whole, the character bound, per-owner separation, a document that changes after first read, and an owner id that would otherwise escape its directory. `pnpm exec vitest run packages/memory/memory-context/tests` passes twenty-six tests across the package's three specs, and `pnpm run typecheck` reports no errors.

Not measured: how often a miss would have changed an outcome, and whether a promoted invariant changes what the agent does. Both need the per-turn record this harness does not yet keep; the benchmark in `scripts/benchmark-memory.ts` is where the second would be measured once a promotion surface exists.
