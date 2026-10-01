# Agent Note: Promotion writes the confirmed-invariants document

Status: implemented

English | [中文](2026-10-01-memory-invariant-promotion.zh.md)

## Problem

The invariants read path shipped a block that no surface could fill. `memory-context` rendered `$AVN_HOME/memory/invariants/<owner>.json` into the system prompt, and nothing in the product wrote that document, so the floor beneath recall stayed empty for every owner. The previous note recorded that gap as the next step; this one closes it.

Two placement facts ruled out the obvious writer. `memory-context` is mounted per agent from a preset, and a preset publishes its services behind `isolate` realms, so a service it provided would be invisible to the host-plane Remote that serves Settings. And the block was rendered under a bound taken from that plugin's own configuration, so a writer in another package would have kept a second copy of the number that decides whether a promoted statement ever reaches a request — a reader dropping what a writer accepted, which is the silent loss this feature exists to remove.

The management Remote had no invariants operations at all, and Settings → Memory could only correct or forget what the model had recorded. A user could delete a wrong memory; they could not state something that should always be known, and no memory the model wrote was trusted not to be invented.

## Decision

`@aeven/memory-invariants` owns the document on the host plane: its format, renderer, bound, and mutations, published as `ctx.memoryInvariants`. The `avn-base` bundle mounts the row, so every profile carries the block, and the row does not depend on a memory provider — the block is what must be present when recall returns nothing. Preset scopes reach host services, so the per-agent consumer reads it without the two roles sharing a package.

The store answers synchronously from the owner's file and re-reads only when size or modification time moved. Both are compared as bigints, because at millisecond granularity two writes of the same length within one tick are indistinguishable and a session would render the block it already had. Every write renders the candidate document with the same renderer the prompt uses and refuses it whole when a statement would not fit, naming `too-long` for one statement that cannot fit an empty block and `full` for a block with no room left. The alternative — accepting the statement and leaving it out of the block — pays for a statement that never arrives. A write replaces the file in one step, so a concurrently assembling prompt reads the previous document or the new one.

`@aeven/memory-context` reads the block from the service at each assembly and registers its section at order `116`, after the memory guidance, because a model weights the later part of its prompt more heavily and these are the statements that must hold. `@aeven/api-memory-manager` is the only writer, through four Remote methods; the Settings page puts them on two surfaces: `Always remember` on a memory card, which promotes the fact the card already shows, and a Standing facts panel that lists what stands, shows the characters used against the bound, and edits or removes an entry.

The bound defaults to 1500 characters rather than the 500 the read path shipped with. A block that is stable while the user leaves it alone sits in the cached prompt prefix, so its cost is lower than its token count and its size is a product choice. The comparable always-on surfaces are larger: Claude Code recommends a 40,000-character ceiling per memory file and prefixes its instructions with an explicit precedence sentence, and Hermes freezes a 3,575-character snapshot. Measured memory injection accounted for 12 percent of billed cost in an uncached multi-agent benchmark, and shrinking a retrieval window from 32 to 2 entries cut injected tokens by 28.7 percent with accuracy changes inside seed-level variation, so the bound stays enforced at the write instead of trusted to the reader.

The block's guidance sentence claims precedence without granting authority: the statements outrank a recalled memory, a default, or an assumption; a later request from the user overrides them; and they authorize no work the user has not asked for.

## Alternatives considered

- **Providing the service from `memory-context`.** A preset's services live behind isolate realms, so the host-plane Remote would not see it, and a host-plane provider would still be needed.
- **Writing from the Remote while the format is shared as a module, keeping two store instances.** Two bounds and two caches over one file, and a writer under a larger bound accepts statements the reader drops.
- **Evicting the oldest statement when the block is full.** It never refuses a promotion and needs no refusal surface, but it deletes a statement the user confirmed without telling them.
- **Promoting through a model tool.** The document would then be writable on the model's initiative, which is what keeps an invented memory out of every prompt.
- **A second `startup`-style entry inside `memory-context`.** Host build entries are fixed to `index`, `invariant`, and `startup`, and a provider is none of them; widening the build for one row costs more than the package it avoids.
- **Workspace-scoped statements now.** No surface names a workspace, and the document's version field makes adding a scope later safe.

## Consequences

A statement reaches the model only if the write fitted the block, so the user learns from the refusal which statement to drop rather than finding a fact silently absent from every request.

The document is one file per owner, written whole, so a second writer would race the first. Nothing records which memory suggested a statement, and nothing compares a statement against later recall: correcting the memory leaves the statement standing until the user edits it, and the guidance resolves a conflict by preferring the statement.

Owner scope is the only scope. A project convention is either promoted for every project of that account or not at all.

The Settings surface for standing facts carries no spec: `MemorySection.tsx` is outside the per-file coverage gate because no spec imports it, as the rest of the Settings → Memory page already was. The five locale keys this change renamed to dotted form (`tabs.*`) are what the client UI i18n gate accepts as keys.

## Verification

`@aeven/memory-invariants` carries a thirty-case spec: a readable document, unreadable JSON, an unknown version, an entry missing a field, per-owner separation, a document that changes after first read, an owner id that would otherwise escape its directory, the framed order, an over-long entry left out whole, the character bound, the reported cost and longest statement, the guidance excluded from the budget, a written statement read back from disk, one-line normalization, re-promotion refreshing one statement instead of spending the block twice, newest first, blank text refused with no file written, a statement longer than the block refused as `too-long`, a block with no room refused as `full` with the document byte-identical, no temporary file left behind, a write isolated to its owner, another instance's write picked up, an edit keeping place and identifier, an edit of an unknown identifier, an edit to blank, an edit that no longer fits, a removal that frees the block, and a removal of an unknown identifier. `pnpm exec vitest run packages/memory/memory-invariants packages/memory/memory-context` passes 38 tests, `tsc -b` reports no errors for the provider, the consumer, the Remote, and the Settings client, and the host and client builds complete.

The live check is a restarted Host: the invariants block present in a real request's system prompt after a promotion from Settings → Memory, and absent again after the statement is removed.
