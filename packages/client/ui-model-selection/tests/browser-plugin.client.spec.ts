/**
 * ui-model-selection browser half on a real cordis Context with fake command/slots/
 * connection faces and real session scopes: the plugin mounts ModelDirectoryResolver
 * as `models`, the /model contribution and the conversation.input.model
 * seat both register, and every entry resolves the SAME per-session directory
 * through the service. The seat's Model row opens the SAME popupSelect spec the
 * /model command registered (spec identity, not a lookalike), and its Effort row
 * opens the second spec over that same shell — so a selection submitted through
 * any of them is the current the seat's labels and the lists' next options pass
 * all show, the one-shared-state contract of the entries.
 * Scope disposal drops the directory (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { createScope } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  ModelCatalogFailure, ModelProviderGroup, ModelSelection, ModelSelectionProjection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { CommandContribution, CommandUiSpec, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ModelSelectInjected } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

const sid = (k: string): SessionId => k as SessionId

const GROUPS = [{
  id: 'deepseek-official',
  name: 'DeepSeek',
  models: [
    {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek-V4-Flash',
      reasoning: {
        efforts: [
          { id: 'off', name: 'Off' },
          { id: 'high', name: 'High' },
          { id: 'max', name: 'Max' },
        ],
        defaultEffort: 'high',
      },
    },
    {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek-V4-Pro',
      reasoning: {
        efforts: [
          { id: 'off', name: 'Off' },
          { id: 'high', name: 'High' },
          { id: 'max', name: 'Max' },
        ],
        defaultEffort: 'high',
      },
    },
  ],
}]

/** Boot the plugin over fake faces + a stateful fake host (current moves on selectModel). */
async function bench(
  groups: readonly ModelProviderGroup[] = GROUPS,
  failures: readonly ModelCatalogFailure[] = [],
) {
  const ctx = new Context()
  let defaultSelection: ModelSelection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
  let selected = defaultSelection
  const calls = { models: 0, select: 0 }
  const projections = new Map<SessionId, SnapshotStore<ModelSelectionProjection | undefined>>()
  // Whether the Host reports an adapter for the current route; the composer
  // block follows this, never catalog membership.
  let routable = true
  const sessionRemote = {
    modelCatalog: () => {
      calls.models += 1
      return Promise.resolve({
        ok: true as const,
        value: {
          default: defaultSelection,
          routableProviders: routable ? ['deepseek-official'] : [],
          groups,
          failures,
        },
      })
    },
    selectModel: (payload: { sessionId: SessionId; provider: string; model: string; reasoningEffort?: string }) => {
      calls.select += 1
      selected = {
        provider: payload.provider,
        model: payload.model,
        ...payload.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: payload.reasoningEffort },
      }
      projections.get(payload.sessionId)?.set({ lastUsed: null, next: selected })
      return Promise.resolve({ ok: true as const, value: { selected } })
    },
  }
  const remote = Object.assign(new TestRemote(ctx), { session: sessionRemote })
  ctx.reflect.provide('remote.session', sessionRemote)
  const blocks = new Map<SessionId, { reason: string } | undefined>()
  ctx.provide('conversation', {
    blocks: {
      set: (id: SessionId, block: { reason: string } | undefined) => { blocks.set(id, block) },
    },
  })
  let contribution: CommandContribution | undefined
  // The seat's tokenless open paths: recorded so a case can prove each row opens
  // a shared spec rather than a private picker.
  const opened: { sessionId: SessionId; command: string; spec: CommandUiSpec }[] = []
  ctx.provide('commandUi', {
    register(c: CommandContribution) {
      contribution = c
      return () => { contribution = undefined }
    },
    openSelect(sessionId: SessionId, command: string, spec: CommandUiSpec) {
      opened.push({ sessionId, command, spec })
      return true
    },
  })
  const seats = new Map<string, {
    inject: ((sessionId: SessionId) => ModelSelectInjected) | undefined
    locale: string | undefined
  }>()
  ctx.provide('slots', {
    inject(_name: string, callback: () => () => void) { return callback() },
    register(options: { name: string; locale?: string; inject?: (sessionId: SessionId) => ModelSelectInjected }) {
      seats.set(options.name, { inject: options.inject, locale: options.locale })
      return () => { seats.delete(options.name) }
    },
  })
  const localeRuntime = new LocaleRuntime(ctx)
  // This spec asserts the shipped Chinese copy. There is no jsdom `window` in
  // this lane, so browser-language detection never runs and the locale comes
  // from FALLBACK_LOCALE (en): state the asserted locale explicitly.
  localeRuntime.setLocale('zh')
  ctx.provide('locale', localeRuntime)
  const scopes = new Map<SessionId, Context>()
  const addressed = new Set<SessionId>()
  ctx.provide('sessions', {
    scope: (id: SessionId) => scopes.get(id),
    binding: (id: SessionId) => {
      const scope = scopes.get(id)
      const projection = projections.get(id)
      return scope === undefined || projection === undefined
        ? undefined
        : {
          sessionId: id,
          session: { projections: { faceOf: () => projection } },
          ctx: scope,
        }
    },
    subagentAddress: (id: SessionId) => addressed.has(id)
      ? { parentSessionId: sid('parent'), childSessionId: id, mode: 'continuable' as const }
      : undefined,
  })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  await ctx.plugin(function probe() {}).await()
  const mint = (key: string) => {
    const id = sid(key)
    const handle = createScope(ctx, id)
    scopes.set(id, handle.ctx)
    projections.set(id, createSnapshotStore<ModelSelectionProjection | undefined>({
      lastUsed: null,
      next: null,
    }))
    return handle
  }
  /** Ensure one session's shared catalog is loaded (errors land on the store). */
  const load = (key: string): void => {
    void ctx.modelDirectories.directoryFor(sid(key)).load().catch(() => { /* surfaced on the store */ })
  }
  /** The rows the shared shell would render for one list. */
  const optionsOf = async (key: string, spec: CommandUiSpec): Promise<readonly SelectOption[]> =>
    spec.options(projection(key), new AbortController().signal)
  /** Settle one row by its label, exactly as a click in the shell does. */
  const pick = async (key: string, spec: CommandUiSpec, label: string): Promise<void> => {
    const rows = await optionsOf(key, spec)
    const option = rows.find(o => o.label === label)
    if (option === undefined) throw new Error(`no row labelled "${label}" in ${rows.map(o => o.label).join(', ')}`)
    await spec.onSelect(option, projection(key))
  }
  /** Drive one of the seat's two rows and return the spec it opened. */
  const seatSpec = (key: string, row: 'model' | 'effort'): CommandUiSpec => {
    const face = seats.get('conversation.input.model')!.inject!(sid(key))
    if (row === 'model') face.openModel()
    else face.openEffort()
    return opened.at(-1)!.spec
  }
  return {
    ctx, fiber, mint, calls, remote, load, opened, seatSpec,
    optionsOf,
    pickModel: (key: string, label: string) => pick(key, contribution!.ui, label),
    pickEffort: (key: string, label: string) => pick(key, seatSpec(key, 'effort'), label),
    contribution: () => contribution!,
    seat: () => seats.get('conversation.input.model')!,
    hostCurrent: () => selected,
    setHostCurrent: (selection: ModelSelection) => { defaultSelection = selection },
    setProjected: (id: SessionId, value: ModelSelectionProjection) => { projections.get(id)?.set(value) },
    address: (id: SessionId) => { addressed.add(id) },
    setRoutable: (next: boolean) => { routable = next },
    blockOf: (key: string) => blocks.get(sid(key)),
  }
}

