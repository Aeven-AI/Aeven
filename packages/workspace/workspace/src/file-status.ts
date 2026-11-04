/**
 * The file statuses one file sync Consumer reports to the workspace registry, so the Consumer withdraws exactly
 * what it reported when a workspace leaves it or the Consumer stops.
 * @module @aeven/workspace/file-status
 */
import type { WorkspaceRegistry } from './index.ts'
import type { WorkspaceFileStatus, WorkspaceId } from './types.ts'

/** One Consumer's reported file statuses. */
export class WorkspaceFileStatusReport {
  private readonly reported = new Set<WorkspaceId>()

  /** @param registry - the registry the statuses are reported to. */
  constructor(private readonly registry: WorkspaceRegistry) {}

  /**
   * Report a workspace's file status.
   * @param workspace - the workspace.
   * @param status - its status, or `undefined` once its files are here and up to date.
   */
  set(workspace: WorkspaceId, status: WorkspaceFileStatus | undefined): void {
    if (status === undefined) this.reported.delete(workspace)
    else this.reported.add(workspace)
    this.registry.setFileStatus(workspace, status)
  }

  /**
   * Withdraw the statuses of reported workspaces the predicate rejects.
   * @param keep - whether a reported workspace keeps its status.
   */
  retain(keep: (workspace: WorkspaceId) => boolean): void {
    for (const workspace of [...this.reported]) {
      if (!keep(workspace)) this.set(workspace, undefined)
    }
  }

  /** Withdraw every reported status. */
  clear(): void {
    this.retain(() => false)
  }
}
