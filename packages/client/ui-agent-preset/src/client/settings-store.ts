/**
 * Agent-preset roster store shared by the display surfaces.
 *
 * Options come from one `agentPresets.list` call. Writes target the settings
 * namespace's `default` field, which is what the host resolves at creation;
 * the management section is the surface that writes it.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@aeven/api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@aeven/client-store'
import type { AgentPresetRoster } from '@aeven/agent-presets/types'

/** The agent-preset settings namespace on the host wire. */
export const AGENT_PRESET_SETTINGS_NS = 'agent-presets'

/**
 * Persist one preset as the default for sessions created later.
 *
 * The default is a settings field rather than a preset property; the
 * management section writes it here — one home for which namespace and field
 * the host resolves at session creation.
 * @param ctx - the browser plugin context carrying the Remote namespaces.
 * @param id - the preset to make default.
 * @returns the failure message, or undefined once the write landed.
 */
export async function writeDefaultPreset(
  ctx: ClientContext,
  id: string,
): Promise<string | undefined> {
  const response = await ctx.remote.settings.update(
    AGENT_PRESET_SETTINGS_NS,
    { default: id },
    undefined,
  )
  return response.ok ? undefined : response.error.message
}

/** One selectable preset. */
export interface AgentPresetOption {
  /** Preset id, written to Settings and the label's fallback. */
  id: string
  /** Whether the preset ships with the deployment or was authored locally. */
  trust: 'system' | 'user'
  /** Display name the preset published, absent when it published none. */
  name?: string
  /** One sentence on what the preset is for. */
  description?: string
}

/** One roster entry exactly as the host reports it. */
export type RosterPreset = AgentPresetRoster['presets'][number]

/** The roster, or the message to show in its place. */
export type RosterRead = { ok: true; value: AgentPresetRoster } | { ok: false; error: string }

const EMPTY_ROSTER: AgentPresetRoster = { presets: [], authorable: false }

/**
 * Ask the Host, turning a refusal into the message every surface shows.
 * @param ctx - the browser plugin context carrying the Remote namespaces.
 * @returns the roster, or the message to show in its place.
 */
async function requestRoster(ctx: ClientContext): Promise<RosterRead> {
  const result = await ctx.remote.agentPresets.list()
  if (result.ok) return { ok: true, value: result.value }
  // Agent presets are optional: without that service every session uses the
  // Host composition, so callers receive the same empty roster as a mounted
  // service with no configured roots.
  if (result.error.code === 'gateway/invocation-unavailable') return { ok: true, value: EMPTY_ROSTER }
  return { ok: false, error: result.error.message }
}

/**
 * The one roster the surfaces share, and the only thing that decides whether
 * asking the Host again is necessary.
 *
 * Held in the applying plugin rather than looked up from the context: every
 * service reached through a Cordis context arrives as a fresh proxy per
 * property access, so `ctx.remote` is never equal to itself and cannot key a
 * cache. The holder is passed to each surface instead, which also makes the
 * sharing visible at construction.
 */
export class AgentPresetRosterHolder {
  private answer: RosterRead | undefined
  private pending: Promise<RosterRead> | undefined
  /** Retired reads settle into nothing; only the current generation is held. */
  private generation = 0

  /** @param ctx - the browser plugin context carrying the Remote namespaces. */
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Reach the Host, and hold what it answers.
   *
   * For a surface that changes the roster and then shows the result: only the
   * wire knows what its own write produced.
   * @returns the roster, or the message to show in its place.
   */
  async fresh(): Promise<RosterRead> {
    const generation = this.generation
    const answer = await requestRoster(this.ctx)
    this.hold(answer, generation)
    return answer
  }

  /**
   * Accept the held roster, else join a read already in flight, else raise one.
   *
   * For a surface that only displays the roster. The chip and the header label
   * are rebuilt every time navigation replaces the conversation scope, and
   * asked the Host for a deployment-wide roster on each hop.
   * @returns the roster, or the message to show in its place.
   */
  async held(): Promise<RosterRead> {
    if (this.answer !== undefined) return this.answer
    if (this.pending !== undefined) return this.pending
    const generation = this.generation
    const pending = requestRoster(this.ctx)
    this.pending = pending
    try {
      const answer = await pending
      this.hold(answer, generation)
      return answer
    } finally {
      // Only if an invalidation has not already replaced it.
      if (this.pending === pending) this.pending = undefined
    }
  }

