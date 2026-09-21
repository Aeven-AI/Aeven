# Agent Note: Give the session index a workspace identity

Status: proposed

English | [中文](2026-09-21-workspace-identity-in-the-session-index.zh.md)

## Problem

A Workspace owns an ordered account of its Sessions, and that record is the sole authority for membership. A `folder` workspace joins a Session by requiring the header's canonical `cwd` to equal the workspace's path; a `virtual` workspace has no directory at all, so its Sessions carry no cwd and join through the record alone. `WorkspaceKind` and `AttachSession` state this contract in [types.ts](../../../../packages/workspace/workspace/src/types.ts), and `adoptByCwd` in [index.ts](../../../../packages/workspace/workspace/src/index.ts) implements the folder-only recovery that rebuilds a membership the durable record lost.

Two consequences follow, and both are visible in the runtime rather than theoretical.

The session index cannot answer a workspace question. `session-query-sqlite` stores `cwd`, `parent_session`, `seed_length`, `delegation_depth`, `agent_preset`, and a `revision` per row, so it carries every lineage and configuration fact a listing needs except the one grouping the product presents first. A workspace-filtered listing therefore has to consult the registry and join in memory, and a `virtual` workspace — whose Sessions have no cwd to match — cannot be queried by location at all. The index records a location where the question is an identity.

Session log storage is keyed by directory. `projectKey(cwd)` hashes a path and `projectDir(root, cwd)` selects a bucket, with `undefined` selecting `_no-cwd`, in [format.ts](../../../../packages/session/session-persistence-jsonl/src/format.ts). Every pathless Session on a machine therefore shares one `_no-cwd` bucket regardless of which virtual workspace it belongs to, and moving a folder relocates where its Sessions are read from while the workspace record is unaffected.

Path identity has already required repair machinery. `claimLegacySessionWorkspace` and `repairRemoteSessionPaths` exist because a `remote` identity was once written into a directory or path field. Both are narrow, id-scoped, and explicitly forbid batch migration, which is the shape a workaround takes when the stored fact is a location that later proves unstable. `WorkspaceKind` reserves `'remote'` and states that nothing may assume it stays absent.

A comparison with another agent workbench in this organisation prompted this review. That workbench stores `workspaceID` directly on its session row, which lets its index group by workspace as a first-class column. The transferable part is the indexed identity, not the duplication: that workbench owns no account system and runs its agent on the machine that holds the session, so it was never forced to separate a Session's location from the Workspace that owns it.

## Proposal

Give the session index a `workspace_id` column, and key Session log storage by that identity rather than by the directory. Workspace membership stays single-authority on the workspace record throughout; the index column and the log bucket are derived projections of that authority, never a second source.

This is the rule the change exists to preserve. `adoptByCwd` recovers membership *from a header* only because a header is not authoritative — it is the durable record that is. Adding a workspace field to `SessionHeader` would invert that: two records would each claim to know the owner, and a mismatch between them would have no defined winner.

Add the column to `persisted_sessions` alongside the lineage columns it already holds, and populate it during `_reconcile()` from the registry's session account. Reconciliation already detects change per `revision`; a Session whose owning workspace changed is a row that must be replaced, so the existing mechanism carries the new fact without a second synchronization path. A row the registry does not claim reads as unowned rather than as an error, which keeps a partially started registry from writing a wrong owner and is the one failure direction that cannot silently regroup a listing.

Key the log bucket by workspace identity for Sessions created through `session.create` with a `workspaceId`. `projectDir` derives the bucket from the workspace and keeps `cwd` as the location field it is, so a `virtual` workspace gains a bucket of its own and a folder workspace keeps its Sessions readable when the directory moves. Sessions that name no workspace, and every Session already on disk, resolve through the path rule exactly as they do now, which is what makes the storage change additive rather than a migration.

The header gains a workspace identity only when a composition produces the `remote` kind, wired through this index column so it lands as one field with one consumer rather than as a second authority. Until then the header's `cwd` remains a location and the workspace record remains the owner.

## Open questions

