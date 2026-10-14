/**
 * How each person wants Aeven to talk with them: a voice and notes in their own words, stored per signed-in
 * account. The name Aeven calls them is their account display name, which reaches the model as `<user_profile>`.
 *
 * One Host row owns the store and both Consumers: the `personalization` Remote behind Settings → Personalization,
 * and a system-prompt section installed in every agent's scope that renders the session owner's preferences
 * after the persona. The section is part of the system prompt, which every `request/header` event records, so a
 * change is reconstructable from the session log from the request it first reached.
 *
 * @module @aeven/personalization
 */
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@aeven/typert-protocol'
import type { Agent } from '@aeven/agent'
import type {} from '@aeven/identity-user'
import type {} from '@aeven/system-prompt'
import { PersonalizationStore } from './store.ts'
import type { PersonalizationChange, PersonalizationUpdate, PersonalizationView } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Personalization Remote controller. */
    personalizationController: PersonalizationController
  }
}

/** Prompt-section name of the owner's preferences. */
export const PERSONALIZATION_SECTION = 'user:personalization'

/** Service configuration. */
export interface Config {
  /** Absolute directory holding one document per account. */
  root: string
  /**
   * Longest notes text a person can store. The block is paid for on every request of its owner, so it stays
   * bounded, and a longer text is refused rather than clipped.
   */
  maxNotesChars: number
  /** Prompt-section order; directly after the persona, so the preferences read as an amendment to it. */
  promptOrder: number
}

/** The signed-in person's personalization, and the prompt section rendered from it. */
export default class PersonalizationController extends TypertRemoteService {
  static inject = ['typert', 'identityUsers', 'agents']

  static Config: z<Config> = z.object({
    root: z.string().min(1).required(),
    maxNotesChars: z.natural().min(1).default(1500),
    promptOrder: z.number().default(10),
  })

  private readonly store: PersonalizationStore

  /**
   * @param ctx - Host context carrying identity and the agent registry.
   * @param config - storage root, bounds and section order.
   * @throws when the configured root is not an absolute directory.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'personalizationController', { namespace: 'personalization' })
    if (!isAbsolute(config.root)) throw new Error(`personalization root must be absolute: ${config.root}`)
    this.store = new PersonalizationStore(config.root, config.maxNotesChars)

    /* jscpd:ignore-start -- mirrors @aeven/memory-context's per-agent prompt-section fibers for its own block */
    // Registered in each agent's own scope, so each session renders the preferences of its owner. The text is a
    // provider evaluated at every assembly; the store answers from cache unless the owner's document changed.
    const fibers = new Map<Agent, ReturnType<Context['inject']>>()
    const install = (agent: Agent): void => {
      if (fibers.has(agent)) return
      fibers.set(agent, agent.ctx.inject(['systemPrompt'], (scope) => {
        scope.systemPrompt.section({
          name: PERSONALIZATION_SECTION,
          order: config.promptOrder,
          text: () => {
            const owner = agent.session.header.owner
            return owner === undefined ? '' : this.store.block(owner)
          },
        })
      }))
    }
    const uninstall = (agent: Agent): void => {
      const fiber = fibers.get(agent)
      if (fiber === undefined) return
      fibers.delete(agent)
      void fiber.dispose().catch((error: unknown) => {
        ctx.logger('personalization').warn(`section cleanup failed for ${agent.session.id}: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    for (const agent of ctx.agents.list()) install(agent)
    ctx.on('agent/created', ({ agent }) => { install(agent) })
    ctx.on('agent/disposed', ({ agent }) => { uninstall(agent) })
    ctx.effect(() => () => {
      for (const agent of [...fibers.keys()]) uninstall(agent)
    }, 'personalization.sections')
    /* jscpd:ignore-end */
  }

  /**
   * The caller's preferences and the bounds a change must fit.
   * @returns the current preferences.
   */
  @Remote
  get(): PersonalizationView {
    return this.store.read(this.owner())
  }

  /**
   * Change some of the caller's preferences; an absent field keeps its value. The next request of each of the
   * caller's sessions renders the result.
   * @param update - the fields to change.
   * @returns what changed, with the reason when the notes were over their bound.
   */
  @Remote
  update(update: PersonalizationUpdate): PersonalizationChange {
    return this.store.update(this.owner(), update)
  }

  private owner(): string {
    const owner = this.ctx.identityUsers.actingUser()?.id
    if (owner === undefined) throw new Error('personalization needs a signed-in user')
    return owner
  }
}
