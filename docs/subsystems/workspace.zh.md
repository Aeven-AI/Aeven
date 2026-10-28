# 工作区

[English](workspace.md) | 中文

工作区（workspace）是用户工作目录的持久记录：一个建立在规范路径之上的稳定 id、一个显示标题，以及归属于它的会话的有序账本。该子系统是单个包（package）（[avn-workspace](../../packages/workspace/workspace)，`ctx.workspaceRegistry`）——一项宿主侧可选能力，不属于 agent loop（智能体循环）主干，并且对模型不可见（没有工具、没有提示词文本、没有会话事件）。它通过[存储领域数据形式](storage.zh.md)存储自己的记录，并对照 [`SessionHeader.cwd`](persistence.zh.md#sessionheader--metadata-beside-the-log) 校验会话成员资格，因此 `storageDomain` 与 `sessionPersistence` 是必需的启动依赖：持久化这一依赖不可用时，插件保持 pending，而不是把这种不可用误当作空历史。设计记录：[领域 KV 存储 Agent Note（agent 决策记录）](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)；引导与 GUI 顺序：[Workspace UI 产品流程 Agent Note](../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.zh.md)。

源码：[`packages/workspace/workspace/src/types.ts`](../../packages/workspace/workspace/src/types.ts)

## 标识

```ts type-equiv
/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
type WorkspaceId = Branded<'WorkspaceId'>
```

`WorkspaceId` 是[品牌化 id](core.zh.md#branded-ids)。路径标识与之分离：`realpathNormalize`（`fs.realpath`；尾部斜杠、`..` 与符号链接全部解析）是唯一的一套唯一性规范——工作区路径以规范化形式存储，唯一性即规范路径的字符串相等（指向已被拥有目录的符号链接会与之冲突），attach 时的会话 cwd 检查也走同一套规范。

## 工作区实体

消费方只看到 `Workspace` 接口；实现保持包内私有。

```ts type-equiv
/**
 * One workspace: a stable id over a filesystem binding, a display title, and an
 * ordered candidate account of sessions. Membership requires an id on that
 * account, plus agreement between the session's location and the workspace's:
 * a `folder` workspace also demands a session header whose canonical cwd equals
 * the workspace path, while a workspace with no directory demands a session
 * that records no cwd either. Consumers only see this interface; the
 * implementation stays private.
 */
interface Workspace {
  /** Stable record id (generated uuid). */
  readonly id: WorkspaceId

  /**
   * Whether this is the registry's built-in workspace: the one registration the
   * product guarantees a reader has, pinned at the head of the order and
   * refusing delete, rename, and move. Consumers render it as a fixed part of
   * the product rather than as a registration the reader owns, which is why the
   * bit travels outward as a fact instead of being inferred from an id or title.
   */
  readonly isDefault: boolean

  /**
   * Whether this registration is fixed product structure: the default
   * workspace, or a pathless workspace a plugin declared through
   * `WorkspaceRegistry.builtIn`. A built-in workspace refuses delete, rename,
   * and move, and every account can reach it.
   */
  readonly isBuiltIn: boolean

  /**
   * How this workspace binds to a filesystem location. Consumers that need a
   * directory must narrow on `'folder'` (see `isFolderWorkspace`) rather than
   * assume {@link path} is present.
   */
  readonly kind: WorkspaceKind

  /**
   * Canonical directory path: the `fs.realpath` of the path given at create
   * time (trailing slashes, `..`, and symlinks all resolved). Present exactly
   * when {@link kind} is `'folder'`; a `virtual` or `remote` workspace has no
   * local directory and is always `undefined` here. Never rewritten
   * afterwards, even when the directory disappears (see {@link status}).
   */
  readonly path: string | undefined

  /** Display title. Defaults to the final path segment, or a filesystem root's own spelling; duplicates are allowed. */
  readonly title: string

  /**
   * Account id of the signed-in user who created this workspace, absent when
   * nobody was signed in. A record written before workspaces carried an owner
   * answers with the one account all its sessions belong to, and with none when
   * they belong to several. One Host serves several accounts, and a workspace is
   * reachable only by its owner; the built-in workspace is the product's own
   * and is reachable by every account.
   */
  readonly owner: string | undefined

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Header-validated sessions in manually owned order: a new session is
   * prepended at attach, explicit reordering goes through
   * `insertSessionBefore`, and activity never reorders. The durable candidate
   * account is filtered synchronously for a folder workspace — missing
   * headers, invalid cwd values, and canonical cwd mismatches are never
   * returned — while a workspace with no directory binding has no such fact to
   * check and returns its account verbatim. A subsequent workspace mutation
   * prunes those filtered candidates durably.
   */
  readonly sessionIds: readonly SessionId[]

  /**
   * Replace the display title durably.
   * @param title - New title; any string, duplicates across workspaces allowed.
   * @returns resolution after durability.
   */
  setTitle(title: string): Promise<void>

  /**
   * Prepend a session to this workspace's candidate account. An already
   * accounted id resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs. Otherwise the
   * candidate must agree with the workspace's own location: for a folder
   * workspace its live or persisted header cwd must resolve to an existing
   * directory equal to {@link path}, and for a workspace with no directory it
   * must record no cwd at all — a machine-local path inside a record expected
   * to travel between machines is refused rather than tolerated. Unknown ids,
   * missing or invalid cwd values, and mismatches reject without writing.
   * @param sessionId - The session to record.
   * @returns resolution after durability.
   */
  attachSession(sessionId: SessionId): Promise<void>

  /**
   * Move an accounted session within the manual order, DOM-insertBefore-like:
   * with an anchor the session lands before it, without one it appends to the
   * end. Only the moved id changes position. A session or anchor absent from
   * the account rejects without writing; a move to the current position
   * resolves without writing, aside from the durable filtered-candidate
   * prune every accepted mutation performs; decided on the domain write
   * chain.
   * @param sessionId - The accounted session to move.
   * @param beforeSessionId - Accounted anchor to insert before; omitted appends.
   * @returns resolution after durability.
   */
  insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>

  /**
   * Remove a session from this workspace's account. Idempotent: an id not on
   * the account resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs; decided on
   * the domain write chain like attach. Never touches the session's own stored log.
   * @param sessionId - The session to remove.
   * @returns resolution after durability.
   */
  detachSession(sessionId: SessionId): Promise<void>

  /**
   * Live directory check, uncached: whether {@link path} currently exists and
   * is a directory. A missing directory never mutates the record — the
   * directory may only be temporarily moved. A workspace with no directory
   * binding is always `'ok'`: it makes no filesystem claim to check.
   * @returns `'ok'` when the directory exists, `'missing-dir'` otherwise.
   */
  status(): Promise<'ok' | 'missing-dir'>
}
```

所有权的真源是记录中有序的 `sessionIds`，绝不从会话 cwd 派生——但成员资格要求两者同时成立：账本上有其 id，且 header 的规范 cwd 等于工作区路径，因此一个会话在结构上至多属于一个工作区。失败的写入会拒绝（`insertSessionBefore` 的账本错误以 `WorkspaceMoveInvalidError` 拒绝，存储失败以普通错误拒绝）；每次被接受的变更都盖上 `updatedAt` 时间戳，并持久修剪不再通过成员资格检查的候选项。

## 注册表：`ctx.workspaceRegistry`

`WorkspaceRegistry`（[签名](#ctxworkspaceregistry--workspaceregistry)）拥有注册与解析。`create(path, title?)` 要求完全限定路径并将其规范化，拒绝不存在的路径（原样传出原始 `ENOENT`）或非目录；当规范路径已被拥有时原样返回既有实体；否则创建一条标题为 `title ?? defaultWorkspaceTitle(path)` 的记录并放到持久注册表顺序中内置 workspace 的正下方，而后者守住首位、拒绝任何移动（不同规范路径可以共享同一显示标题，没有最终路径段时使用根路径拼写）。`get(id)` 与有序的 `list()` 是同步缓存读取；`resolveByPath(path)` 应用同一套完全限定 realpath 规范但不创建。`delete(id)` 只移除注册记录、顺序条目和会话账本——目录、用户文件、实时会话和已持久化日志一概不动，被删除工作区的会话在把它移出顺序的同一次状态写入中加入归档集合（[决策](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.zh.md)）；未知 id 返回 `false`。create 与 delete 会在其两次写入（记录 + 顺序）可能分叉之前先持久写入一个待定变更标记；启动时恰好解决被标记的那次变更——通过删除被标记的表行：这会补完被中断的 delete，并回滚被中断的 create（注册可以重建，因此回滚是安全方向）——而没有标记的顺序/表不一致则作为损坏大声失败。

会话的 cwd 在创建时由创建者赋予，而不是由本注册表赋予——API 网关从所选工作区的 `path` 解析新会话的 cwd（回退到显式或默认 cwd），先创建会话使 cwd 落入其不可变的 [`SessionHeader`](persistence.zh.md#sessionheader--metadata-beside-the-log)，再调用 `attachSession`，后者会把已存储的 header cwd 与工作区路径重新校验一遍。首次成功启动时，注册表仅凭已持久化的 header（`id`、`cwd`、`createdAt`——绝不读事件正文）引导历史：把规范 cwd 有效的会话按目录分组为工作区，最新的排在最前；「已初始化」标记最后写入，因此被中断的引导可以安全续跑。引导只发生这一次：没有 cwd 的历史遗留会话保持 Ungrouped，此后创建的会话只能通过 `attachSession` 加入工作区。

## 消费方

[`avn-workspace-controller`](../../packages/api/workspace-controller) 经 `ctx.workspaceRegistry` 向 GUI 客户端提供工作区 CRUD，[`avn-session-controller`](../../packages/api/session-controller) 执行上文「先建会话再 attach」的流程。[avn-agent-instructions](../../packages/context/agent-instructions) 尽管名字如此，却**不是**消费方：它在 agent 自己的 cwd 下发现 AGENTS.md 风格的指令文件，从不触碰 `ctx.workspaceRegistry`——两者共用的这个词指的是用户的工作目录，而非本注册表的实体。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdirectorypicker--directorypicker-abstract-seam"></a>

### `ctx.directoryPicker` — `DirectoryPicker` (abstract seam)

Abstract directory-picking service. Subclass, implement `capability()`, and load the subclass as a plugin — it registers as `ctx.directoryPicker` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior). The capability object must be stable for the service lifetime: consumers may capture it across calls.

```ts cordis-catalog
/**
 * The backend's interaction capability.
 * @returns the discriminated capability consumers switch on.
 */
abstract capability(): DirectoryPickerCapability
```

Source: [`packages/host/directory-picker/src/index.ts`](../../packages/host/directory-picker/src/index.ts)

<a id="ctxdirectorypickercontroller--directorypickercontroller"></a>

### `ctx.directoryPickerController` — `DirectoryPickerController`

Host service backing the generated `ctx.remote.directoryPicker` namespace. The seam it exports is abstract and therefore never a Loader entry of its own, so this controller carries the wire verbs: one composed backend serves either the native chooser or the browse primitives, and a verb the composition cannot serve is refused rather than approximated.

```ts cordis-catalog
/**
 * Open the host's OS chooser for a Remote caller.
 * @param signal - caller lifetime; abort terminates the chooser.
 * @returns the chosen absolute path, or null when the operator cancels.
 */
@Remote('pick') async pick(signal: AbortSignal): Promise<string | null>

/**
 * List one directory level for a Remote caller's in-app browser.
 * @param path - absolute directory to list; absent lists the home directory.
 * @param signal - caller lifetime; abort stops the backend's scan instead of
 *   letting it outlive a disconnected caller.
 * @returns the level's listing with its ancestry.
 */
@Remote('list') async list(path: string | undefined, signal: AbortSignal): Promise<DirectoryListing>

/**
 * Create one child directory for a Remote caller's in-app browser.
 * @param path - absolute existing parent directory.
 * @param name - single non-blank path segment.
 * @returns the created directory's absolute path.
 */
@Remote('createDirectory') async createDirectory(path: string, name: string): Promise<string>
```

Source: [`packages/api/workspace-controller/src/directory-picker.ts`](../../packages/api/workspace-controller/src/directory-picker.ts)

<a id="ctxworkspacecontroller--workspacecontroller"></a>

### `ctx.workspaceController` — `WorkspaceController`

Host service backing the generated `ctx.remote.workspace` namespace.

```ts cordis-catalog
/**
 * Create or idempotently resolve one Workspace over an existing directory.
 * @param request - directory path to register.
 * @returns the Workspace and whether this call created it.
 */
@Remote('create') create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue>

/**
 * Rename one Workspace to a unique non-blank title.
 * @param request - Workspace identity and proposed title.
 * @returns the updated Workspace projection.
 */
@Remote('rename') rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue>

/**
 * Give a Workspace without a directory on this Host, such as one another device of the account registered, a
 * directory here. The directory stays on this Host.
 * @param request - Workspace identity and directory path.
 * @returns the updated Workspace projection.
 */
@Remote('bind') bind(request: WorkspaceBindRequest): Promise<WorkspaceValue>

/**
 * Remove one Workspace registration while retaining files and Sessions.
 * @param request - Workspace identity to remove.
 * @returns deletion confirmation.
 */
@Remote('delete') delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue>

/**
 * Move one Workspace within the registry display order.
 * @param request - moved Workspace and optional anchor.
 * @returns the complete resulting Workspace order.
 */
@Remote('insertBefore') insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue>

/**
 * Move one accounted Session within a Workspace.
 * @param request - Workspace, Session, and optional anchor identities.
 * @returns the updated Workspace projection.
 */
@Remote('insertSessionBefore') insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue>

/**
 * Hide one known Session from Workspace grouping surfaces.
 * @param request - Session identity to archive.
 * @returns the complete resulting archive set.
 */
@Remote('archiveSession') archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue>

/**
 * Restore one Session to Workspace grouping surfaces.
 * @param request - Session identity to unarchive.
 * @returns the complete resulting archive set.
 */
@Remote('unarchiveSession') unarchiveSession(request: WorkspaceUnarchiveSessionRequest): Promise<WorkspaceArchiveValue>

/**
 * Stream a complete Workspace baseline followed by ordered increments.
 * @param signal - generation cancellation.
 * @returns baseline followed by ordered Workspace increments.
 */
@Remote({ mode: 'stream' }) follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame>
```

Source: [`packages/api/workspace-controller/src/index.ts`](../../packages/api/workspace-controller/src/index.ts)

<a id="ctxworkspacefiles--workspacefiles"></a>

### `ctx.workspaceFiles` — `WorkspaceFiles`

Host Remote listings, previews and name searches over the composed filesystem.

```ts cordis-catalog
/**
 * List the direct children of one directory inside the Session's workspace.
 * @param agent - the Session asking; its header names the workspace root.
 * @param path - workspace-relative or absolute path; empty for the root.
 * @param signal - caller cancellation.
 * @returns the root, the listed path and its children, bounded by the entry cap.
 */
@Remote async list(agent: Agent, path: string, signal: AbortSignal): Promise<WorkspaceDirectoryListing>

/**
 * Read the leading page of one UTF-8 text file.
 * @param agent - the Session asking; relative paths resolve against its workspace root.
 * @param path - workspace-relative or absolute path.
 * @param signal - caller cancellation.
 * @returns the file's absolute path, size, first page and whether that page reaches EOF.
 */
@Remote async read(agent: Agent, path: string, signal: AbortSignal): Promise<WorkspaceFileText>

/**
 * Find entries whose name contains `query` (case-insensitive), walking the
 * workspace breadth-first and skipping the configured directory names.
 * @param agent - the Session asking; its header names the workspace root.
 * @param query - the name fragment to match.
 * @param signal - caller cancellation.
 * @returns the matches in walk order and whether a cap stopped the walk.
 */
@Remote async search(agent: Agent, query: string, signal: AbortSignal): Promise<WorkspaceSearchResult>
```

Types: [Agent](core.zh.md)

Source: [`packages/api/workspace-files/src/index.ts`](../../packages/api/workspace-files/src/index.ts)

<a id="ctxworkspaceregistry--workspaceregistry"></a>

### `ctx.workspaceRegistry` — `WorkspaceRegistry`

Durable workspace registry. Startup waits for `sessionPersistence`, builds one canonical-cwd header index, completes the one-time history bootstrap, and re-derives membership from that index before the service becomes active. The persistence dependency is mandatory so an unavailable peer can never be mistaken for an empty history and commit the initialized marker.

Membership is re-derived rather than trusted because the durable record is not safe to trust alone: its domain is a whole-document store with no cross-process write locking, so another Host sharing this storage root can replace the record with a snapshot that never saw these Sessions. A cwd that canonically equals an existing Workspace's path is the one fact that survives on its own.

```ts cordis-catalog
/**
 * Create or reuse a workspace for an existing directory. The fully qualified
 * path is canonicalized through `fs.realpath`; a relative, nonexistent, or
 * non-directory path rejects. Repeated calls for the same canonical path and
 * owner return the existing entity without changing its title; another
 * account registering the same directory gets a workspace of its own.
 * A newly created workspace lands directly below the built-in one, which
 * keeps the head of the order — and so the first screen — where the reader
 * left it instead of handing it to whichever registration was created last.
 * Different canonical paths may share a display title.
 * @param path - Existing directory to own, in a fully qualified path spelling.
 * @param title - Display title used only when a new record is created.
 * @param owner - Account id of the signed-in user registering the directory; absent when nobody is signed in.
 * @returns the existing or newly durable workspace.
 */
async create(path: string, title?: string, owner?: string): Promise<Workspace>

/**
 * Look up a workspace by id.
 * @param id - Workspace id.
 * @returns the workspace, or `undefined` when unknown.
 */
get(id: WorkspaceId): Workspace | undefined

/**
 * Synchronous workspace projection in durable registry order. Every
 * entity's `sessionIds` getter is already filtered by the startup/live
 * canonical-cwd header index; this method performs no persistence reads.
 * @returns a fresh ordered array of workspace entities.
 */
list(): Workspace[]

/**
 * Delete one workspace registration while retaining its directory and every
 * session log. The workspace's sessions join the archive set in the same
 * write that removes it from the durable order, so no session is left
 * without a group. The order and archive write precedes the table deletion;
 * a failed table write restores the prior order and archive set and keeps
 * the entity published. Unknown ids are an idempotent no-op for domain
 * callers.
 *
 * The built-in workspace refuses deletion. It is the one registration the
 * product guarantees a reader has, and removing it would restore the state
 * the registration exists to prevent — a first screen that demands a folder
 * before it accepts a message. A deployment that does not want one turns
 * seeding off in configuration rather than deleting it at runtime.
 * @param id - Workspace registration to remove.
 * @returns `true` when a record was deleted, `false` when it was unknown.
 * @throws {WorkspaceDefaultImmutableError} when the id names the built-in workspace.
 */
delete(id: WorkspaceId): Promise<boolean>

/**
 * Name the workspace a session belongs to in the terms every device of the account shares: `default` for the
 * built-in default workspace, `builtin:<key>` for a plugin-declared one, and the workspace id otherwise.
 * @param sessionId - the session.
 * @returns the shared name, or undefined when no workspace holds the session.
 */
sessionHome(sessionId: SessionId): string | undefined

/**
 * File a session another device published into the workspace its {@link sessionHome} names, when this device
 * holds that workspace and the session is not filed yet.
 * @param sessionId - the session, already stored on this device.
 * @param home - the shared workspace name.
 * @param header - received metadata when the body has not been downloaded yet.
 * @returns whether the session is now filed there.
 */
async fileSession(sessionId: SessionId, home: string, header?: SessionHeader): Promise<boolean>

/**
 * Observe sessions that {@link fileSession} could not file earlier joining their workspace once it arrived from
 * another device.
 * @param listener - called after one or more such sessions were filed.
 * @returns the disposer.
 */
onLateFiling(listener: () => void): () => void

/**
 * Give a workspace that another device of the account registered a directory on this device. The directory
 * stays here; the account's other devices keep their own.
 * @param id - a workspace without a directory on this device.
 * @param path - existing directory, in a fully qualified spelling.
 * @returns the workspace, now folder-backed.
 */
async bind(id: WorkspaceId, path: string): Promise<Workspace>

/**
 * Move one workspace within the durable display order, DOM-insertBefore-like.
 * With an anchor it lands before that workspace; without one it appends.
 *
 * The built-in workspace holds the head of the order: it is where a reader
 * lands when nothing is selected, so its position is part of what makes the
 * first screen predictable rather than a preference a drag can reorder. An
 * anchor of the built-in therefore lands the moved workspace directly below
 * it, the same place a new registration takes.
 * @param id - Workspace to move.
 * @param beforeId - Workspace anchor; omitted appends.
 * @returns the complete committed workspace order.
 * @throws {WorkspaceDefaultImmutableError} when the id names a built-in workspace.
 */
insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>

/**
 * Archive one session durably. The session must exist (live or in session
 * persistence); its workspace accounting — or lack of one — is irrelevant.
 * An already archived id resolves without writing.
 * @param sessionId - The session to archive.
 * @returns resolution after durability.
 */
archiveSession(sessionId: SessionId): Promise<void>

/**
 * Unarchive one session durably by dropping it from the registry-global
 * archive set; the accounting slot was never touched, so the session
 * returns to its recorded position. Removing an id cannot introduce an
 * unknown one, so no session-existence check runs. An id that is not
 * archived resolves without writing.
 * @param sessionId - The session to unarchive.
 * @returns resolution after durability.
 */
unarchiveSession(sessionId: SessionId): Promise<void>

/**
 * Drop every registry fact about a deleted session: its workspace
 * accounting, its archive entry, and its indexed header. The caller has
 * already removed the session from live state and persistence, so nothing
 * re-adopts it.
 * @param sessionId - The deleted session.
 * @returns resolution after durability.
 */
forgetSession(sessionId: SessionId): Promise<void>

/**
 * Resolve by canonical directory path without creating or mutating a
 * workspace. A missing path rejects during `realpath`; an existing unowned
 * directory returns `undefined`.
 * @param path - Existing directory path in a fully qualified spelling.
 * @param owner - Account whose workspace to find; absent finds the one no account owns.
 * @returns that account's workspace for the canonical path, when one exists.
 */
async resolveByPath(path: string, owner?: string): Promise<Workspace | undefined>

/**
 * Owner recorded in an indexed session header.
 * @param sessionId - the session to read.
 * @returns the account id, or `undefined` when the session records none or is not indexed.
 */
sessionOwner(sessionId: SessionId): string | undefined

/**
 * Seed or return one built-in workspace declared by a plugin under a stable
 * key. The registration has no directory, every account reaches it, and it
 * refuses delete, rename, and move like the default workspace. The key binds
 * durably to the registration, so repeated calls and restarts return the
 * same workspace; a changed declared title is adopted on the next call, and a
 * new one lands directly below the default workspace.
 * @param key - stable key naming the declaring plugin's registration.
 * @param title - display title the declaring plugin owns.
 * @returns the built-in workspace.
 */
builtIn(key: string, title: string): Promise<Workspace>
```

Types: [SessionHeader](persistence.zh.md) · [SessionId](core.zh.md)

Source: [`packages/workspace/workspace/src/index.ts`](../../packages/workspace/workspace/src/index.ts)

<a id="workspace-files-events"></a>

### `workspace-files/*` events

<a id="workspace-filesshow--waterfall"></a>

#### `workspace-files/show` — waterfall

Show one workspace path in the Files sidebar beside its session. The client displaying that session opens the explorer and answers; a listener without that session calls `next()` to delegate. Scope-filtered dispatch (`@aeven/scope`): agent-scoped listeners receive only that agent.

```ts cordis-catalog
/**
 * Show one workspace path in the Files sidebar beside its session. The
 * client displaying that session opens the explorer and answers; a
 * listener without that session calls `next()` to delegate.
 * Scope-filtered dispatch (`@aeven/scope`): agent-scoped listeners receive
 * only that agent.
 * @param request - the path to show.
 * @mode waterfall
 */
'workspace-files/show'( this: Scoped<Agent>, request: WorkspaceFilesShowRequestEvent, next: () => Promise<WorkspaceFilesShowResult>, ): Promise<WorkspaceFilesShowResult>
```

Types: [Agent](core.zh.md) · [Scoped](scope.zh.md)

Source: [`packages/api/workspace-files/src/types.ts`](../../packages/api/workspace-files/src/types.ts)
<!-- END GENERATED cordis-surface -->