const projection = (id: string) => ({ sessionId: sid(id) })

describe('ui-model-selection entries', () => {
  it('registers the /model contribution and the composer model seat', async () => {
    const b = await bench()
    expect(b.contribution().name).toBe('model')
    expect(b.contribution().ui.kind).toBe('popupSelect')
    expect(b.seat().inject).toBeTypeOf('function')
    // Copy rides the standard locale seat.
    expect(b.seat().locale).toBe('model')
  })

  it('opens the SAME model spec from the seat\'s Model row and the /model command', async () => {
    const b = await bench()
    b.mint('s1')

    const spec = b.seatSpec('s1', 'model')

    expect(b.opened).toHaveLength(1)
    expect(b.opened[0]?.sessionId).toBe(sid('s1'))
    expect(b.opened[0]?.command).toBe('model')
    // Identity, not equality: one spec object backs both entries, so the two
    // surfaces cannot drift into different rows or search behavior.
    expect(spec).toBe(b.contribution().ui)
  })

  it('opens a second spec for the Effort row — the same shell, its own list', async () => {
    const b = await bench()
    b.mint('s1')

    const effort = b.seatSpec('s1', 'effort')

    expect(effort).not.toBe(b.contribution().ui)
    expect(effort.kind).toBe('popupSelect')
    // Identity and kind are what this case pins; the effort spec's rows are
    // pinned by the cases below.
  })

  it('the model list marks the host current active and carries the provider group in the detail', async () => {
    const b = await bench()
    b.mint('s1')
    const options = await b.optionsOf('s1', b.contribution().ui)
    expect(options.map(o => o.label)).toEqual(['DeepSeek-V4-Flash', 'DeepSeek-V4-Pro'])
    expect(options[0]).toMatchObject({ active: true, detail: 'DeepSeek' })
    expect(options[1]?.active).toBeUndefined()
  })

  it('a described model keeps its blurb out of the row and findable through keywords', async () => {
    // DeepSeek advertises a sentence per model and OpenRouter none, so a
    // rendered blurb would make the two provider lists read differently.
    const b = await bench([{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{
        id: 'deepseek-v4-pro',
        name: 'DeepSeek-V4-Pro',
        description: 'Prefer for routine or latency-sensitive tasks.',
      }],
    }])
    b.mint('s1')
    const options = await b.optionsOf('s1', b.contribution().ui)
    expect(options[0]).toMatchObject({
      detail: 'DeepSeek',
      keywords: 'Prefer for routine or latency-sensitive tasks.',
    })
  })

  it('the effort list is the current model\'s levels alone, under the model it belongs to', async () => {
    const b = await bench()
    b.mint('s1')
    const options = await b.optionsOf('s1', b.seatSpec('s1', 'effort'))

    // The adapter configures a default, so no provider-default row appears and
    // the effective effort (the model default) is the marked one.
    expect(options.map(o => o.label)).toEqual(['Off', 'High', 'Max'])
    expect(options.find(o => o.label === 'High')).toMatchObject({ detail: 'DeepSeek-V4-Flash', active: true })
    expect(options.find(o => o.label === 'Off')?.active).toBeUndefined()
  })

  it('an effort row keeps the current route and swaps only the effort', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    await b.pickModel('s1', 'DeepSeek-V4-Pro')
    expect(face.directory.getSnapshot().current?.model).toBe('deepseek-v4-pro')

    await b.pickEffort('s1', 'Max')

    expect(b.hostCurrent()).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })
    // The next pass reflects both the route and the effort without any reload.
    const models = await b.optionsOf('s1', b.contribution().ui)
    expect(models.find(o => o.label === 'DeepSeek-V4-Pro')).toMatchObject({ active: true })
    const efforts = await b.optionsOf('s1', b.seatSpec('s1', 'effort'))
    expect(efforts.find(o => o.label === 'Max')).toMatchObject({ active: true })
  })

  it('adds a provider-default effort row only when the adapter configures no model default', async () => {
    // A dedicated bench: the shared catalog is fetched once, so the groups must
    // be the ones this case asserts from the first load.
    const b = await bench([{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{
        id: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
        reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
      }],
    }])
    b.mint('s1')

    const labels = (await b.optionsOf('s1', b.seatSpec('s1', 'effort'))).map(o => o.label)
    expect(labels).toEqual(['Default', 'Standard'])
  })

  it('rejects a failure row: an unselectable provider never submits a half selection', async () => {
    // A provider whose catalog failed lists as a row for visibility, but the
    // row must not resolve to a selection.
    const b = await bench(GROUPS, [{ id: 'broken', name: 'Broken', message: '401 unauthorized' }])
    b.mint('s1')

    const options = await b.optionsOf('s1', b.contribution().ui)
    expect(options.find(o => o.label === 'Broken')).toMatchObject({ detail: '目录加载失败：401 unauthorized' })
    await expect(b.pickModel('s1', 'Broken')).rejects.toThrow(/catalog failed to load/)
    expect(b.calls.select).toBe(0)
  })

  it('a selection made from the seat-opened list is the current every entry shows next', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    b.seatSpec('s1', 'model')
    // Switch through the SHARED spec the seat's Model row opened.
    await b.pickModel('s1', 'DeepSeek-V4-Pro')

    expect(b.hostCurrent()).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'high',
    })
    expect(face.directory.getSnapshot().current).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'high',
    })
  })

  it('both entries share one directory instance per session, isolated across sessions', async () => {
    const b = await bench()
    b.mint('a')
    b.mint('b')
    const faceA = b.seat().inject!(sid('a'))
    const faceA2 = b.seat().inject!(sid('a'))
    const faceB = b.seat().inject!(sid('b'))
    expect(faceA.directory).toBe(faceA2.directory)
    expect(faceA.directory).not.toBe(faceB.directory)
    // The service face resolves the same instance the seat inject handed out.
    expect(b.ctx.modelDirectories.directoryFor(sid('a')).store).toBe(faceA.directory)
    await Promise.all([
      b.optionsOf('a', b.contribution().ui),
      b.optionsOf('b', b.contribution().ui),
    ])
    expect(b.calls.models).toBe(1)
  })

  it('keeps the durable projected selection while the eager catalog reconnects', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    await b.pickModel('s1', 'DeepSeek-V4-Pro')
    b.setHostCurrent({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })

    b.ctx.emit('connection/reset')
    expect(face.directory.getSnapshot()).toMatchObject({
      current: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      status: 'ready',
    })
    face.load()
    expect(face.directory.getSnapshot()).toMatchObject({
      current: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      status: 'ready',
    })
  })

  it('keeps the last complete view while a refreshed catalog catches up with projection', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    face.load()
    expect(face.directory.getSnapshot().current?.model).toBe('deepseek-v4-flash')

    b.remote.emit('settings/document-updated', ['llm-deepseek', 1])
    b.setProjected(sid('s1'), {
      lastUsed: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      next: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    })
    expect(face.directory.getSnapshot()).toMatchObject({
      current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      status: 'ready',
    })

    await vi.waitFor(() => {
      expect(face.directory.getSnapshot()).toMatchObject({
        current: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
        status: 'ready',
      })
    })
  })

  it('scope disposal drops the directory; a reborn scope gets a fresh one', async () => {
    const b = await bench()
    const first = b.mint('s1')
    const face1 = b.seat().inject!(sid('s1'))
    await first.fiber.dispose()
    b.mint('s1')
    const face2 = b.seat().inject!(sid('s1'))
    expect(face2.directory).not.toBe(face1.directory)
  })

  it('blocks the composer only once the Host reports the route unservable', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))

    // Before the first load nothing is known. `null` is not `false`: a slow
    // or unreachable Host must never lock a working composer.
    expect(b.blockOf('s1')).toBeUndefined()
    face.load()
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')).toBeUndefined()
    expect(b.calls.models).toBe(1)

    b.setRoutable(false)
    b.remote.emit('settings/document-updated', ['llm-deepseek', 1])
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')?.reason).toBe(zh['blocked.composer'])
    expect(b.calls.models).toBe(2)

    // Recovering clears it without a reload of the surface.
    b.setRoutable(true)
    b.remote.emit('llm/adapters-updated', [])
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')).toBeUndefined()
    expect(b.calls.models).toBe(3)
  })

  it('never blocks on catalog membership alone', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    // A model the route serves but no longer advertises: the seat prompts for
    // a selection, the composer stays usable. Blocking here would break a
    // supported configuration (a narrowed `models` list over a live route).
    b.setHostCurrent({ provider: 'deepseek-official', model: 'unlisted' })
    face.load()
    await Promise.resolve()
    await Promise.resolve()
    const snapshot = face.directory.getSnapshot()
    expect(snapshot.groups.flatMap(group => group.models.map(model => model.id))).not.toContain('unlisted')
    expect(b.blockOf('s1')).toBeUndefined()
  })

  it('clears its block when the session scope goes', async () => {
    const b = await bench()
    const scope = b.mint('s1')
    b.setRoutable(false)
    const face = b.seat().inject!(sid('s1'))
    face.load()
    b.remote.emit('llm/adapters-updated', [])
    await vi.waitFor(() => { expect(b.blockOf('s1')).toBeDefined() })

    await scope.fiber.dispose()
    expect(b.blockOf('s1')).toBeUndefined()
  })

  it('an unknown session fails loud at the seat inject', async () => {
    const b = await bench()
    expect(() => b.seat().inject!(sid('ghost'))).toThrow(/resolved no scope/)
  })

  it('withholds every model entry from addressed subagent sessions without Agent-bound RPCs', async () => {
    const b = await bench()
    // The specs are shared across sessions, so capture the effort list from an
    // ordinary session and address it at the subagent below.
    b.mint('probe')
    const effortSpec = b.seatSpec('probe', 'effort')
    b.mint('child')
    b.address(sid('child'))

    expect(b.contribution().available(projection('child'))).toBe(false)
    await expect(b.optionsOf('child', b.contribution().ui))
      .rejects.toThrow(/unavailable for addressed subagent/)
    await expect(b.optionsOf('child', effortSpec))
      .rejects.toThrow(/unavailable for addressed subagent/)

    const face = b.seat().inject!(sid('child'))
    expect(face.available).toBe(false)
    // Neither row opens its list for such a session, and the label refresh is a no-op.
    const before = b.opened.length
    face.openModel()
    face.openEffort()
    expect(b.opened).toHaveLength(before)
    face.load()
    await expect(b.ctx.modelDirectories.directoryFor(sid('child')).load())
      .rejects.toThrow(/unavailable for addressed subagent/)
    await expect(b.ctx.modelDirectories.directoryFor(sid('child')).select({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
    })).rejects.toThrow(/unavailable for addressed subagent/)
    b.ctx.emit('connection/reset')
    await Promise.resolve()
    expect(b.calls.select).toBe(0)
  })
})
