/**
 * Default model selection for an Agent without a session-specific selection.
 *
 * @module @aeven/agent-default-model
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@aeven/agent'
import { ReasoningEffortId } from '@aeven/llm'
import type {} from '@aeven/settings'
import type {} from '@aeven/credentials'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Default model selection for Agents created without an explicit model. */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/** Settings namespace carrying the default model selection for future Agents. */
export const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = 'agent-default-model'

/** Stored and composed default model selection. */
export interface AgentDefaultModelSettings {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
}

/** Schema of the default Agent model settings section. */
export const AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA: z<AgentDefaultModelSettings> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
})

/** Composition entry for the default model selection. */
export interface Config {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** Project stored settings onto the Agent-facing selection type. */
function selection(settings: AgentDefaultModelSettings): ModelSelection {
  return {
    provider: settings.provider,
    model: settings.model,
    ...settings.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(settings.reasoningEffort) },
  }
}

/**
 * Owns the default model selection independently of any Host or transport.
 * The composition entry remains usable without a settings provider; when one
 * is mounted, its user layer is read live.
 */
export class AgentDefaultModelConfig extends Service {
  static Config: z<Config> = z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })

  private source: () => AgentDefaultModelSettings
  /**
   * Each signed-in account's own default, read when the account's session reaches this Host and again whenever its
   * section or the Host's changes; only kept on a settings provider that keeps account sections.
   */
  private readonly owners = new Map<string, AgentDefaultModelSettings>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentDefaultModel')
    const entry: AgentDefaultModelSettings = { provider: config.provider, model: config.model }
    this.source = () => entry
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA, entry, {
        reach: 'account',
        setSource: (current) => { this.source = current },
        // Every consumer reads through currentSelection(), so no registration-level fact
        // needs rebuilding when the settings document changes.
        onChange: () => {},
      })
      // A Host document change moves every account's resolved default; an account change moves only that one.
      settingsCtx.on('settings/document-updated', (ns) => {
        if (ns !== AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE) return
        for (const owner of this.owners.keys()) void this.prepare(owner)
      })
      settingsCtx.on('settings/account-updated', (owner, ns) => {
        if (ns === AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE) void this.prepare(owner)
      })
    })
    ctx.on('credentials/session-updated', (_ref, user) => { void this.prepare(user) })
  }

  /**
   * Read one account's own default so {@link currentSelection} answers for it. Without account sections, or for no
   * account, there is nothing to read.
   * @param owner - the account, when one is known.
   * @returns resolution once the account's default is in place.
   */
  async prepare(owner: string | undefined): Promise<void> {
    const settings = this.ctx.get('settings')
    if (owner === undefined || settings?.accountSections !== true) return
    try {
      const value = await settings.valueFor(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, owner)
      if (value !== undefined) this.owners.set(owner, value as AgentDefaultModelSettings)
    } catch (error) {
      this.ctx.logger.warn(`agent-default-model: reading an account's default failed: ${String(error)}`)
    }
  }

  /**
   * Read the current default model selection.
   * @param owner - the account the selection is for; its own default wins once {@link prepare} read it.
   * @returns a detached provider, model, and optional reasoning selection.
   */
  currentSelection(owner?: string): ModelSelection {
    return selection((owner === undefined ? undefined : this.owners.get(owner)) ?? this.source())
  }

  /**
   * Save the complete default model selection. A deployment without a settings
   * provider keeps its composition entry.
   * On a settings provider that keeps account sections, an account's choice is stored as that account's own.
   * @param next - resolved selection accepted by an entry point.
   * @param owner - the account choosing, when one is signed in.
   * @returns fulfillment after the optional settings write settles.
   */
  async saveSelection(next: ModelSelection, owner?: string): Promise<void> {
    const section: AgentDefaultModelSettings = {
      provider: next.provider,
      model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
    }
    const settings = this.ctx.get('settings')
    if (owner !== undefined && settings?.accountSections === true) {
      await settings.writeFor(owner, AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, 'replace', section)
      this.owners.set(owner, section)
      return
    }
    await settings?.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, section)
  }
}

export default AgentDefaultModelConfig