  /**
   * Retire the held roster and any read in flight.
   *
   * Nothing expires on its own: every route that changes the roster announces
   * itself, and each one calls this. A change arriving by none of them is
   * served stale until one does.
   */
  invalidate(): void {
    this.generation += 1
    this.answer = undefined
    this.pending = undefined
  }

  /**
   * Keep an answer only while it still describes the current roster.
   * @param answer - what the read returned.
   * @param generation - the generation the read was raised under.
   */
  private hold(answer: RosterRead, generation: number): void {
    // A refusal is not an answer to hold: a failure nobody can clear would
    // become what every later read inherits.
    if (answer.ok && this.generation === generation) this.answer = answer
  }
}

/**
 * The opening move every roster-backed surface makes: refuse a read that is
 * already in flight, mark the store loading, then read.
 *
 * A surface that gets `undefined` returns without touching its snapshot
 * further — either another read owns it, or this one already wrote the
 * failure. What differs between surfaces starts after this.
 * @param store - the surface's own snapshot store.
 * @param read - how this surface reads: {@link AgentPresetRosterHolder.fresh}
 * reaches the Host, {@link AgentPresetRosterHolder.held} accepts an answer
 * already held. A surface that changes the roster needs the former.
 * @returns the roster, or undefined when the caller should return.
 */
export async function beginRosterRead<S extends { status: string; error: string | null }>(
  store: SnapshotStore<S>,
  read: () => Promise<RosterRead>,
): Promise<AgentPresetRoster | undefined> {
  const before = store.getSnapshot()
  if (before.status === 'loading') return undefined
  store.set({ ...before, status: 'loading', error: null })
  const roster = await read()
  if (roster.ok) return roster.value
  store.set({ ...store.getSnapshot(), status: 'error', error: roster.error })
  return undefined
}

/**
 * The roster entries as the pickers render them: healthy presets only.
 *
 * The chip exists to choose the NEXT session's composition, and a broken
 * preset cannot compose one — offering it would defer the discovery of that
 * fact to a failed session start. The management section renders the full
 * roster (broken rows included) from its own store instead.
 *
 * The chip, the header label, and the management section all show the same
 * facts, and `exactOptionalPropertyTypes` makes "absent" and "present as
 * undefined" different shapes — so the spread dance belongs in one place rather than
 * once per store.
 * @param presets - the roster the host answered with.
 * @returns one option per selectable preset, in roster order.
 */
export function presetOptions(
  presets: readonly { id: string; trust: 'system' | 'user'; name?: string; description?: string; broken?: string }[],
): AgentPresetOption[] {
  return presets.filter(preset => preset.broken === undefined).map(preset => ({
    id: preset.id,
    trust: preset.trust,
    ...preset.name === undefined ? {} : { name: preset.name },
    ...preset.description === undefined ? {} : { description: preset.description },
  }))
}

/** Agent-preset roster snapshot for the display surfaces. */
export interface AgentPresetSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  error: string | null
  options: readonly AgentPresetOption[]
}

const INITIAL: AgentPresetSettingsState = {
  status: 'idle',
  error: null,
  options: [],
}

/** Reads the roster for the surfaces that only display it. */
export class AgentPresetSettingsController {
  /** Roster snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<AgentPresetSettingsState> = createSnapshotStore(INITIAL)

  /**
   * @param roster - the shared roster; this surface only displays it.
   */
  constructor(
    private readonly roster: AgentPresetRosterHolder,
  ) {}

  private set(patch: Partial<AgentPresetSettingsState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Load the roster. An empty roster means the deployment composes no
   * presets, which is a valid deployment rather than a failure — the
   * surfaces report `unavailable` and render nothing.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    const roster = await beginRosterRead(this.store, () => this.roster.held())
    if (roster === undefined) return
    const { presets } = roster
    if (presets.length === 0) {
      this.set({ status: 'unavailable', options: [] })
      return
    }
    this.set({
      status: 'ready',
      error: null,
      options: presetOptions(presets),
    })
  }

}
