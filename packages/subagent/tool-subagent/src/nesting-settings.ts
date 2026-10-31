/**
 * Host-owned switch deciding whether a delegated agent may delegate in turn.
 *
 * The switch is deployment-wide rather than per-session: every delegation tool
 * reads it at each start, so flipping it applies to the agents already running
 * and to every child they start afterwards. A child composition inherits the
 * parent's preset, so the child's own delegation tool resolves the same switch
 * without carrying a copy through the session log.
 *
 * @module @aeven/tool-subagent/nesting-settings
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/settings'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** User preference read by a delegation tool at every start. */
    subagentNesting: SubagentNestingConfig
  }
}

/** User-settings section for subagent nesting. */
export const SUBAGENT_NESTING_SETTINGS_NAMESPACE = 'subagent-nesting'

/** Stored user preference; the shipped composition defaults it off. */
export interface SubagentNestingSettings {
  /** Whether a child agent may start subagents of its own. */
  enabled: boolean
}

/** Schema served to settings clients for the switch. */
export const SUBAGENT_NESTING_SETTINGS_SCHEMA: z<SubagentNestingSettings> = z.object({
  enabled: z.boolean().default(false),
})

/** Optional deployment base for the switch. */
export interface Config {
  /** Initial enabled state inherited when the user document does not override it. */
  enabled?: boolean
}

/** Singleton settings owner read by the delegation tools. */
export class SubagentNestingConfig extends Service {
  static Config: z<Config> = z.object({
    enabled: z.boolean().default(false),
  })

  private source: () => SubagentNestingSettings

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'subagentNesting')
    // Cordis supplies the schema default; the fallback also covers direct construction.
    /* v8 ignore next 2 */
    const entry: SubagentNestingSettings = { enabled: config.enabled ?? false }
    this.source = () => entry
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(
        ctx,
        SUBAGENT_NESTING_SETTINGS_NAMESPACE,
        SUBAGENT_NESTING_SETTINGS_SCHEMA,
        entry,
        {
          setSource: (source) => { this.source = source },
          // Every start reads the current value, so nothing derived from the
          // source needs rebuilding when the document changes.
          onChange: () => {},
        },
      )
    })
  }

  /**
   * Read whether a child agent may start subagents of its own.
   * @returns the stored switch, defaulting to off.
   */
  current(): boolean {
    return this.source().enabled
  }
}

export const name = 'subagent-nesting-settings'
export default SubagentNestingConfig
