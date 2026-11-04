/** Shared task boards owned by subagent tree roots. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@aeven/agent'
import type {} from '@aeven/session-projection'
import type {} from '@aeven/subagent'
import { TeamJournal } from './journal.ts'
import { teamProjectionDefinition } from './projection.ts'
import { TeamTaskBoard } from './task-board.ts'
import { TeamTaskId } from './types.ts'
import type {
  Config,
  CreateTeamTaskRequest,
  TeamTaskView,
  UpdateTeamTaskRequest,
} from './types.ts'

export type * from './types.ts'
export { TeamId, TeamTaskId } from './types.ts'
export { TeamError } from './error.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentTeams: TeamService
  }
}

/**
 * Task-board service. Every root Agent and its subagent descendants share the
 * board stored in the root Session; the subagent runtime resolves membership.
 */
export class TeamService extends Service {
  static inject = ['sessions', 'sessionProjections', 'subagents']

  static Config: z<Config> = z.object({
    maxTasks: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(256)
      .description('Maximum non-deleted tasks on one board.'),
  })

  private readonly tasks: TeamTaskBoard

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentTeams')
    ctx.sessionProjections.register(teamProjectionDefinition)
    this.tasks = new TeamTaskBoard(ctx, new TeamJournal(ctx), config.maxTasks)
  }

  /**
   * Create one unowned pending task on the caller's tree board.
   * @param caller - exact live tree member creating the task.
   * @param request - task text, blockers, and advisory write scopes.
   * @param signal - cancellation before the task event is appended; omitted means no cancellation.
   * @returns the revision-one task view.
   * @throws TEAM_TASK_PERSISTENCE_UNCONFIRMED when the task is visible but durability is unknown; read it before retrying.
   */
  async createTask(caller: Agent, request: CreateTeamTaskRequest, signal?: AbortSignal): Promise<TeamTaskView> {
    return await this.tasks.create(caller, this.ctx.subagents.rootOf(caller), request, signal)
  }

  /**
   * Return one task, including a deleted tombstone.
   * @param caller - exact live tree member reading the task.
   * @param id - board-local task identity.
   * @returns the latest task value and derived readiness diagnostics.
   */
  getTask(caller: Agent, id: TeamTaskId): TeamTaskView {
    return this.tasks.get(this.ctx.subagents.rootOf(caller), id)
  }

  /**
   * List current non-deleted tasks in numeric creation order.
   * @param caller - exact live tree member reading the board.
   * @returns detached current task views.
   */
  listTasks(caller: Agent): TeamTaskView[] {
    return this.tasks.list(this.ctx.subagents.rootOf(caller))
  }

  /**
   * Compare-and-set one authorized task transition.
   * @param caller - exact live tree member authorizing the mutation.
   * @param request - task identity, expected revision, action, and action fields.
   * @param signal - cancellation before the task event is appended; omitted means no cancellation.
   * @returns the committed next task revision.
   * @throws TEAM_TASK_PERSISTENCE_UNCONFIRMED when the task is visible but durability is unknown; read it before retrying.
   */
  async updateTask(caller: Agent, request: UpdateTeamTaskRequest, signal?: AbortSignal): Promise<TeamTaskView> {
    return await this.tasks.update(caller, this.ctx.subagents.rootOf(caller), request, signal)
  }
}

export default TeamService
