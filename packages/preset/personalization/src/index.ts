/**
 * How each person wants Aeven to talk with them: a voice, notes in their own words, and their own master prompt,
 * stored per signed-in account. The name Aeven calls them is their account display name, which reaches the model as
 * `<user_profile>`; what it calls them in conversation comes from the conversation itself, not from here.
 *
 * One Host row owns the store and both Consumers: the `personalization` Remote behind Settings → Personalization,
 * and the system-prompt sections installed in every agent's scope. The preferences render after the persona; a
 * person who wrote their own master prompt shadows the deployment's persona section for their own sessions only.
 * Both sit in the system prompt, which every `request/header` event records, so a change is reconstructable from
 * the session log from the request it first reached.
 *
 * @module @aeven/personalization
 */
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { scopeOf, scopeParentOf } from '@aeven/scope'
import { PERSONA_SECTION } from '@aeven/system-prompt'
import { Remote, TypertRemoteService } from '@aeven/typert-protocol'
import type { Agent } from '@aeven/agent'
import type {} from '@aeven/identity-user'
import { PersonalizationStore } from './store.ts'
import type { StoredChange } from './store.ts'
import type {
  PersonalizationChange, PersonalizationState, PersonalizationUpdate, PersonalizationView,
} from './types.ts'

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
  /** Longest master prompt a person can store; a longer text is refused rather than clipped. */
  maxMasterPromptChars: number
  /** Prompt-section order; directly after the persona, so the preferences read as an amendment to it. */
  promptOrder: number
}

/** The signed-in person's personalization, and the prompt sections rendered from it. */
export default class PersonalizationController extends TypertRemoteService {
  static inject = ['typert', 'identityUsers', 'agents', 'systemPrompt']

  static Config: z<Config> = z.object({
    root: z.string().min(1).required(),
    maxNotesChars: z.natural().min(1).default(1500),
    maxMasterPromptChars: z.natural().min(1).default(20000),
    promptOrder: z.number().default(10),
  })

  private readonly store: PersonalizationStore

  /**
   * @param ctx - Host context carrying identity, the agent registry, and the prompt registry.
   * @param config - storage root, bounds and section order.
   * @throws when the configured root is not an absolute directory.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'personalizationController', { namespace: 'personalization' })
    if (!isAbsolute(config.root)) throw new Error(`personalization root must be absolute: ${config.root}`)
    this.store = new PersonalizationStore(config.root, config.maxNotesChars, config.maxMasterPromptChars)

    /* jscpd:ignore-start -- mirrors @aeven/memory-context's per-agent prompt-section fibers for its own block */
    // Registered in each agent's own scope, so each session renders the preferences — and the master prompt — of
    // its owner. Both texts are providers evaluated at every assembly; the store answers from cache unless the
    // owner's document changed.
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
        // A delegated child may register a persona of its own in this same scope, so the person's master prompt
        // reaches the sessions they started, not those started for them.
        if ((agent.session.header.delegationDepth ?? 0) > 0) return
        scope.systemPrompt.section({
          name: PERSONA_SECTION,
          order: scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA'),
          text: () => this.masterPrompt(agent),
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
   * The caller's preferences, the master prompt their sessions read, and the bounds a change must fit.
   * @returns the current view.
   */
  @Remote
  get(): PersonalizationView {
    const owner = this.owner()
    return this.view(this.store.read(owner), owner)
  }

  /**
   * Change some of the caller's preferences; an absent field keeps its value. The next request of each of the
   * caller's sessions renders the result.
   * @param update - the fields to change.
   * @returns what changed, with the reason when a text was over its bound.
   */
  @Remote
  update(update: PersonalizationUpdate): PersonalizationChange {
    const owner = this.owner()
    return this.change(this.store.update(owner, update), owner)
  }

  /**
   * Put the deployment's shipped master prompt back in charge for the caller.
   * @returns what changed, with the view as it stands afterwards.
   */
  @Remote
  resetMasterPrompt(): PersonalizationChange {
    const owner = this.owner()
    return this.change(this.store.resetMasterPrompt(owner), owner)
  }

  private change(stored: StoredChange, owner: string): PersonalizationChange {
    return {
      changed: stored.changed,
      ...stored.reason === undefined ? {} : { reason: stored.reason },
      view: this.view(stored.state, owner),
    }
  }

  private view(state: PersonalizationState, owner: string): PersonalizationView {
    const custom = state.masterPrompt !== ''
    return {
      ...state,
      effectiveMasterPrompt: custom ? state.masterPrompt : this.shipped(owner),
      customMasterPrompt: custom,
    }
  }

  /** The text one agent's requests carry as their persona. */
  private masterPrompt(agent: Agent): string {
    const owner = agent.session.header.owner
    const stored = owner === undefined ? '' : this.store.read(owner).masterPrompt
    return stored === '' ? this.shippedSection(agent) : stored
  }

  /**
   * The deployment's shipped master prompt, as one of the caller's agents would read it without their own.
   * The agent's own scope is skipped: that layer is where this row shadows the persona.
   */
  private shipped(owner: string): string {
    const agent = this.callerAgent(owner)
    return agent === undefined ? (this.ctx.systemPrompt.sectionText(PERSONA_SECTION) ?? '') : this.shippedSection(agent)
  }

  private shippedSection(agent: Agent): string {
    const scope = scopeOf(agent.ctx)
    const parent = scope === undefined ? undefined : scopeParentOf(scope)
    return this.ctx.systemPrompt.sectionText(PERSONA_SECTION, parent === undefined ? {} : { scope: parent }) ?? ''
  }

  /** One of the caller's own agents, preferring a top-level one; used to read the prompt its sessions carry. */
  private callerAgent(owner: string): Agent | undefined {
    const owned = this.ctx.agents.list().filter(agent => agent.session.header.owner === owner)
    return owned.find(agent => (agent.session.header.delegationDepth ?? 0) === 0) ?? owned[0]
  }

  private owner(): string {
    const owner = this.ctx.identityUsers.actingUser()?.id
    if (owner === undefined) throw new Error('personalization needs a signed-in user')
    return owner
  }
}
