# 记忆

[English](memory.md) | 中文

服务声明见 [源代码](../../packages/memory/memory/src/index.ts)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memory"></a>

### `ctx.memory` — `Memory`

Slot holding the one memory provider of a Host composition.

```ts cordis-catalog
/**
 * Register the composition's memory provider; a second registration fails without replacing the first.
 * @param provider - implementation owned by the contributing fiber.
 * @returns idempotent disposer that empties the slot.
 */
register(provider: MemoryProvider): () => void

/**
 * Keep a contribution registered exactly while a provider is registered, so a composition
 * without a provider shows the model no memory tools or guidance.
 * @param setup - registers the contribution and returns its disposer; runs on each provider registration.
 * @returns disposer that stops watching and disposes a live contribution.
 */
whileActive(setup: () => () => void): () => void

/**
 * Retrieve memory relevant to a query within the request's hard budget.
 * @param request - query, scope, and foreground budget.
 * @returns ranked hits visible to the scope.
 */
recall(request: MemoryRecallRequest): Promise<MemoryRecall>

/**
 * Hand one completed turn to the provider for background learning.
 * @param turn - turn assembled from committed session events.
 */
capture(turn: MemoryTurn): void

/**
 * Release per-session provider state; resolves immediately while no provider is registered.
 * @param sessionId - session that is no longer live.
 * @returns after the provider released the session.
 */
async closeSession(sessionId: SessionId): Promise<void>

/**
 * Set a learned procedure's maturity.
 * @param request - account id, the procedure's memory id, and the new status.
 * @returns true when a procedure of the owner was updated.
 */
setProcedureStatus(request: Parameters<MemoryProvider['setProcedureStatus']>[0]): Promise<boolean>

/**
 * Domain one captured turn was filed under; undefined while no provider is registered.
 * @param request - the session and its turn number.
 * @returns the turn's domain, or undefined when the provider has none for it.
 */
async turnDomain(request: Parameters<MemoryProvider['turnDomain']>[0]): Promise<MemoryDomain | undefined>

/**
 * Read one memory item.
 * @param request - scope, item kind, and id.
 * @returns the item, or undefined when the scope holds no such item.
 */
detail(request: Parameters<MemoryProvider['detail']>[0]): Promise<MemoryDetail | undefined>

/**
 * Read the ordered traces of one episode.
 * @param request - scope, episode id, and maximum entry count.
 * @returns entries in capture order.
 */
timeline(request: Parameters<MemoryProvider['timeline']>[0]): Promise<readonly MemoryTimelineEntry[]>

/**
 * List learned environment models.
 * @param request - scope, optional keyword filter, and maximum count.
 * @returns at most `limit` models.
 */
environments(request: Parameters<MemoryProvider['environments']>[0]): Promise<readonly MemoryEnvironment[]>

/**
 * List crystallized skills.
 * @param request - scope, optional status filter, and maximum count.
 * @returns at most `limit` skills.
 */
skills(request: Parameters<MemoryProvider['skills']>[0]): Promise<readonly MemorySkill[]>

/**
 * Load one skill and record its selection for the session's current task.
 * @param request - scope, skill id, and the selecting tool call.
 * @returns the skill, or undefined when the scope holds no such skill.
 */
useSkill(request: Parameters<MemoryProvider['useSkill']>[0]): Promise<MemorySkill | undefined>

/**
 * List the owner's memories, newest first.
 * @param request - scope, optional text query, and page bounds.
 * @returns one page and the total match count.
 */
list(request: Parameters<MemoryProvider['list']>[0]): Promise<MemoryPage>

/**
 * List every learned procedure of the owner, newest first. Copies stored under one name are all listed.
 * @param request - owner, the workspace whose sessions may see them, and cancellation.
 * @returns the procedures.
 */
async procedures(request: LearnedProceduresRequest): Promise<LearnedProcedure[]>

/**
 * Store one fact the user explicitly asked to be remembered.
 * @param request - scope and the fact in the user's words.
 * @returns the stored memory's id.
 */
remember(request: Parameters<MemoryProvider['remember']>[0]): Promise<MemoryItemId>

/**
 * Import already-distilled facts verbatim in one atomic batch, skipping facts the owner's memory already holds.
 * @param request - owning scope, ordered facts with their original time when known, their domain, and cancellation.
 * @returns ids of the facts written, in input order, and how many were skipped; rejects without writing any fact
 * on failure.
 */
rememberMany(request: Parameters<MemoryProvider['rememberMany']>[0]): Promise<{ readonly ids: readonly MemoryItemId[]; readonly skipped: number }>

/**
 * Replace the summary of one of the owner's memories.
 * @param request - scope, memory id, and the corrected summary.
 * @returns the updated memory, or undefined when the owner has no such memory.
 */
edit(request: Parameters<MemoryProvider['edit']>[0]): Promise<MemoryRecord | undefined>

/**
 * Delete one of the owner's memories.
 * @param request - scope and memory id.
 * @returns true when a memory of this owner was deleted.
 */
forget(request: Parameters<MemoryProvider['forget']>[0]): Promise<boolean>

/**
 * Record a human judgment about one captured turn.
 * @param request - scope, turn number, polarity, and optional note.
 * @returns true when the judgment was recorded.
 */
feedback(request: Parameters<MemoryProvider['feedback']>[0]): Promise<boolean>
```

