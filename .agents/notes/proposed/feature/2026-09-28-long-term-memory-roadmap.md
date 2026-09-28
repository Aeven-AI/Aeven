# Agent Note: Long-term memory roadmap

Status: proposed

## Problem

Agents forget everything between sessions: who the user is, what worked in a repository or application, and which approaches failed. The payload that matters most is technical: the command, path, address, patch, or setting that made a tool work, and the outcome that proves it. PR1–5 shipped the `packages/memory/` family with MemOS as the provider, per-user scopes, domains, and outcome evidence ([implemented note](../../implemented/feature/2026-09-28-long-term-memory-memos.md)).

Testing the shipped steps exposed three gaps that shape the rest of the plan. MemOS's relevance filter can silently reduce recall to one hit; PR6 bypasses it for automatic recall and explicit searches. Earlier recall delivered a one-line summary instead of the artifact a technique consists of; PR6 returns the stored artifact and outcome under Aeven's final selection. A session has memory only when a signed-in request created it, which excludes one-shot and headless CLI runs, the SDK, webhook ingress, ACP automation, and every external agent.

The remaining steps must keep Aeven the owner of knowledge and learned procedures while MemOS stays a replaceable memory engine. The existing skill catalog already publishes summaries and loads full instructions on demand, so learned capabilities should join that path rather than create a second model-facing loader.

## Decision

Build the rest in the order below. Each step is one PR, verified by `pnpm run typecheck`, `pnpm run build`, and a browser test against the running app; do not run unit tests for this sequence. Aeven owns the durable knowledge and capability records, the model-facing context, and promotion decisions. MemOS supplies memory candidates and learning signals; `ctx.skills` supplies the existing catalog and loader for executable instructions. Add a package only when a concrete service and consumer need it.

| # | Step | Scope |
|---|---|---|
| 1 | Memory API | `ctx.memory` Service Definition, scope, recall, capture, reads. Shipped. |
| 2a | MemOS provider | `@aeven/memory-memos`: in-process `MemoryCore`, local SQLite and embeddings, auxiliary LLM calls through `ctx.llm`, output-language rule. Shipped. |
| 3 | Lifecycle integration | `@aeven/memory-context` recall before each direct-user turn and capture at `turn/end`; `@aeven/tool-memory` tools. Shipped. |
| 2c | Per-user memory | Record the owning account on every session created through a signed-in request, and scope all memory by that account. A session without a known owner gets no memory. Shipped. |
| 2b | Memory operations | List, read, remember, edit, forget, and feedback on `ctx.memory`; per-message ratings from `message-feedback` feed the provider. Shipped. |
| 4 | Memory domains | Person, experience, world, and project scopes, with project memory keyed by workspace. Shipped. |
| 5 | Outcome capture | Retries, verification, corrections, and goal completion derived from logged facts, so a technique can be recalled together with the outcome that proves it. Shipped. |
| 6 | Aeven Context Builder | Make automatic and explicit recall dependable; assemble bounded, source-labelled technical knowledge and personal context from the existing services. Implemented and browser-verified. |
| 7 | Capability learning | Create Aeven-owned capability candidates from explicit requests and reusable task evidence; publish approved executable instructions through `ctx.skills`. Shipped ([note](../../implemented/feature/2026-09-29-capability-learning.md)); proposals from recorded evidence remain. |
| 8 | Capability lifecycle | Track versions, executions, validation, evidence-based status, degradation, and retirement. Shipped ([note](../../implemented/feature/2026-09-29-capability-lifecycle.md)). |
| 9 | What Aeven Has Learned | Shipped: Settings → Memory (`api-memory-manager` + `client-ui-settings-memory`) with About you, Projects, Knowledge, and Capabilities tabs and View, Correct, and Forget actions. |
| 10 | Aeven Layer portability | Sync owner-scoped logical knowledge and capability records; keep raw execution traces local by default. |
| 11 | Memory outside the GUI | Decide which entry points own a session: one-shot and headless `avn` runs, the SDK, webhook ingress, ACP automation, and external agents. Each gains a configured owner or is documented as memory-free. |
| 12 | Capability composition | Let one capability invoke another and propose a composite candidate after a validated execution. |
| 13 | Organizational scope | Later: team and organization ownership, review, distribution, and sovereign deployment. |

