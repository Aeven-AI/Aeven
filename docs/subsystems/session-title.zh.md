# 会话标题

[English](session-title.md) | 中文

[`@aeven/session-title`](../../packages/session/session-title) 所拥有的持久、后写覆盖的标题状态与可选异步提供方词汇。共享 LLM（大语言模型）辅助组件负责精确的辅助请求记录。各包 README 负责时序、回退、失败与 fork 行为；生成的[持久化日志事件目录](../persistence-catalog.zh.md)负责完整的事件声明。

源码：[`packages/session/session-title/src/index.ts`](../../packages/session/session-title/src/index.ts)、[`packages/session/session-title-llm/src/index.ts`](../../packages/session/session-title-llm/src/index.ts)

## 持久标题状态

提供方生成修订时会记录 `SessionTitleProviderId`。`SessionTitleEventData` 列出生成标题时使用的精确人类消息 seq，`SessionTitleSnapshot` 则加入 `ctx.sessionTitle.get()` 与 `foldSessionTitle()` 返回的持久事件封装信息。`title` 投影的版本 1 状态与客户端视图都只保留标题字符串或 `null`，因此既有持久化缓存行仍可读取。

```ts type-equiv
/** Identifies one session-title provider registration. */
type SessionTitleProviderId = Branded<'SessionTitleProviderId'>
```

```ts type-equiv
/** Exact auxiliary model route that produced a title. */
interface SessionTitleModelProvenance {
  /** Registered LLM provider route. */
  readonly provider: string
  /** Provider model id. */
  readonly model: string
}
```

```ts type-equiv
/** Durable ownership record for an accepted session title. */
type SessionTitleSource =
  | { readonly kind: 'fallback' }
  | {
    readonly kind: 'provider'
    readonly provider: SessionTitleProviderId
    readonly model?: SessionTitleModelProvenance
  }
  | {
    /** Explicit user rename: pins the title — automatic generation stops scheduling. */
    readonly kind: 'user'
  }
```

```ts type-equiv
/** Payload of the log-only `session/title` event. */
interface SessionTitleEventData {
  /** Normalized non-empty title text. */
  readonly title: string
  /** Exact human `user/message` seqs used to derive this title; empty for an explicit user rename. */
  readonly messageSeqs: SessionSeq[]
  /** Whether the built-in fallback, a registered provider, or the user supplied the title. */
  readonly source: SessionTitleSource
}
```

```ts type-equiv
/** Latest folded title plus the title event's durable envelope facts. */
interface SessionTitleSnapshot extends SessionTitleEventData {
  /** Seq of the latest `session/title` event. */
  readonly eventSeq: SessionSeq
  /** Timestamp of the latest `session/title` event. */
  readonly updatedAt: number
}
```

## 辅助请求记录

共享 LLM 辅助组件会在调用模型前，记录每一项已经过验证且可分发的标题请求。即使后续生成失败，载荷仍会复现模型可见的系统输入与消息输入、路由、输出上限、提供方归属和源消息归因。

```ts type-equiv
/** Exact model-visible request recorded before one auxiliary title dispatch. */
interface SessionTitleLlmRequestEventData {
  /** Registered title-provider identity responsible for the request. */
  readonly titleProvider: SessionTitleProviderId
  /** Exact human `user/message` seqs represented in `messages`. */
  readonly messageSeqs: SessionSeq[]
  /** Exact auxiliary LLM route. */
  readonly route: SessionTitleModelProvenance
  /** Exact auxiliary system prompt. */
  readonly system: string
  /** Exact auxiliary message list. */
  readonly messages: Message[]
  /** Exact auxiliary output-token cap. */
  readonly maxTokens: number
}
```

## 提供方输入与输出

服务会对截至某一修订的合格消息创建快照。提供方返回的 seq 仅可来自该请求；由服务负责的接纳流程会验证顺序、规范化标题、强制执行字节上限，并追加标题及其来源消息 seq 和来源类型。

```ts type-equiv
/** One eligible human title input exposed to title providers. */
interface SessionTitleUserMessage {
  /** Source `user/message` event seq. */
  readonly seq: SessionSeq
  /** Concatenated text blocks, or `Image` for an image-only prompt. */
  readonly text: string
}
```

```ts type-equiv
/** Automatic generation cadence owned by a registered provider. */
type SessionTitleAutomaticMode = 'first-prompt' | 'all-prompts'
```

