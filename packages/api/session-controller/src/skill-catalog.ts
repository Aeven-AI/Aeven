/** Session-addressed, cold-readable skill catalog Remote. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/agent-presets/types'
import type { SessionId } from '@aeven/session'
import { SessionQueryError, type SessionObservation } from '@aeven/session-query'
import { isUserInvocable } from '@aeven/skill'
import type { ScopeKey } from '@aeven/scope'
import { Remote, RemoteError, TypertRemoteService } from '@aeven/typert-protocol'
import { WorkingDirectoryUnavailableError, localDirectory, sessionDirectory } from '@aeven/working-directory'
import type { SkillListRequest, SkillListValue } from './types.ts'
import { callerMayAccessSession } from './agent.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the Session-addressed `skills` Remote namespace. */
    sessionSkillCatalog: SessionSkillCatalog
  }
}

/** Host service backing `ctx.remote.skills` without activating a cold Agent. */
export class SessionSkillCatalog extends TypertRemoteService {
  static inject = ['agents', 'sessionQuery', 'typert']

  /** @param ctx - Host context carrying Session reads and optional skill/preset services. */
  constructor(ctx: Context) {
    super(ctx, 'sessionSkillCatalog', { namespace: 'skills' })
  }

  /**
   * List the user-invocable skills visible to one Session composition.
   *
   * The project scope is the directory this device binds for the Session's workspace, never the path the
   * Session log recorded: a listing served for a conversation synced from another machine reads the
   * skills of a folder that exists here.
   * @param request - Session identity whose directory and preset select the catalog view.
   * @param signal - caller lifetime carried by the Remote transport; admitted catalog reads retain their existing completion semantics.
   * @returns user-invocable skill metadata without loading skill bodies.
   * @throws RemoteError when the Session cannot be inspected or no registry can serve it.
   * @throws {WorkingDirectoryUnavailableError} when the Session's workspace has no folder on this device.
   */
  @Remote
  async list(request: SkillListRequest, signal: AbortSignal): Promise<SkillListValue> {
    void signal
    const { sessionId } = request
    using observation = await this.inspect(sessionId)
    const owner = observation.header.owner
    if (!callerMayAccessSession(this.ctx, { owner })) {
      throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
    }
    const agentPreset = observation.projections?.values.agentPreset ?? undefined
    // A Session that records no directory has no project to scan, which is a smaller catalog rather than
    // an error; the registry already reads an absent cwd as "no project scope". A Session whose workspace
    // has no folder on this device is the different case, and resolving it refuses.
    const cwd = this.directoryFor(observation)

    const live = this.ctx.agents.get(sessionId)
    const presets = this.ctx.get('agentPresets')
    const scoped = live === undefined ? undefined : presets?.serviceFor(live, 'skills')
    const skillRegistry = scoped ?? this.ctx.get('skills')
    if (skillRegistry === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'skill registry is absent: neither this session\'s agent preset nor the host composition mounts @aeven/skill',
        {},
      )
    }

    const scope = await this.scopeFor(sessionId, agentPreset)
    try {
      const skills = (await skillRegistry.list({ cwd, owner, scope })).filter(isUserInvocable)
      return {
        skills: skills.map(skill => ({
          name: skill.name,
          description: skill.description,
          ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
          modelInvocable: skill.invocation.modelInvocable,
        })),
      }
    } catch (error: unknown) {
      throw new RemoteError('gateway/internal', `skill listing failed: ${String(error)}`, {})
    }
  }

  /**
   * Observe one Session for a catalog read and classify a failed inspection as the Remote error a caller sees.
   * @param sessionId - the Session to inspect.
   * @returns the retained observation with its projection values at this exact cut.
   * @throws RemoteError `session/not-found` when no such Session exists, `gateway/internal` otherwise.
   */
  private async inspect(sessionId: SessionId): Promise<SessionObservation> {
    try {
      using observation = await this.ctx.sessionQuery.observeSession(sessionId)
      if (observation.projections === undefined) {
        throw new Error('skill catalog requires a projected Session observation')
      }
      return observation.retain()
    } catch (error: unknown) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
      }
      throw new RemoteError(
        'gateway/internal',
        `session "${sessionId}" could not be inspected: ${String(error)}`,
        {},
      )
    }
  }

  /**
   * The directory this device scans for the Session's project skills.
   *
   * A live Session answers through {@link sessionDirectory}. A cold one has no Session object, so the same
   * rule is applied to the observed cut: this device's workspace binding decides, and the recorded path only
   * says which directory the Session records and where inside its workspace the work sits. A Session this
   * process moved is live, so no entered directory applies to the cold branch.
   * @param observation - the exact Session cut being listed.
   * @returns the local directory, or undefined when the Session records none.
   * @throws {WorkingDirectoryUnavailableError} when the Session's workspace has no folder on this device.
   */
  private directoryFor(observation: SessionObservation): string | undefined {
    const live = this.ctx.get('sessions')?.get(observation.header.id)
    if (live !== undefined) return sessionDirectory(this.ctx, live)
    const folded = observation.projections?.values.workingDirectory
    const recorded = folded?.cwd ?? observation.header.cwd
    // Without the working-directory capability there are no workspace bindings and no replicated Sessions,
    // so the recorded directory is the only one there is.
    if (recorded === undefined || this.ctx.get('workingDirectory') === undefined) return recorded
    const registry = this.ctx.get('workspaceRegistry')
    const local = localDirectory({
      recorded: { cwd: recorded, root: folded?.root ?? recorded },
      placement: registry?.placeSession(observation.header.id) ?? { state: 'unfiled' },
      replicated: registry?.replicated(observation.header.id) ?? false,
      entered: undefined,
    })
    if (local.state === 'unresolved') {
      throw new WorkingDirectoryUnavailableError(observation.header.id, local.reason)
    }
    return local.state === 'local' ? local.cwd : undefined
  }

  /** Resolve a live or standing preset scope without creating an Agent. */
  private async scopeFor(
    sessionId: SessionId,
    agentPreset: string | undefined,
  ): Promise<ScopeKey | undefined> {
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) return live
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return undefined
    try {
      return await presets.standingKeyFor(agentPreset)
    } catch {
      // An unknown or unusable recorded preset falls back to the global registry.
      return undefined
    }
  }
}

export default SessionSkillCatalog
