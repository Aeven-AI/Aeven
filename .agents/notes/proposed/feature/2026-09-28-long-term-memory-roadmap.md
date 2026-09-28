# Agent Note: Long-term memory roadmap

Status: proposed

## Problem

Agents forget everything between sessions: who the user is, what worked in a repository or application, and which approaches failed. The payload that matters most is technical: the command, path, address, patch, or setting that made a tool work, and the outcome that proves it. The first three steps shipped as the `packages/memory/` family with MemOS as the provider ([implemented note](../../implemented/feature/2026-09-28-long-term-memory-memos.md)).

Testing the shipped steps exposed three gaps that shape the rest of the plan. Recall silently degrades: MemOS caps its own relevance filter inside the recall budget, and when that call times out the filter falls back to a mechanical cutoff that has kept a single hit in every affected recall. Capture and recall are turn-shaped, so a memory reaches the model as a one-line summary and the artifact a technique consists of stays behind `memory_get`. A session has memory only when a signed-in request created it, which excludes one-shot and headless CLI runs, the SDK, webhook ingress, ACP automation, and every external agent.

The remaining steps must keep Aeven the owner of the memory product while MemOS stays a replaceable engine, and every step after per-user scoping assumes memory belongs to one account.

## Decision

Build the rest in the order below. Each step is one PR, verified by `pnpm run typecheck` and a browser test against the running app; no unit tests and no Agent Note per step.

| # | Step | Scope |
|---|---|---|
| 1 | Memory API | `ctx.memory` Service Definition, scope, recall, capture, reads. Shipped. |
| 2a | MemOS provider | `@aeven/memory-memos`: in-process `MemoryCore`, local SQLite and embeddings, auxiliary LLM calls through `ctx.llm`, output-language rule. Shipped. |
| 3 | Lifecycle integration | `@aeven/memory-context` recall before each direct-user turn and capture at `turn/end`; `@aeven/tool-memory` tools. Shipped. |
| 2c | Per-user memory | Record the owning account on every session created through a signed-in request, and scope all memory by that account. A session without a known owner gets no memory. Shipped. |
| 2b | Memory operations | List, read, remember, edit, forget, and feedback on `ctx.memory`; per-message ratings from `message-feedback` feed the provider. Shipped. |
| 4 | Memory domains | Person, experience, world, and project scopes, with project memory keyed by workspace. Shipped. |
| 5 | Outcome capture | Retries, verification, corrections, and goal completion derived from logged facts, so a technique can be recalled together with the outcome that proves it. Shipped. |
| 6 | Recall reliability, then own ranking | Make recall dependable before making it clever, then take ranking and framing from MemOS. Ordered requirements below. |
| 7 | Skill learning | Crystallized experience proposes skill candidates to `ctx.skills`; promotion requires approval. |
| 8 | Skill confidence | Success, failure, and version statistics promote and revoke learned skills. |
| 9 | Aeven Memory Manager | The MemOS Memory Viewer becomes an Aeven-integrated memory manager: browse, search, edit, delete, and review learned knowledge. Where it lives in the app is decided when it is built. |
| 10 | Cloud sync | Sync logical per-user memory records, not the database file; machine-specific memory stays local. |
| 11 | Memory outside the GUI | Decide which entry points own a session: one-shot and headless `avn` runs, the SDK, webhook ingress, ACP automation, and work done by external agents such as Codex. Each either gains a configured owner or is documented as memory-free. |

### Step 6 in order

1. **Stop the silent degradation.** MemOS caps the relevance filter at `min(2000, remaining budget)`, so raising Aeven's recall budget cannot extend it; a timeout falls back to keeping hits scoring at least 70% of the top hit. Measured across 14 recalls, 3 burned the full cap and each kept exactly one hit, and in one case the survivor was a person fact unrelated to the query while the relevant `world` memory was dropped. MemOS lightweight mode forces the filter on even when `retrieval.llmFilterEnabled` is false; turn-start recall must bypass or replace it before any ranking work.
2. **Recall the artifact, not its summary.** A technique reaches the model as the command, path, address, port, patch, or setting that worked, with its outcome. Today the block carries MemOS's distilled summary line and the artifact is only reachable through `memory_get`.
3. **Sharpen the `world` rule.** A trace is filed by one model classification per turn, and an explanation given in conversation currently qualifies as knowledge: of the three `world` traces in the live store when this note was written, two are chat about Aeven's own memory design and one is a key binding recorded during testing.
4. **Then own ranking.** Aeven-owned ranking, deduplication, per-domain budgets, and framing of the recalled block.

### Technical knowledge is the first-class payload

- The memory worth keeping is reusable practice about tools, applications, and environments: the `world` and `experience` domains.
- A technique is only useful with its artifact and its outcome. A distilled sentence states the fact and drops what makes it actionable, so step 6 returns the artifact and step 5 records whether it worked.
- Recall must be dependable before it is clever. A missing person fact costs a question; a missing technique costs the session that needed it.
- Only material a later turn reuses belongs in memory. Commentary about Aeven's own design does not.

### Product rules for every step

- Memory belongs to one signed-in account. Nothing recalls, lists, or syncs memory across accounts.
- A session has memory only when a signed-in request created it. Sessions opened by the CLI, the SDK, webhook ingress, ACP, or an external agent have no owner until step 11 decides otherwise.
- Nothing user-facing or model-facing is MemOS-branded: tool names, prompts, recalled context, UI copy, titles, logos, and settings are Aeven's. Internal package names and the MIT license notice may name MemOS.
- The MemOS Viewer on a loopback port is a stopgap until step 9.

## Consequences

- Per-user scoping (2c) changes session creation, not only the memory packages, so sessions gain an owning account as well.
- Sessions created before 2c keep no owner and remain in a preset profile that no account reads: 222 of the 230 sessions on disk when this note was written, including the first session that controlled Ableton Live end to end. Nothing migrates them; their content exists for memory only once it is stated again in an owned session.
- The recall budget and the filter cap are separate. MemOS takes the smaller of its own 2-second cap and the remaining recall time, so `recallTimeoutMs` cannot buy the filter more than two seconds.
- Capture assigns one domain per turn, so a turn that mixes a technical fact with discussion of it lands in a single domain, and the classification is the only thing keeping conversation out of `world`.