```ts type-equiv
/** Immutable input supplied to one title-provider call. */
interface SessionTitleProviderRequest {
  /** Live session being titled. */
  readonly session: Session
  /** All eligible human messages through this generation revision. */
  readonly messages: readonly SessionTitleUserMessage[]
  /** Exact current logged main-request route, when one has been recorded. */
  readonly route?: SessionTitleModelProvenance
  /** Cancellation for supersession, disposal, timeout composition, or the explicit caller. */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/** Provider output before service-owned normalization and log acceptance. */
interface SessionTitleProviderResult {
  /** Proposed title text. */
  readonly title: string
  /** Exact seqs from `request.messages` used by this result. */
  readonly messageSeqs: readonly SessionSeq[]
  /** Auxiliary LLM route, when generation used a model. */
  readonly model?: SessionTitleModelProvenance
}
```

```ts type-equiv
/** One optional asynchronous title implementation registered with the service. */
interface SessionTitleProvider {
  /** Stable id of the provider recorded with the title. */
  readonly id: SessionTitleProviderId
  /** When new human prompts start automatic generation. */
  readonly automatic: SessionTitleAutomaticMode
  /**
   * Produce one title revision.
   * @param request - message snapshot, current route, session, and cancellation.
   * @returns proposed title plus exact input seqs and the optional provider/model route used to generate it.
   */
  generate(request: SessionTitleProviderRequest): Promise<SessionTitleProviderResult>
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessiontitle--sessiontitleservice"></a>

### `ctx.sessionTitle` — `SessionTitleService`

Log-backed title fold plus asynchronous fallback generation.

```ts cordis-catalog
/**
 * Read the latest folded title from one live or replayed session.
 * @param session - session whose log is the title source of truth.
 * @returns latest title snapshot, or `undefined` before eligible input.
 */
get(session: Session): SessionTitleSnapshot | undefined

/**
 * Accept an explicit user title. Appends a `session/title` event with the
 * `user` source, which pins the title: in-flight automatic generation is
 * superseded and later user messages schedule none (an explicit
 * {@link SessionTitleService.refresh} remains the deliberate unpin).
 * @param session - exact live session to rename.
 * @param title - raw user input; normalized before acceptance.
 * @returns the accepted title snapshot.
 * @throws {SessionTitleInvalidError} when the title normalizes to empty.
 * @throws {Error} when the session is not live or the service is disposed.
 */
rename(session: Session, title: string): SessionTitleSnapshot

/**
 * Explicitly retry the registered provider, or materialize the built-in
 * fallback when no provider is registered.
 * @param session - exact live session to refresh.
 * @param signal - optional caller cancellation.
 * @returns latest accepted title, or `undefined` when no eligible input exists.
 */
