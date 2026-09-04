/**
 * Agent-preset roster store shared by the display surfaces.
 *
 * Options come from one `agentPresets.list` call. Writes target the settings
 * namespace's `default` field, which is what the host resolves at creation;
 * the management section is the surface that writes it.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AgentPresetRoster } from '@deepseek-ai/dsh-agent-presets/types'

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
 * Read the roster, turning a refusal into the message every surface shows.
 * @param ctx - the browser plugin context carrying the Remote namespaces.
 * @returns the roster, or the message to show in its place.
 */
export async function readRoster(ctx: ClientContext): Promise<RosterRead> {
  const answer = await requestRoster(ctx)
  const key = rosterKey(ctx)
  // A fresh answer is worth holding for the surfaces that accept a held one,
  // so a management read doubles as the seat's refresh.
  if (answer.ok) rosterAnswers.set(key, { generation: rosterGenerations.get(key) ?? 0, answer })
  return answer
}

/**
 * Read the roster, accepting one already held for this context tree.
 *
 * For surfaces that re-read on every mount rather than on a change. The seat
 * is rebuilt each time navigation replaces the conversation scope, and asked
 * the Host for a deployment-wide roster every time; the held answer is the
 * same one the wire would return, because everything that changes the roster
 * calls {@link invalidateRoster}.
 * @param ctx - the browser plugin context carrying the Remote namespaces.
 * @returns the roster, or the message to show in its place.
 */
export async function readHeldRoster(ctx: ClientContext): Promise<RosterRead> {
  const key = rosterKey(ctx)
  const generation = rosterGenerations.get(key) ?? 0
  const held = rosterAnswers.get(key)
  if (held !== undefined && held.generation === generation) return held.answer
  const pending = rosterReads.get(key)
  if (pending !== undefined && pending.generation === generation) return pending.read
  const read = requestRoster(ctx)
  rosterReads.set(key, { generation, read })
  try {
    const answer = await read
    // A refusal is not an answer to hold: the next surface to ask should reach
    // the Host again rather than inherit a failure nobody can clear.
    if (answer.ok && (rosterGenerations.get(key) ?? 0) === generation) {
      rosterAnswers.set(key, { generation, answer })
    }
    return answer
  } finally {
    // Clear only this read's own entry: an invalidation during it may already
    // have replaced the slot, and dropping that one would strand its sharers.
    if (rosterReads.get(key)?.read === read) rosterReads.delete(key)
  }
}

/** Settled rosters per context tree, with the generation each was read under. */
const rosterAnswers = new WeakMap<object, { generation: number; answer: RosterRead }>()

/** Reads in flight per context tree, with the generation each was raised under. */
const rosterReads = new WeakMap<object, { generation: number; read: Promise<RosterRead> }>()

/** Current generation per context tree; absent means zero. */
const rosterGenerations = new WeakMap<object, number>()

/**
 * Keyed on the Remote namespace object rather than the Context: the seat
 * surface runs in an injected scope, a different Context from the one the
 * settings and section surfaces hold, while the service the read travels
 * through is one object for all three.
 * @param ctx - the browser plugin context carrying the Remote namespaces.
 * @returns the object identifying this context tree's roster.
 */
function rosterKey(ctx: ClientContext): object {
  return ctx.remote
}

/**
 * Retire the held roster and any read in flight, so the next
 * {@link readHeldRoster} reaches the Host.
 *
 * Nothing expires on its own: the roster is deployment state, and every way it
 * changes announces itself — a settings write, a preset copied or deleted
 * here, authoring a preset file, and a reconnect that may land on a Host whose
 * roster moved. A change arriving by none of those routes is served stale
 * until one does.
 * @param ctx - the browser plugin context carrying the Remote namespaces.
 */
export function invalidateRoster(ctx: ClientContext): void {
  const key = rosterKey(ctx)
  rosterGenerations.set(key, (rosterGenerations.get(key) ?? 0) + 1)
  rosterAnswers.delete(key)
}

/**
 * Issue one roster read.
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
 * The opening move every roster-backed surface makes: refuse a read that is
 * already in flight, mark the store loading, then read.
 *
 * A surface that gets `undefined` returns without touching its snapshot
 * further — either another read owns it, or this one already wrote the
 * failure. What differs between surfaces starts after this.
 * @param ctx - the browser plugin context carrying the Remote namespaces.
 * @param store - the surface's own snapshot store.
 * @param read - how this surface reads: {@link readRoster} reaches the Host,
 * {@link readHeldRoster} accepts an answer already held. A surface that
 * changes the directory it is showing needs the former; one that only
 * displays the roster can take the latter.
 * @returns the roster, or undefined when the caller should return.
 */
export async function beginRosterRead<S extends { status: string; error: string | null }>(
  ctx: ClientContext,
  store: SnapshotStore<S>,
  read: (ctx: ClientContext) => Promise<RosterRead> = readRoster,
): Promise<AgentPresetRoster | undefined> {
  const before = store.getSnapshot()
  if (before.status === 'loading') return undefined
  store.set({ ...before, status: 'loading', error: null })
  const roster = await read(ctx)
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
   * @param ctx - the browser plugin context (the roster read).
   */
  constructor(
    private readonly ctx: ClientContext,
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
    const roster = await beginRosterRead(this.ctx, this.store, readHeldRoster)
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
