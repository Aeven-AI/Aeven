/** Serialized task-board transactions over the exact live root Session log. */

import type { Agent } from '@aeven/agent'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@aeven/session'
import type { TeamState } from './projection.ts'
import { TeamId } from './types.ts'
import { TeamError } from './error.ts'
import type { TeamTaskSnapshot } from './types.ts'

/** Owns per-root transaction order and committed task-event publication. */
export class TeamJournal {
  private readonly tails = new Map<SessionId, Promise<void>>()

  /**
   * @param ctx - task-board context with the injected Session and projection services.
   */
  constructor(private readonly ctx: Context) {}

  /**
   * Read authoritative board state for one exact live root.
   * @param root - exact live subagent tree root.
   * @returns current projected state of the board the root owns.
   * @throws when the durable board projection has failed.
   */
  state(root: Agent): TeamState {
    const projection = this.ctx.sessionProjections.stateOf(root.session, 'agentTeam')
    /* v8 ignore next -- the task-board service registers the unit before any command runs. */
    if (projection === undefined) throw new Error('agentTeam projection is not registered')
    if (projection.failure !== undefined) throw new Error(projection.failure)
    return projection
  }

  /**
   * Serialize one root's asynchronous mutation operation.
   * @param rootId - root Session identity selecting the transaction queue.
   * @param operation - complete read-check-append operation.
   * @returns the operation result.
   */
  async transact<T>(rootId: SessionId, operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(rootId) ?? Promise.resolve()
    const run = prior.then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    this.tails.set(rootId, tail)
    try {
      return await run
    } finally {
      if (this.tails.get(rootId) === tail) this.tails.delete(rootId)
    }
  }

  /**
   * Append and flush one task revision.
   * @param root - live tree root whose Session stores the task.
   * @param task - complete committed task revision.
   * @throws TEAM_TASK_PERSISTENCE_UNCONFIRMED after append when flush fails or has no listener; read the task before retrying.
   */
  async appendAndFlush(root: Agent, task: TeamTaskSnapshot): Promise<void> {
    root.session.append('team/task', { version: 1, teamId: TeamId(root.id), task })
    try {
      const participated = await this.ctx.sessions.flush(root.session)
      if (!participated) throw new Error('No session durability listener participated')
    } catch (error: unknown) {
      throw new TeamError(
        `task "${task.id}" revision ${task.revision} is visible, but persistence was not confirmed; read the task before retrying`,
        'TEAM_TASK_PERSISTENCE_UNCONFIRMED',
        { cause: error },
      )
    }
  }
}