async refresh(session: Session, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined>

/**
 * Register the sole optional title provider. Disposal aborts its pending and
 * active work before another provider may register.
 * @param provider - provider identity, cadence, and generation function.
 * @returns exact Cordis effect disposer, which settles after active calls quiesce.
 */
register(provider: SessionTitleProvider): () => Promise<void>
```

Types: [Session](session.zh.md)

Source: [`packages/session/session-title/src/index.ts`](../../packages/session/session-title/src/index.ts)

<a id="ctxworkingdirectory--workingdirectoryservice"></a>

### `ctx.workingDirectory` — `WorkingDirectoryService`

Directory resolution and change for one session.

```ts cordis-catalog
/**
 * The directory pair in force for a session on this device.
 * @param session - the session to resolve.
 * @returns the local directory and workspace root, why this device has none,
 *   or the fact that the session records no directory at all.
 */
local(session: Session): LocalDirectory

/**
 * The directory in force for a session on this device.
 * @param session - the session whose tool calls resolve paths against it.
 * @returns the local directory, or undefined when this device has none — read
 *   {@link local} to tell a refusal from a session that records none.
 */
of(session: Session): string | undefined

/**
 * The workspace root in force for a session on this device: the directory
 * sandboxed writes are confined to.
 * @param session - the session to resolve.
 * @returns the local root, or undefined when this device has none.
 */
rootOf(session: Session): string | undefined

/**
 * Resolve a path the way the tools do, without touching the filesystem.
 * @param session - the session supplying the base directory.
 * @param path - absolute, or relative to {@link of}.
 * @returns the normalized absolute path.
 * @throws {WorkingDirectoryUnavailableError} when this device has no directory
 *   for a session that records one, so a relative path cannot resolve here.
 * @throws when the session records no directory at all and `path` is relative.
 */
resolve(session: Session, path: string): string

/**
 * Move the session into a directory and record it in the log. The
 * workspace root stays where it is.
 *
 * The directory must already exist: this changes where later calls run, it
 * does not create directories. A relative target resolves against the current
 * directory, so successive changes compose the way a shell's `cd` does.
 * @param session - the session to move.
 * @param target - absolute, or relative to the current directory.
 * @returns the absolute directory now in force.
 * @throws when the target is empty, missing, or not a directory.
 */
async change(session: Session, target: string): Promise<string>

/**
 * Move the session into another workspace: the directory becomes both the
 * working directory and the root sandboxed writes are confined to.
 * @param session - the session to move.
 * @param target - absolute, or relative to the current directory.
 * @returns the absolute directory now in force.
 * @throws when the target is empty, missing, or not a directory.
 */
async enter(session: Session, target: string): Promise<string>

/**
 * {@link enter} for a directory the caller has just created and checked, in
 * a window that cannot await — a child agent's creation setup.
 * @param session - the session to move.
 * @param path - absolute path of an existing directory.
 */
enterVerified(session: Session, path: string): void

/**
 * Start a child session where its parent works: copy the parent's logged
 * directory and workspace root onto the child's log. A parent still in its
 * header directory leaves the child on its own header.
 *
 * A parent working through this device's workspace binding has no portable
 * directory to copy: the child's own header already names this device's
 * directory, and copying the parent's recorded path would carry another
 * machine's spelling into the child's synced log.
 * @param child - the child session, inside its creation window.
 * @param parent - the delegating session.
 */
inherit(child: Session, parent: Session): void
```

Types: [Session](session.zh.md)

Source: [`packages/session/working-directory/src/index.ts`](../../packages/session/working-directory/src/index.ts)

<a id="ctxworktrees--worktrees"></a>

### `ctx.worktrees` — `Worktrees`

The git worktree service, registered as `ctx.worktrees`.

```ts cordis-catalog
/**
 * Registered checkouts of the session's repository, main working tree first.
 * @param session - the session whose repository is listed.
 * @param signal - cancels the git call.
 * @returns one entry per registered worktree.
 */
async list(session: Session, signal?: AbortSignal): Promise<WorktreeInfo[]>

/**
 * Create a branch-backed checkout and move the session into it.
 * @param session - the session that will work in the new checkout.
 * @param request - optional name and starting revision.
 * @param signal - cancels the git and setup calls.
 * @returns the checkout path, its branch, its base commit, the repository root, and the setup outcome.
 */
async create(session: Session, request: CreateWorktreeRequest = {}, signal?: AbortSignal): Promise<CreatedWorktree>

/**
 * Create a checkout for a delegated child from a snapshot of the parent's
 * working tree, and record it on the parent's log. The child moves in
 * through {@link adopt} while it is composed.
 * @param parent - the delegating session.
 * @param child - the child session the checkout is for.
 * @param signal - cancels the git and setup calls.
 * @returns the checkout, or undefined when isolation is off, or the parent
 *   works outside a git repository or in one without commits.
 */
async isolate(parent: Session, child: SessionId, signal?: AbortSignal): Promise<CreatedWorktree | undefined>

/**
 * Move a child session into the checkout {@link isolate} created for it.
 * @param child - the child session, inside its creation window.
 * @param worktree - the checkout created for it.
 */
adopt(child: Session, worktree: CreatedWorktree): void

/**
 * Remove a checkout and optionally its branch. When the session works in
 * the checkout, it moves back to the repository's main working tree first.
 * @param session - the session removing the checkout.
 * @param name - checkout name; omit for the checkout the session works in.
 * @param options - `deleteBranch` deletes the branch when it is merged into the main working tree's HEAD.
 * @param signal - cancels the git calls.
 * @returns what was removed and where the session works afterwards.
 * @throws when the checkout has uncommitted changes, or the branch is unmerged.
 */
async remove( session: Session, name: string | undefined, options: { deleteBranch: boolean }, signal?: AbortSignal, ): Promise<RemovedWorktree>
```

Types: [Session](session.zh.md) · [SessionId](core.zh.md)

Source: [`packages/session/worktrees/src/index.ts`](../../packages/session/worktrees/src/index.ts)
<!-- END GENERATED cordis-surface -->