Types: [SessionId](core.zh.md)

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)

<a id="ctxmemorymanagercontroller--memorymanagercontroller"></a>

### `ctx.memoryManagerController` — `MemoryManagerController`

The signed-in user's memories, standing facts, and learned procedures.

```ts cordis-catalog
/**
 * List the caller's memories, newest first.
 * @param request - optional text and domain filters, and page bounds.
 * @returns the page, or `available: false` when no memory provider runs.
 */
@Remote async memories(request: ManagedMemoryQuery): Promise<ManagedMemoryPage>

/**
 * Replace the summary of one of the caller's memories.
 * @param id - memory id.
 * @param summary - corrected summary.
 * @returns the updated memory, or undefined when the caller has no such memory.
 */
@Remote async editMemory(id: MemoryItemId, summary: string): Promise<ManagedMemory | undefined>

/**
 * Delete one of the caller's memories.
 * @param id - memory id.
 * @returns true when a memory of the caller was deleted.
 */
@Remote forgetMemory(id: MemoryItemId): Promise<boolean>

/**
 * List the statements the caller confirmed as always true, with the budget they render under.
 * @returns the document, or `available: false` when this Host serves none.
 */
@Remote invariants(): ManagedInvariantsPage

/**
 * Promote one statement into every request of the caller. Promoting a statement that already stands refreshes
 * how current it is instead of spending the block twice.
 * @param text - the statement the caller confirmed.
 * @returns what changed, with the reason when the block has no room for the statement.
 */
@Remote addInvariant(text: string): ManagedInvariantChange

/**
 * Replace the text of one of the caller's standing facts, keeping its place in the block.
 * @param id - identifier of the statement to replace.
 * @param text - the replacement statement.
 * @returns what changed, with the reason when the id or the text was refused.
 */
@Remote editInvariant(id: InvariantId, text: string): ManagedInvariantChange

/**
 * Drop one of the caller's standing facts, which frees its share of the block.
 * @param id - identifier of the statement to drop.
 * @returns what changed, with the reason when the caller has no such statement.
 */
@Remote removeInvariant(id: InvariantId): ManagedInvariantChange

/**
 * List the caller's learned procedures, newest first, one per name.
 * @returns the procedures without their text, or `available: false` when no memory provider runs.
 */
@Remote async procedures(): Promise<ManagedProceduresPage>

/**
 * Read one of the caller's learned procedures with its condensed and full text.
 * @param id - memory id of the procedure.
 * @returns the procedure, or undefined when the caller has no such procedure.
 */
@Remote async procedure(id: MemoryItemId): Promise<ManagedProcedureDetail | undefined>

/**
 * Replace the condensed procedure memory recall delivers for one of the caller's learned procedures.
 * @param id - memory id of the procedure.
 * @param summary - the corrected condensed procedure, without the procedure's name.
 * @returns the updated procedure, or undefined when the caller has no such procedure.
 */
@Remote async editProcedure(id: MemoryItemId, summary: string): Promise<ManagedProcedureDetail | undefined>
```

Source: [`packages/memory/api-memory-manager/src/index.ts`](../../packages/memory/api-memory-manager/src/index.ts)
<!-- END GENERATED cordis-surface -->
