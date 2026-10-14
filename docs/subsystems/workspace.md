# Workspaces

English | [中文](workspace.zh.md)

A workspace is the persistent record of a directory the user works in: a stable id over a canonical path, a display title, and the ordered account of sessions that belong to it. The subsystem is one package ([avn-workspace](../../packages/workspace/workspace), `ctx.workspaceRegistry`) — an optional host-side capability, not part of the agent-loop spine, and invisible to models (no tools, no prompt text, no session events). It stores its records through the [storage domain form](storage.md) and validates session membership against [`SessionHeader.cwd`](persistence.md#sessionheader--metadata-beside-the-log), so `storageDomain` and `sessionPersistence` are mandatory startup dependencies: an unavailable persistence peer leaves the plugin pending rather than being mistaken for an empty history. Design record: [domain KV storage Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md); bootstrap and GUI ordering: [Workspace UI product-flow Agent Note](../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.md).

Source: [`packages/workspace/workspace/src/types.ts`](../../packages/workspace/workspace/src/types.ts)

## Identity

```ts type-equiv
/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
type WorkspaceId = Branded<'WorkspaceId'>
```

`WorkspaceId` is a [branded id](core.md#branded-ids). Path identity is separate: `realpathNormalize` (`fs.realpath`; trailing slashes, `..`, and symlinks resolved) is the one uniqueness canon — workspace paths are stored canonicalized, uniqueness is string equality of canonical paths (a symlink to an owned directory collides), and attach-time session cwd checks go through the same canon. That canon governs `kind: 'folder'` records only: a record with no directory binding has no path identity to canonicalize or to collide on, which is why uniqueness skips it rather than treating two pathless records as sharing a path neither of them has.

## The workspace entity

Consumers see only the `Workspace` interface; the implementation stays package-private.

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

Ownership truth is the record's ordered `sessionIds`, never derived from session cwd. Membership then requires an id on that account *plus* agreement between the session's location and the workspace's, and what "agreement" means follows from the record's `kind`: a `folder` workspace additionally requires a header whose canonical cwd equals the workspace path, so one session structurally belongs to at most one folder workspace, while a workspace with no directory binding requires the opposite — a session that records no cwd — because a machine-local path inside a record expected to travel between machines would make that record unportable. Failed writes reject (`insertSessionBefore` account errors as `WorkspaceMoveInvalidError`, storage failures as plain errors); every accepted mutation stamps `updatedAt` and durably prunes candidates that no longer pass the membership check.

## The registry: `ctx.workspaceRegistry`

`WorkspaceRegistry` ([signatures](#ctxworkspaceregistry--workspaceregistry)) owns registration and resolution. `create(path, title?)` requires a fully qualified path, canonicalizes it, rejects a nonexistent path (the original `ENOENT`) or a non-directory, returns the existing entity unchanged when the canonical path is already owned, and otherwise creates a record with `title ?? defaultWorkspaceTitle(path)` placed directly below the built-in workspace in the durable registry order, which the built-in holds against every move (different canonical paths may share a display title, and a path with no final segment uses its root spelling). `get(id)` and the ordered `list()` are synchronous cache reads; `resolveByPath(path)` applies the same fully qualified realpath canon without creating. `delete(id)` removes only the registration, order entry, and session account — the directory, user files, live sessions, and persisted logs are never touched, and the deleted workspace's sessions join the archive set in the same state write that drops it from the order ([decision](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)); unknown ids return `false`. Create and delete persist a pending-mutation marker before their two writes (record + order) can diverge; startup resolves exactly the marked mutation — by deleting the marked table row, which completes an interrupted delete and rolls back an interrupted create (the registration is re-creatable, so rollback is the safe direction) — and an unmarked order/table mismatch fails loud as corruption.

Sessions get their cwd at create time from whoever creates them, not from this registry — the API gateway resolves a new session's cwd from the chosen workspace's `path` (falling back to an explicit or default cwd), creates the session so the cwd lands in its immutable [`SessionHeader`](persistence.md#sessionheader--metadata-beside-the-log), then calls `attachSession`, which re-validates that stored header cwd against the workspace path. A workspace with no directory has no cwd to hand out, so that route does not apply to it. On the first successful start, the registry bootstraps history from persisted headers alone (`id`, `cwd`, `createdAt` — never event bodies), grouping sessions with a valid canonical cwd into per-directory workspaces, newest first; the initialized marker is written last so an interrupted bootstrap resumes safely. The bootstrap is one-time: cwd-less legacy sessions stay Ungrouped, and sessions created afterwards join a workspace only through `attachSession`. Bootstrap is also a folder-only mechanism by construction: it derives groups from header cwds, so a pathless record keeps the account it was stored with and is never re-derived from a header.

## Consumers

[`avn-workspace-controller`](../../packages/api/workspace-controller) serves workspace CRUD to GUI clients over `ctx.workspaceRegistry`, and [`avn-session-controller`](../../packages/api/session-controller) performs the create-session-then-attach flow above. [avn-agent-instructions](../../packages/context/agent-instructions) is **not** a consumer despite the name: it discovers AGENTS.md-style instruction files under an agent's own cwd and never touches `ctx.workspaceRegistry` — the shared word refers to the user's working directory, not to this registry's entities.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.md)

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
 * same workspace without changing its title; a new one lands directly below
 * the default workspace.
 * @param key - stable key naming the declaring plugin's registration.
 * @param title - display title used only when the registration is created.
 * @returns the built-in workspace.
 */
builtIn(key: string, title: string): Promise<Workspace>
```

Types: [SessionId](core.md)

Source: [`packages/workspace/workspace/src/index.ts`](../../packages/workspace/workspace/src/index.ts)
<!-- END GENERATED cordis-surface -->
