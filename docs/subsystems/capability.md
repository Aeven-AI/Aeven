# Capabilities

English | [中文](capability.zh.md)

Service declarations: [source](../../packages/capability/capability/src/index.ts).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcapabilities--capabilities"></a>

### `ctx.capabilities` — `Capabilities`

Registry of learned capabilities for every signed-in user of this Host.

```ts cordis-catalog
/**
 * List an owner's capabilities.
 * @param owner - account id.
 * @returns records sorted by name.
 */
list(owner: string): Promise<CapabilityRecord[]>

/**
 * Read one capability with its body.
 * @param owner - account id.
 * @param name - capability name.
 * @returns the capability, or undefined when the owner has none by that name.
 */
get(owner: string, name: string): Promise<Capability | undefined>

/**
 * Create a capability or replace its body and description, keeping its supporting files. Credentials in the
 * description, the procedure, and the origin's request are redacted before they are stored.
 * @param owner - account id.
 * @param draft - name, description, and procedure.
 * @param options - resulting status, who originated it, the writing session (undefined outside a session), and
 * the work it was learned from; a later save keeps the first origin.
 * @returns the stored capability.
 */
save( owner: string, draft: CapabilityDraft, options: { readonly status: CapabilityStatus readonly source: CapabilitySource readonly sessionId: string | undefined readonly origin?: CapabilityOrigin }, ): Promise<Capability>

/**
 * Replace one exact, unique passage of a capability's procedure; credentials in the result are redacted.
 * @param owner - account id.
 * @param name - capability name.
 * @param edit - the passage to replace and its replacement.
 * @param sessionId - the writing session; undefined when the user changed it outside a session.
 * @returns the updated capability.
 * @throws when the capability does not exist or the passage is missing or ambiguous.
 */
patch( owner: string, name: string, edit: { readonly oldString: string; readonly newString: string }, sessionId: string | undefined, ): Promise<Capability>

/**
 * Write one supporting file, such as a script the procedure runs; credentials in it are redacted.
 * @param owner - account id.
 * @param name - capability name.
 * @param path - path inside a supporting-file folder.
 * @param content - file content.
 * @param sessionId - the writing session; undefined when the user changed it outside a session.
 * @returns the updated capability.
 */
writeFile(owner: string, name: string, path: string, content: string, sessionId: string | undefined): Promise<Capability>

/**
 * Change a capability's status, such as confirming a candidate.
 * @param owner - account id.
 * @param name - capability name.
 * @param status - new status.
 * @param sessionId - the session the change was made from; undefined when the user changed it outside a session.
 * @returns the updated capability.
 */
setStatus(owner: string, name: string, status: CapabilityStatus, sessionId: string | undefined): Promise<Capability>

/**
 * Delete a capability and its supporting files.
 * @param owner - account id.
 * @param name - capability name.
 * @returns true when a capability was deleted.
 */
remove(owner: string, name: string): Promise<boolean>

/**
 * List the revisions whose body is still kept, oldest first.
 *
 * Every write keeps its revision's procedure, so a capability whose current revision turned out worse than an
 * earlier one can be restored instead of rewritten from memory.
 * @param owner - account id.
 * @param name - capability name.
 * @returns one entry per kept revision.
 */
versions(owner: string, name: string): Promise<CapabilityVersion[]>

/**
 * Restore one kept revision as a new revision.
 *
 * The earlier procedure and the description it carried become the current revision, so the history stays
 * append-only and a later execution is attributable to the text it actually followed. The restored revision
 * then answers to its evidence like any other: a revision whose runs fail is degraded rather than trusted.
 * @param owner - account id.
 * @param name - capability name.
 * @param revision - revision whose body to restore.
 * @param sessionId - the session the restore was made from; undefined when the user restored it outside a session.
 * @returns the capability at its new revision.
 * @throws when the capability does not exist, or no body was kept for that revision.
 */
rollback(owner: string, name: string, revision: number, sessionId: string | undefined): Promise<Capability>

/**
 * Record one use of an executable capability; its revision is the current one.
 * @param owner - account id.
 * @param name - capability name.
 * @param execution - what happened in the turn that used it.
 * @returns the execution id, for amendments.
 */
recordExecution(owner: string, name: string, execution: Omit<CapabilityExecution, 'kind' | 'id' | 'revision'>): Promise<string>

/**
 * Attach later evidence, a correction or a rating, to a recorded execution.
 * @param owner - account id.
 * @param name - capability name.
 * @param amendment - the evidence.
 */
amend(owner: string, name: string, amendment: CapabilityAmendment): Promise<void>

/**
 * Read a capability's executions with their verdicts.
 * @param owner - account id.
 * @param name - capability name.
 * @returns judged executions in the order they ran.
 */
async evidence(owner: string, name: string): Promise<JudgedExecution[]>
```

Source: [`packages/capability/capability/src/index.ts`](../../packages/capability/capability/src/index.ts)

<a id="capabilities-events"></a>

### `capabilities/*` events

<a id="capabilitieschanged--emit"></a>

#### `capabilities/changed` — emit

One capability of an owner was saved, changed, or deleted. Emitted after the write is durable.

```ts cordis-catalog
/**
 * One capability of an owner was saved, changed, or deleted. Emitted after the write is durable.
 * @param change - owner and capability name.
 * @mode emit
 */
'capabilities/changed'(change: CapabilityChange): void
```

Source: [`packages/capability/capability/src/index.ts`](../../packages/capability/capability/src/index.ts)
<!-- END GENERATED cordis-surface -->