**Where does a derived value come from when the registry is not up?** Reading the session account at reconcile time keeps one authority and couples the index to registry availability. A path-match fallback keeps the index independent but cannot work for a `virtual` workspace, which is the case the column exists to serve. The proposal takes registry-derived with an explicit unowned value; the alternative is recorded below and neither is settled.

**Does the `remote` header field arrive before a producer exists?** `WorkspaceKind` reserves the kind and forbids assuming it stays absent. Adding the field early costs an unused header element and a migration question for logs written without it; adding it late costs a second change to the same format.

**Which workspace owns a Session created without one?** `session.create` accepts `workspaceId` or `cwd` and no workspace at all, in which case the location falls back to an explicit or deployment-default cwd. Such a Session has a location and no owner, so the index must be able to express unowned without it reading as an error.

## Alternatives considered

**Copy `workspaceID` onto the Session header, as the comparison workbench does.** Makes the index trivial and needs no derivation, but duplicates the authority that [types.ts](../../../../packages/workspace/workspace/src/types.ts) defines as the workspace record's, and creates a disagreement with no defined winner. The comparison workbench can afford this because it has no account system and no virtual workspace: its server is the machine, so its session row and its workspace are the same object. Adopting the field without that context would import a solution to a problem this repository does not have.

**Derive the owner from `cwd` at reconcile time.** No format change and no registry dependency, and correct for every `folder` workspace. It fails exactly where the column is needed: a `virtual` workspace has no directory to match, so its Sessions would index as unowned and regroup nowhere. Reusing the rule that `adoptByCwd` already documents as folder-only would extend a recovery heuristic into the query authority.

**Re-key the storage of existing Sessions.** Would make the layout uniform immediately. Rejected because it rewrites committed artifact locations that `jsonl.spec.ts` pins and that `repairRemoteSessionPaths` exists to correct; the additive rule reaches the same layout for every Session created after the change without touching what is already durable.

**Take the comparison workbench's title provenance instead.** Its session row records a title source and one message id. This repository already stores a `SessionTitleSource` distinguishing a fallback, a provider with its provider and model, and an explicit user rename that pins the title, together with the exact `messageSeqs` the title was derived from, in [types.ts](../../../../packages/session/session-title/src/types.ts). The existing record is strictly stronger, so there is nothing to take.

**Replace revision reconciliation with a subscription-driven index sync.** The comparison workbench notifies its index on every session mutation. This repository compares a stored `revision` during `_reconcile()` and reloads only rows that differ, so a missed notification cannot leave the index stale. A push-only path would be a regression in fault tolerance for no gain in currency.

## Acceptance criteria

- `persisted_sessions` carries `workspace_id`, migrated in place with existing rows reading as unowned.
- A workspace-filtered Session listing answers from the index alone, with a `virtual` workspace returning its Sessions and a `folder` workspace returning the same set the current join produces.
- A Session created with a `workspaceId` persists its log under a bucket derived from that identity; a Session created with only a cwd persists under the path bucket it uses today.
- Moving a `folder` workspace's directory leaves its Sessions readable and still members.
- No Session header carries a workspace identity for the `folder` or `virtual` kinds, and `WorkspaceKind`'s membership contract is unchanged.

## Risks

Duplicating the owner in the index is the failure this design is most exposed to. The column is a cache of the record's account, so a reconcile that misses a detach leaves a stale grouping; making the registry's account the sole write source, and unowned the only fallback, keeps the error visible instead of plausible.

Reading the registry during reconcile couples index availability to registry startup. A registry that is not yet up must produce unowned rows that a later reconcile corrects, or a Session indexes against no workspace for the life of the process.

The storage change is additive, so the store holds two bucket rules until every pre-change Session ages out. The read path resolves each Session through the rule that wrote it, which is what keeps that from becoming a migration, but it is a permanent branch in the resolution.

Giving the index a workspace column makes workspace grouping cheap enough to become a default query. If a `remote` workspace's Sessions later arrive from a provider, the identity in the column is the fact that lets local and remote Sessions group together, and it is also the fact that must not be trusted as proof that the content is reachable.