### PR6: Aeven Context Builder

1. **Make recall dependable.** MemOS caps its relevance filter at two seconds and may fall back to one hit; lightweight mode forces the filter on even when `retrieval.llmFilterEnabled` is false. Automatic recall and explicit `memory_search` request unfiltered candidates through MemOS's turn-start path. Both include trace reads within their configured deadlines; explicit search retains its configured per-tier limits.
2. **Assemble distinct sources without duplicating the session.** Use the existing `memory-context` consumer and durable session events to frame person facts, workspace knowledge, reusable technical knowledge, and experience or policies. Each source has provenance and its own item budget within the total block. Identity comes from the session owner; recent task context already comes from the session log. Neither needs a second memory copy.
3. **Recall the artifact with its outcome.** Technical traces carry the stored tool input, output, assistant answer, and outcome label. Assistant-reported verification is identified as a report, not independent proof. A new-session browser check recalled the exact Node version command and stdout with the `Assistant reported verification` label without calling a tool.
4. **Own final selection.** Aeven orders candidates by summary relevance before long tool text, deduplicates exact snippets, limits each domain, and frames the injected block. The `world` classifier requires reusable operations or facts rather than discussion of Aeven's own design. Correction-tagged traces stay searchable as history and do not enter automatic recall without a recorded referent. A browser check retrieved a relevant `world` trace while temporary correction instructions stayed out of the automatic block.

PR6 does not add an empty `aeven-layer/` package or a placeholder capability section. The existing skill catalog already offers progressive disclosure; PR7 can make approved learned capabilities available through it. Every new model-visible item must be reconstructable from the session log.

### PR7–8: learning and evidence

Three rules hold for every capability step. **Complex learning, simple capability:** the executable artifact is an agentskills `SKILL.md` with supporting files, and Aeven metadata stays beside it. **Remember immediately, trust gradually:** anything learned is kept at once as a candidate; confirmation makes it executable, and evidence decides trust, never whether it is remembered. **Execution never depends on memory:** capabilities live in Aeven's registry, and the memory provider only helps find and propose them.

PR7 creates a durable `CapabilityCandidate` owned by Aeven, with intent, description, procedure, required tools and permissions, scope, supporting artifacts, validation and recovery instructions, provenance, and evidence. A direct request such as “learn this workflow” is a strong signal; repeated discovery, retries followed by success, corrections, and modifications to an existing procedure can also propose candidates. Automatic proposals require review before they become invocable. The executable representation is an adapter to the existing skill service, not the source record. Inspect Hermes's explicit capture and supporting-artifact workflow before finalizing this PR, while keeping Aeven's approval and provenance rules.

PR8 associates each capability version with execution records: model, environment, timestamps, tools, retries, corrections, validation result, outcome, and token or monetary cost when measured. Status follows evidence through candidate, learned, trusted, needs-validation, degraded, and retired; an application or environment change can require validation before reuse. A model-generated confidence number alone never promotes a capability. Compare before and after runs only with comparable tasks and measured costs.

### PR9–13: product and reach

PR9 presents “About you,” “Spaces,” and “Learned capabilities” with status, provenance, use history, and View, Correct, and Forget actions. The MemOS Viewer remains a development stopgap. PR10 syncs owner-scoped logical knowledge, capability versions, policies, corrections, spaces, and selected environment metadata; raw local tool traces do not sync by default. PR11 resolves ownership for CLI, SDK, webhook, ACP, and external-agent sessions before claiming memory works outside the signed-in GUI. PR12 adds capability composition after individual capability execution and validation exist. PR13 introduces team and organization scope with separate authority and approval rules; do not implement those scopes in PR6.

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
