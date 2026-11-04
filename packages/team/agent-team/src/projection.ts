/** Host-only task-board state projected incrementally from committed root Session events. */

import { z } from 'zod'
import { brandString } from '@aeven/brand'
import type { SessionEvent, SessionEventMap, SessionId } from '@aeven/session'
import type { ProjectionDefinition } from '@aeven/session-projection'
import type { TeamId, TeamTaskSnapshot } from './types.ts'
import { TeamId as toTeamId, TeamTaskId as toTeamTaskId } from './types.ts'
import { assertTaskGraphCandidate } from './task-graph.ts'

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positiveSafeInteger = nonNegativeSafeInteger.min(1)
const sessionIdSchema = z.string().min(1).transform(value => brandString<SessionId>(value))
const teamIdSchema = z.string().min(1).transform(value => toTeamId(value))
const numericTaskIdPattern = /^task-(\d+)$/u
const teamTaskIdSchema = z.string().min(1).refine((value) => {
  const match = numericTaskIdPattern.exec(value)
  return match === null || Number.isSafeInteger(Number(match[1]))
}, { message: 'numeric task id suffix must be a safe integer' }).transform(value => toTeamTaskId(value))
const teamTaskSnapshotSchema = z.object({
  id: teamTaskIdSchema,
  revision: positiveSafeInteger,
  subject: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'deleted']),
  ownerId: sessionIdSchema.optional(),
  blockedBy: z.array(teamTaskIdSchema),
  writeScopes: z.array(z.string()),
}).strict() as z.ZodType<TeamTaskSnapshot>

const teamEventSelectorSchema = z.object({
  version: nonNegativeSafeInteger,
  teamId: teamIdSchema,
}).loose()

const teamTaskEventSchema = z.object({
  version: z.literal(1),
  teamId: teamIdSchema,
  task: teamTaskSnapshotSchema,
}).strict() as z.ZodType<SessionEventMap['team/task']>

/** Task board selected by its durable root identity. */
export interface TeamState {
  readonly id: TeamId
  readonly tasks: readonly TeamTaskSnapshot[]
  readonly nextTaskNumber: number
}

/**
 * Checkpoint-safe board state for the projected Session. `failure` names the
 * first rejected persisted task record; tasks then stay at the last valid state.
 */
export interface TeamProjectionState extends TeamState {
  readonly failure?: string
}

declare module '@aeven/session-projection/types' {
  interface SessionProjectionStateMap {
    /** Shared task board of the subagent tree rooted at the projected Session. */
    agentTeam: TeamProjectionState
  }
}

/**
 * Construct an empty board for one root Session.
 * @param rootId - root Session identity.
 * @returns empty board state.
 */
export function emptyTeamState(rootId: SessionId): TeamProjectionState {
  return { id: toTeamId(rootId), tasks: [], nextTaskNumber: 1 }
}

const teamProjectionEntrySchema = z.object({
  id: teamIdSchema,
  tasks: z.array(teamTaskSnapshotSchema),
  nextTaskNumber: positiveSafeInteger,
  failure: z.string().optional(),
}).strict() as z.ZodType<TeamProjectionState>

/** Decode one persisted task value and retain the schema failure as its cause. */
function parsePersisted<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value)
  } catch (error: unknown) {
    throw new Error('persisted team/task payload is invalid', { cause: error })
  }
}

function applyProjectionEvent(state: TeamProjectionState, event: SessionEvent): TeamProjectionState {
  if (state.failure !== undefined || event.type !== 'team/task') return state
  try {
    const selector = parsePersisted(teamEventSelectorSchema, event.data)
    // A fork inherits its parent's task records; only the board rooted here applies.
    if (selector.teamId !== state.id) return state
    if (selector.version !== 1) {
      throw new Error(`unsupported team/task event version ${String(selector.version)}`)
    }
    return applyTask(state, parsePersisted(teamTaskEventSchema, event.data).task)
  } catch (error: unknown) {
    /* v8 ignore next -- the owned task transition throws Error instances. */
    return { ...state, failure: error instanceof Error ? error.message : String(error) }
  }
}

function replaceAt<T>(items: readonly T[], index: number, item: T): T[] {
  const next = [...items]
  if (index < 0) next.push(item)
  else next[index] = item
  return next
}

function applyTask(state: TeamProjectionState, task: TeamTaskSnapshot): TeamProjectionState {
  const index = state.tasks.findIndex(candidate => candidate.id === task.id)
  const prior = state.tasks[index]
  if (prior === undefined && task.revision !== 1) {
    throw new Error(`team task "${task.id}" must begin at revision 1`)
  }
  if (prior !== undefined && task.revision !== prior.revision + 1) {
    throw new Error(`team task "${task.id}" revision is not contiguous`)
  }
  assertTaskGraphCandidate(state.tasks, task)
  let nextTaskNumber = state.nextTaskNumber
  const match = numericTaskIdPattern.exec(task.id)
  if (match !== null) {
    const number = Number(match[1])
    nextTaskNumber = Math.max(
      nextTaskNumber,
      number === Number.MAX_SAFE_INTEGER ? number : number + 1,
    )
  }
  return { ...state, tasks: replaceAt(state.tasks, index, task), nextTaskNumber }
}

/** Host-only board projection selected by the projected Session identity. */
export const teamProjectionDefinition = {
  key: 'agentTeam',
  stateVersion: 1,
  stateSchema: teamProjectionEntrySchema,
  init: header => emptyTeamState(header.id),
  apply: applyProjectionEvent,
} satisfies ProjectionDefinition<'agentTeam', TeamProjectionState>
