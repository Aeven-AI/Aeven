import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ISessions, SessionListState, SessionSummary,
} from '@aeven/api-session-controller/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@aeven/api-workspace-controller/client'
import type { ClientRemote, DirectoryListing } from '@aeven/api-remotes/client'
import { RemoteError } from '@aeven/client-test-runtime'
import type { RemoteResult } from '@aeven/api-remotes/client'
import { SessionId } from '@aeven/session/types'
import { DirectoryBrowseError, UiWorkspaceService } from '../src/client/navigation.ts'
import type { SessionUrlNavigation } from '../src/client/session-url.ts'

const sid = (id: string): SessionId => SessionId(id)
const wid = (id: string): WorkspaceId => id as WorkspaceId

afterEach(() => {
  vi.restoreAllMocks()
})

function workspace(
  id: string,
  sessionIds: readonly SessionId[] = [],
  createdAt = '2026-01-01T00:00:00.000Z',
): WorkspaceView {
  return {
    workspaceId: wid(id),
    isDefault: false,
    kind: 'folder',
    path: `/w/${id}`,
    title: id,
    sessionIds,
    createdAt,
    updatedAt: createdAt,
  }
}

/**
 * The built-in Chats registration as the Host projects it: virtual, so it
 * carries no directory of its own for its chats to sit in.
 */
function chats(sessionIds: readonly SessionId[] = []): WorkspaceView {
  return {
    workspaceId: wid('chats'),
    isDefault: true,
    kind: 'virtual',
    path: null,
    title: 'Chats',
    sessionIds,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: sid(id),
    createdAt: 0,
    displayTitle: id, title: id,
    running: false,
    blank: false,
    updatedAt: 0,
    ...overrides,
  }
}

function sessionState(
  summaries: readonly SessionSummary[] = [],
  current?: SessionId,
  phase: SessionListState['phase'] = 'ready',
): SessionListState {
  return {
    ids: summaries.map(item => item.id),
    byId: Object.fromEntries(summaries.map(item => [item.id, item])),
    current,
    phase,
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function workspaceState(
  items: WorkspaceSnapshot['items'] = [],
  archivedSessionIds: readonly SessionId[] = [],
  phase: WorkspaceSnapshot['phase'] = 'ready',
): WorkspaceSnapshot {
  return {
    items,
    archivedSessionIds,
    phase,
    state: phase === 'ready' ? 'idle' : 'loading',
    error: null,
  }
}

class MutableSource<T> {
  private readonly listeners = new Set<() => void>()

  constructor(private value: T) {}

  getSnapshot(): T {
    return this.value
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(value: T): void {
    this.value = value
    for (const listener of [...this.listeners]) listener()
  }

  update(update: (value: T) => T): void {
    this.set(update(this.value))
  }

  listenersSnapshot(): readonly (() => void)[] {
    return [...this.listeners]
  }
}

class FakeSessionSnapshot {
  private readonly listeners = new Set<() => void>()

  constructor(private openState: 'cold' | 'loading' | 'open' | 'error' = 'cold') {}

  getSnapshot(): { openState: 'cold' | 'loading' | 'open' | 'error' } {
    return { openState: this.openState }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setOpenState(openState: 'cold' | 'loading' | 'open' | 'error'): void {
    this.openState = openState
    for (const listener of [...this.listeners]) listener()
  }
}

class FakeSessions {
  readonly list: MutableSource<SessionListState>
  readonly create: ReturnType<typeof vi.fn<ISessions['create']>>
  readonly open: ReturnType<typeof vi.fn<(id: SessionId) => void>>
  readonly clear: ReturnType<typeof vi.fn<() => void>>
  readonly faces = new Map<SessionId, FakeSessionSnapshot>()

  constructor(initial: SessionListState) {
    this.list = new MutableSource(initial)
    this.create = vi.fn<ISessions['create']>(async options =>
      options?.sessionId ?? sid(`created-${String(options?.workspaceId ?? 'none')}`))
    this.open = vi.fn((id: SessionId) => {
      this.list.update(state => ({ ...state, current: id }))
    })
    this.clear = vi.fn(() => {
      this.list.update(state => ({ ...state, current: undefined }))
    })
  }

  binding(id: SessionId): { session: FakeSessionSnapshot } | undefined {
    const session = this.faces.get(id)
    return session === undefined ? undefined : { session }
  }

  face(
    id: SessionId,
    openState: 'cold' | 'loading' | 'open' | 'error' = 'cold',
  ): FakeSessionSnapshot {
    const existing = this.faces.get(id)
    if (existing !== undefined) return existing
    const created = new FakeSessionSnapshot(openState)
    this.faces.set(id, created)
    return created
  }
}

class FakeSessionUrl implements SessionUrlNavigation {
  readonly pushes: Array<SessionId | undefined> = []
  readonly replacements: Array<SessionId | undefined> = []
  private readonly listeners = new Set<() => void>()
  /** False while the address is another surface's, as `/i/<id>` is. */
  private owned = true

  constructor(private current?: SessionId) {}

  ownsAddress(): boolean {
    return this.owned
  }

  read(): SessionId | undefined {
    return this.owned ? this.current : undefined
  }

  // Like the browser projection, writes leave another surface's address alone.
  push(sessionId: SessionId | undefined): void {
    if (!this.owned) return
    this.current = sessionId
    this.pushes.push(sessionId)
  }

  replace(sessionId: SessionId | undefined): void {
    if (!this.owned) return
    this.current = sessionId
    this.replacements.push(sessionId)
  }

  /** Browser Back/Forward onto another surface's address. */
  leave(): void {
    this.owned = false
    for (const listener of [...this.listeners]) listener()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  navigate(sessionId: SessionId | undefined): void {
    this.owned = true
    this.current = sessionId
    for (const listener of [...this.listeners]) listener()
  }
}

class FakeWorkspaces implements IWorkspaces {
  readonly list: MutableSource<WorkspaceSnapshot>
  readonly archiveCalls: SessionId[] = []
  onArchive: IWorkspaces['archiveSession'] = async (sessionId) => {
    this.list.update(state => ({
      ...state,
      archivedSessionIds: [...state.archivedSessionIds, sessionId],
    }))
  }

  declare readonly create: IWorkspaces['create']
  declare readonly rename: IWorkspaces['rename']
  declare readonly delete: IWorkspaces['delete']
  declare readonly insertBefore: IWorkspaces['insertBefore']
  declare readonly insertSessionBefore: IWorkspaces['insertSessionBefore']

  constructor(initial: WorkspaceSnapshot) {
    this.list = new MutableSource(initial)
  }

  archiveSession(sessionId: SessionId): Promise<void> {
    this.archiveCalls.push(sessionId)
    return this.onArchive(sessionId)
  }
}

const listing: DirectoryListing = {
  path: '/home/u',
  home: '/home/u',
  crumbs: [{ name: '/', path: '/', hidden: false }],
  entries: [{ name: 'project', path: '/home/u/project', hidden: false }],
  truncated: false,
}

/** The directory-picking Remote namespace, recorded and scripted per case. */
class FakeDirectoryPicker {
  readonly calls: { method: string; payload: unknown }[] = []

  onPick: () => Promise<RemoteResult<string | null>> = () => Promise.resolve({ ok: true, value: null })
  onList: () => Promise<RemoteResult<DirectoryListing>> = () => Promise.resolve({ ok: true, value: listing })
  onCreateDirectory: () => Promise<RemoteResult<string>> =
    () => Promise.resolve({ ok: true, value: '/home/u/new' })

  readonly remote: ClientRemote['directoryPicker'] = {
    pick: () => this.record('pick', {}, this.onPick()),
    list: (path?: string) => this.record('list', { path }, this.onList()),
    createDirectory: (path: string, name: string) =>
      this.record('createDirectory', { path, name }, this.onCreateDirectory()),
  }

  callsOf(method: string): unknown[] {
    return this.calls.filter(call => call.method === method).map(call => call.payload)
  }

  private record<T>(method: string, payload: unknown, result: Promise<T>): Promise<T> {
    this.calls.push({ method, payload })
    return result
  }
}

interface BenchOptions {
  readonly workspaces?: WorkspaceSnapshot
  readonly sessions?: SessionListState
  readonly sessionUrl?: FakeSessionUrl
}

function bench(options: BenchOptions = {}) {
  const ctx = new Context()
  const directoryPicker = new FakeDirectoryPicker()
  const workspaces = new FakeWorkspaces(options.workspaces ?? workspaceState([], [], 'pending'))
  const sessions = new FakeSessions(options.sessions ?? sessionState([], undefined, 'pending'))
  const sessionUrl = options.sessionUrl ?? new FakeSessionUrl()
  const uiWorkspace = new UiWorkspaceService(
    ctx,
    directoryPicker.remote,
    workspaces,
    sessions as unknown as ISessions,
    sessionUrl,
  )
  return { ctx, directoryPicker, sessions, sessionUrl, uiWorkspace, workspaces }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('UiWorkspaceService', () => {
  it('projects Session selection into history and follows browser navigation', async () => {
    const first = summary('first')
    const second = summary('second')
    const requested = new FakeSessionUrl(second.id)
    const routed = bench({
      sessions: sessionState([first, second], first.id),
      workspaces: workspaceState([workspace('one', [first.id, second.id])]),
      sessionUrl: requested,
    })
    expect(routed.sessions.open).toHaveBeenCalledWith(second.id)
    expect(routed.sessionUrl.pushes).toEqual([])

    routed.sessions.open(first.id)
    expect(routed.sessionUrl.pushes).toEqual([first.id])
    routed.sessionUrl.navigate(second.id)
    expect(routed.sessions.open).toHaveBeenLastCalledWith(second.id)
    expect(routed.sessionUrl.pushes).toEqual([first.id])
    routed.sessionUrl.navigate(undefined)
    expect(routed.sessions.clear).toHaveBeenCalledOnce()

    routed.sessionUrl.navigate(sid('missing'))
    expect(routed.sessionUrl.replacements).toEqual([undefined])
    expect(routed.sessions.open).toHaveBeenCalledTimes(3)

    await routed.ctx.fiber.dispose()
    routed.sessionUrl.navigate(first.id)
    expect(routed.sessions.open).toHaveBeenCalledTimes(3)
  })

  it('leaves another surface\'s address alone and resumes on the chat\'s', () => {
    const first = summary('first')
    const second = summary('second')
    const routed = bench({
      sessions: sessionState([first, second], first.id),
      workspaces: workspaceState([workspace('one', [first.id, second.id])]),
    })
    expect(routed.sessionUrl.replacements).toEqual([first.id])

    // Back into Imagine: no New Session starts, and a selection change made
    // meanwhile writes no chat address over it.
    routed.sessionUrl.leave()
    routed.sessions.open(second.id)
    expect(routed.sessions.create).not.toHaveBeenCalled()
    expect(routed.sessionUrl.pushes).toEqual([])

    // Forward to a chat address: navigation follows it again.
    routed.sessionUrl.navigate(first.id)
    expect(routed.sessions.open).toHaveBeenLastCalledWith(first.id)
  })

  it('creates the chat an opening address names before any Session has it', async () => {
    // Following a New Session link in a new window is the case this serves: the
    // address was published before the chat existed, so the id it names is not
    // in the list yet and the window must claim it rather than fall back.
    const existing = summary('existing')
    const linked = sid('session-linked')
    const b = bench({
      sessions: sessionState([existing], existing.id),
      workspaces: workspaceState([workspace('home', [existing.id])]),
      sessionUrl: new FakeSessionUrl(linked),
    })
    b.sessions.create.mockImplementation(async options => options?.sessionId ?? sid('host-minted'))

    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenLastCalledWith(linked)
    })
    // The address's own id is the one created, so the new window shows the chat
    // the link promised instead of the previously current Session.
    expect(b.sessions.create).toHaveBeenCalledWith({
      workspaceId: wid('home'),
      sessionId: linked,
    })
    // Claimed outright: the URL is kept, never rewritten away.
    expect(b.sessionUrl.replacements).toEqual([])
  })

  it('abandons an opening address it cannot claim', async () => {
    // The lists have arrived but no Workspace exists to host the chat, so there
    // is nothing to create and the window must not present a URL naming a
    // Session that will never exist.
    const b = bench({
      sessions: sessionState([], undefined, 'ready'),
      workspaces: workspaceState([], [], 'ready'),
      sessionUrl: new FakeSessionUrl(sid('session-orphan')),
    })
    await flush()
    expect(b.sessions.create).not.toHaveBeenCalled()
    expect(b.sessionUrl.replacements).toEqual([undefined])
  })

  it('leaves the selection alone when the opening address already names it', () => {
    // Reconciling the first address must not re-open the Session the shell
    // already restored: that would push a second history entry for it.
    const first = summary('first')
    const b = bench({
      sessions: sessionState([first], first.id),
      workspaces: workspaceState([workspace('one', [first.id])]),
      sessionUrl: new FakeSessionUrl(first.id),
    })
    expect(b.sessions.open).not.toHaveBeenCalled()
    expect(b.sessionUrl.pushes).toEqual([])
  })

  it('ignores Back and Forward before the shell settles, while the list reloads, and on the current Session', () => {
    const first = summary('first')
    const url = new FakeSessionUrl(first.id)
    const b = bench({
      sessions: sessionState([first], first.id, 'pending'),
      workspaces: workspaceState([workspace('one', [first.id])], [], 'pending'),
      sessionUrl: url,
    })

    // Before the first lists arrive there is no selection to reconcile a
    // history entry against; the address is answered once they do.
    url.navigate(sid('early'))
    expect(b.sessions.open).not.toHaveBeenCalled()
    expect(b.sessions.clear).not.toHaveBeenCalled()

    b.workspaces.list.set(workspaceState([workspace('one', [first.id])]))
    b.sessions.list.set(sessionState([first], first.id))
    b.sessions.open.mockClear()

    // A history entry naming the Session already selected asks for no move.
    url.navigate(first.id)
    expect(b.sessions.open).not.toHaveBeenCalled()
    expect(b.sessions.clear).not.toHaveBeenCalled()

    // A reloading list cannot say whether the requested Session exists, so the
    // address is left alone until it settles again.
    b.sessions.list.set(sessionState([first], first.id, 'pending'))
    url.navigate(sid('while-pending'))
    expect(b.sessions.open).not.toHaveBeenCalled()
    expect(b.sessions.clear).not.toHaveBeenCalled()
  })

  it('replaces the initial entry before pushing later Session changes', () => {
    const first = summary('first')
    const second = summary('second')
    const b = bench({
      sessions: sessionState([first, second], first.id),
      workspaces: workspaceState([workspace('one', [first.id, second.id])]),
    })
    expect(b.sessionUrl.replacements).toEqual([first.id])
    b.sessions.open(second.id)
    b.sessions.clear()
    expect(b.sessionUrl.pushes).toEqual([second.id, undefined])
  })

  it('reuses only an unarchived member blank and coalesces concurrent creation', async () => {
    const b = bench()
    const memberBlank = sid('member-blank')
    const archivedBlank = sid('archived-blank')
    const summaries: readonly SessionSummary[] = [
      summary('stray', { blank: true, cwd: '/w/alpha' }),
      summary('member-blank', { blank: true, cwd: '/w/alpha' }),
      summary('active', { cwd: '/w/beta' }),
      summary('archived-blank', { blank: true, cwd: '/w/gamma' }),
    ]
    b.workspaces.list.set(workspaceState([
      workspace('alpha', [memberBlank]),
      workspace('beta', [sid('active')]),
      workspace('gamma', [archivedBlank]),
    ], [archivedBlank]))
    b.sessions.list.set({
      ...sessionState(summaries, memberBlank),
      ids: [sid('missing'), ...summaries.map(item => item.id)],
    })

    await expect(Promise.all([
      b.uiWorkspace.connectWorkspace(wid('alpha')),
      b.uiWorkspace.connectWorkspace(wid('alpha')),
    ])).resolves.toEqual([memberBlank, memberBlank])
    expect(b.sessions.create).not.toHaveBeenCalled()

    const creation = Promise.withResolvers<SessionId>()
    b.sessions.create.mockImplementation(() => creation.promise)
    const first = b.uiWorkspace.connectWorkspace(wid('beta'))
    const second = b.uiWorkspace.connectWorkspace(wid('beta'))
    expect(b.sessions.create).toHaveBeenCalledTimes(1)
    creation.resolve(sid('fresh-beta'))
    await expect(Promise.all([first, second])).resolves.toEqual([sid('fresh-beta'), sid('fresh-beta')])

    b.sessions.create.mockImplementation(async options => sid(`fresh-${String(options?.workspaceId)}`))
    await expect(b.uiWorkspace.connectWorkspace(wid('gamma'))).resolves.toBe(sid('fresh-gamma'))
    expect(b.sessions.create).toHaveBeenLastCalledWith({ workspaceId: wid('gamma') })
    await expect(b.uiWorkspace.connectWorkspace(wid('ghost')))
      .rejects.toThrow('uiWorkspace.connectWorkspace: unknown workspace ghost')
  })

  it('reuses the built-in Chats blank, whose chats have no directory to match', async () => {
    // Chats is virtual: every chat in it is accounted to it while sharing no
    // directory with it, so a cwd equality would never hold and each New
    // Session would create a second empty chat and strand unsent text in the
    // first one — the reported difference from a folder Workspace.
    const blank = sid('chats-blank')
    const b = bench({
      sessions: sessionState([
        summary('chats-blank', { blank: true }),
        summary('chats-active'),
      ], blank),
      workspaces: workspaceState([chats([blank, sid('chats-active')])]),
    })

    await expect(b.uiWorkspace.connectWorkspace(wid('chats'))).resolves.toBe(blank)
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('targets an explicit, current-session, then recent Workspace and reports failed starts', async () => {
    const current = summary('current', { cwd: '/w/current-home', updatedAt: 1 })
    const recent = summary('recent', { cwd: '/w/recent-home', updatedAt: 2 })
    const b = bench({
      sessions: sessionState([current, recent], current.id),
      workspaces: workspaceState([
        workspace('current-home', [current.id]),
        workspace('recent-home', [recent.id]),
      ]),
    })
    b.sessions.create.mockImplementation(async options => sid(`opened-${String(options?.workspaceId)}`))

    b.uiWorkspace.startSession(wid('recent-home'))
    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenLastCalledWith(sid('opened-recent-home'))
    })

    b.sessions.open(current.id)
    b.uiWorkspace.startSession()
    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenLastCalledWith(sid('opened-current-home'))
    })

    b.sessions.clear()
    b.uiWorkspace.startSession()
    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenLastCalledWith(sid('opened-recent-home'))
    })

    const empty = bench()
    empty.uiWorkspace.startSession()
    expect(empty.sessions.clear).toHaveBeenCalledOnce()

    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    b.sessions.create.mockRejectedValueOnce(new Error('create failed'))
    b.uiWorkspace.startSession(wid('recent-home'))
    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith('new session failed:', expect.any(Error))
    })
  })

  it('creates a link-named Session under the id the link published', async () => {
    // The New Session control is a real anchor, so the id has to exist before
    // there is a Session to name: the address is minted up front and the Host
    // is then asked to create exactly that chat.
    const home = summary('home', { cwd: '/w/home', updatedAt: 1 })
    const b = bench({
      sessions: sessionState([home], home.id),
      workspaces: workspaceState([workspace('home', [home.id])]),
    })
    b.sessions.create.mockImplementation(async options => options?.sessionId ?? sid('minted-by-host'))

    const target = b.uiWorkspace.newSessionHref()
    // A bare path for the address bar, and the prefixed id the client carries.
    expect(target.href).toBe(`/c/${target.sessionId.slice('session-'.length)}`)
    expect(target.sessionId.startsWith('session-')).toBe(true)

    b.uiWorkspace.startSession(undefined, target.sessionId)
    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenLastCalledWith(target.sessionId)
    })
    // Created under the published id rather than a Host-minted one, so the
    // address that was opened and the Session that appears are the same chat.
    expect(b.sessions.create).toHaveBeenLastCalledWith({
      workspaceId: wid('home'),
      sessionId: target.sessionId,
    })
  })

  it('re-arms the New Session address on every ask', async () => {
    // A link nobody activates must not reserve an id, and a link that has been
    // activated must stop naming a live Session, so each ask is a fresh chat.
    const home = summary('home', { cwd: '/w/home', updatedAt: 1 })
    const b = bench({
      sessions: sessionState([home], home.id),
      workspaces: workspaceState([workspace('home', [home.id])]),
    })

    const first = b.uiWorkspace.newSessionHref()
    const second = b.uiWorkspace.newSessionHref()

    expect(first.sessionId).not.toBe(second.sessionId)
    expect(first.href).not.toBe(second.href)
    expect(first.href).toMatch(/^\/c\/[0-9a-f-]{36}$/)
  })

  it('opens the recent Workspace after both baselines arrive', async () => {
    const b = bench()
    b.sessions.create.mockResolvedValue(sid('initial'))

    const stableFirst = workspace('stable-first', [], '2026-01-01T00:00:00.000Z')
    const recent = workspace('recent', [], '2026-01-02T00:00:00.000Z')
    b.workspaces.list.set(workspaceState([stableFirst, recent]))
    expect(b.sessions.create).not.toHaveBeenCalled()
    b.sessions.list.set(sessionState())

    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenCalledWith(sid('initial'))
    })
    expect(b.sessions.create).toHaveBeenCalledWith({ workspaceId: wid('recent') })
    expect(b.workspaces.list.getSnapshot().items.map(item => item.workspaceId)).toEqual([
      wid('stable-first'), wid('recent'),
    ])
  })

  it('uses Workspace creation time when members are absent and preserves Host tie order', async () => {
    const b = bench()
    b.sessions.create.mockResolvedValue(sid('initial'))

    b.workspaces.list.set(workspaceState([
      workspace('newest', [sid('missing')], '2026-03-01T00:00:00.000Z'),
      workspace('same-time', [], '2026-03-01T00:00:00.000Z'),
      workspace('older', [], '2026-01-01T00:00:00.000Z'),
    ]))
    b.sessions.list.set(sessionState())

    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenCalledWith(sid('initial'))
    })
    expect(b.sessions.create).toHaveBeenCalledWith({ workspaceId: wid('newest') })
  })

  it('retries failed initial selection and never overwrites a later selection', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const b = bench()
    let attempts = 0
    b.sessions.create.mockImplementation(() => ++attempts === 1
      ? Promise.reject(new Error('attach exploded'))
      : Promise.resolve(sid('retry')))
    b.workspaces.list.set(workspaceState([workspace('recent')]))
    b.sessions.list.set(sessionState())
    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith('initial workspace selection failed:', expect.any(Error))
    })
    b.workspaces.list.update(state => ({ ...state, items: [...state.items] }))
    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenCalledWith(sid('retry'))
    })
    expect(attempts).toBe(2)

    const changed = bench()
    const pending = Promise.withResolvers<SessionId>()
    changed.sessions.create.mockImplementation(() => pending.promise)
    changed.workspaces.list.set(workspaceState([workspace('recent')]))
    changed.sessions.list.set(sessionState())
    await vi.waitFor(() => { expect(changed.sessions.create).toHaveBeenCalledOnce() })
    changed.sessions.open(sid('manual'))
    pending.resolve(sid('automatic'))
    await flush()
    expect(changed.sessions.open).toHaveBeenCalledTimes(1)
    expect(changed.sessions.open).toHaveBeenCalledWith(sid('manual'))
  })

  it('abandons the retry once a Session is selected by other means', async () => {
    // A failed connect returns initial navigation to waiting. If a Session is
    // selected before the next reconcile, that selection is the shell's
    // starting point and nothing may connect a Workspace over it.
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const b = bench()
    b.sessions.create.mockRejectedValue(new Error('attach exploded'))
    b.workspaces.list.set(workspaceState([workspace('recent')]))
    b.sessions.list.set(sessionState())
    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith('initial workspace selection failed:', expect.any(Error))
    })
    expect(b.sessions.create).toHaveBeenCalledOnce()

    const selected = summary('selected')
    b.sessions.list.set(sessionState([selected], selected.id))
    await flush()
    expect(b.sessions.create).toHaveBeenCalledOnce()
  })

  it('stops initial navigation when its Cordis lifetime is disposed', async () => {
    const success = bench()
    const resolved = Promise.withResolvers<SessionId>()
    success.sessions.create.mockImplementation(() => resolved.promise)
    success.workspaces.list.set(workspaceState([workspace('recent')]))
    success.sessions.list.set(sessionState())
    await vi.waitFor(() => { expect(success.sessions.create).toHaveBeenCalledOnce() })
    await success.ctx.fiber.dispose()
    resolved.resolve(sid('late'))
    await flush()
    expect(success.sessions.open).not.toHaveBeenCalled()
    success.workspaces.list.set(workspaceState([workspace('ignored')]))
    expect(success.sessions.create).toHaveBeenCalledOnce()

    const failure = bench()
    const rejected = Promise.withResolvers<SessionId>()
    failure.sessions.create.mockImplementation(() => rejected.promise)
    failure.workspaces.list.set(workspaceState([workspace('recent')]))
    failure.sessions.list.set(sessionState())
    await vi.waitFor(() => { expect(failure.sessions.create).toHaveBeenCalledOnce() })
    const staleReconciles = failure.workspaces.list.listenersSnapshot()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await failure.ctx.fiber.dispose()
    rejected.reject(new Error('late failure'))
    await flush()
    for (const reconcile of staleReconciles) reconcile()
    expect(warning).not.toHaveBeenCalled()
    expect(failure.sessions.create).toHaveBeenCalledOnce()
  })

  it('clears a current Session only after it enters the archive baseline', () => {
    const current = summary('current')
    const idle = summary('idle')
    const b = bench({
      sessions: sessionState([current, idle], current.id),
      workspaces: workspaceState([workspace('one', [current.id, idle.id])]),
    })

    b.workspaces.list.update(state => ({ ...state, archivedSessionIds: [idle.id] }))
    expect(b.sessions.clear).not.toHaveBeenCalled()
    b.workspaces.list.update(state => ({ ...state, archivedSessionIds: [current.id] }))
    expect(b.sessions.clear).toHaveBeenCalledOnce()

    b.sessions.open(idle.id)
    b.workspaces.list.update(state => ({ ...state, archivedSessionIds: [idle.id] }))
    expect(b.sessions.clear).toHaveBeenCalledTimes(2)

    const archived = bench({
      sessions: sessionState([current], current.id),
      workspaces: workspaceState([workspace('one', [current.id])], [current.id]),
    })
    expect(archived.sessions.clear).toHaveBeenCalledOnce()
  })

  it('forwards archive commands and preserves failures', async () => {
    const idle = sid('idle')
    const b = bench()

    await b.uiWorkspace.archiveSession(idle)
    expect(b.workspaces.archiveCalls).toEqual([idle])

    b.workspaces.onArchive = () => Promise.reject(new Error('archive rejected'))
    await expect(b.uiWorkspace.archiveSession(idle)).rejects.toThrow('archive rejected')
    expect(b.workspaces.archiveCalls).toEqual([idle, idle])
  })

  it('passes directory operations to the Host and preserves structured browse failures', async () => {
    const b = bench()
    b.directoryPicker.onPick = () => Promise.resolve({ ok: true, value: '/w/alpha' })
    await expect(b.uiWorkspace.pickDirectory()).resolves.toBe('/w/alpha')
    b.directoryPicker.onPick = () => Promise.resolve({ ok: true, value: null })
    await expect(b.uiWorkspace.pickDirectory()).resolves.toBeNull()
    expect(b.directoryPicker.callsOf('pick')).toEqual([{}, {}])

    await expect(b.uiWorkspace.listDirectory()).resolves.toEqual(listing)
    await expect(b.uiWorkspace.listDirectory('/home/u')).resolves.toEqual(listing)
    expect(b.directoryPicker.callsOf('list')).toEqual([{ path: undefined }, { path: '/home/u' }])
    await expect(b.uiWorkspace.createDirectory('/home/u', 'new')).resolves.toBe('/home/u/new')
    expect(b.directoryPicker.callsOf('createDirectory')).toEqual([{ path: '/home/u', name: 'new' }])
    b.directoryPicker.onPick = () => Promise.resolve({
      ok: false, error: new RemoteError('gateway/internal', 'no chooser', {}),
    })
    await expect(b.uiWorkspace.pickDirectory()).rejects.toThrow('directory picker failed: no chooser')
    b.directoryPicker.onList = () => Promise.resolve({
      ok: false, error: new RemoteError('directory-picker/unreadable', 'denied', { path: '/private' }),
    })
    const listFailure = b.uiWorkspace.listDirectory('/private')
    await expect(listFailure).rejects.toBeInstanceOf(DirectoryBrowseError)
    await expect(listFailure).rejects.toMatchObject({ rpcError: { code: 'directory-picker/unreadable' } })
    b.directoryPicker.onCreateDirectory = () => Promise.resolve({
      ok: false, error: new RemoteError('directory-picker/exists', 'taken', { path: '/home/u/new' }),
    })
    await expect(b.uiWorkspace.createDirectory('/home/u', 'new')).rejects.toMatchObject({
      rpcError: { code: 'directory-picker/exists' },
    })
  })
})

describe('UiWorkspaceService.whenInitialDataReady', () => {
  async function pendingFlag(ready: Promise<void>): Promise<{ settled: boolean; ready: Promise<void> }> {
    let settled = false
    const tracked = ready.then(() => { settled = true })
    await flush()
    return {
      get settled() { return settled },
      ready: tracked,
    }
  }

  it('resolves immediately for a ready empty shell', async () => {
    const b = bench({
      sessions: sessionState(),
      workspaces: workspaceState(),
    })
    await expect(b.uiWorkspace.whenInitialDataReady()).resolves.toBeUndefined()
    await expect(b.uiWorkspace.whenInitialDataReady()).resolves.toBeUndefined()
  })

  it('holds until the selected Session history opens', async () => {
    const first = summary('first')
    const b = bench({
      sessions: sessionState([first], first.id, 'pending'),
      workspaces: workspaceState([workspace('one', [first.id])], [], 'pending'),
    })
    b.sessions.face(first.id, 'loading')
    const wait = await pendingFlag(b.uiWorkspace.whenInitialDataReady())
    expect(wait.settled).toBe(false)

    b.workspaces.list.set(workspaceState([workspace('one', [first.id])]))
    b.sessions.list.set(sessionState([first], first.id))
    await flush()
    expect(wait.settled).toBe(false)

    b.sessions.face(first.id).setOpenState('open')
    await wait.ready
    expect(wait.settled).toBe(true)
  })

  it('attaches a Session face that appears after selection', async () => {
    const first = summary('first')
    const b = bench({
      sessions: sessionState([first], first.id),
      workspaces: workspaceState([workspace('one', [first.id])]),
    })
    const wait = await pendingFlag(b.uiWorkspace.whenInitialDataReady())
    expect(wait.settled).toBe(false)
    b.sessions.face(first.id, 'loading')
    b.sessions.list.update(state => ({ ...state }))
    await flush()
    expect(wait.settled).toBe(false)
    b.sessions.face(first.id).setOpenState('open')
    await wait.ready
  })

  it('resolves when the selected Session history fails', async () => {
    const first = summary('first')
    const b = bench({
      sessions: sessionState([first], first.id),
      workspaces: workspaceState([workspace('one', [first.id])]),
    })
    b.sessions.face(first.id, 'loading')
    const wait = await pendingFlag(b.uiWorkspace.whenInitialDataReady())
    expect(wait.settled).toBe(false)
    b.sessions.face(first.id).setOpenState('error')
    await wait.ready
  })

  it('resolves on a Workspace stream failure without waiting for navigation', async () => {
    const b = bench({
      sessions: sessionState(),
      workspaces: {
        ...workspaceState([], [], 'pending'),
        state: 'error',
      },
    })
    await expect(b.uiWorkspace.whenInitialDataReady()).resolves.toBeUndefined()
  })

  it('holds through initial Workspace connect until that Session history opens', async () => {
    const b = bench()
    const created = sid('initial')
    b.sessions.create.mockResolvedValue(created)
    b.sessions.face(created, 'loading')
    const wait = await pendingFlag(b.uiWorkspace.whenInitialDataReady())
    expect(wait.settled).toBe(false)

    b.workspaces.list.set(workspaceState([workspace('recent')]))
    b.sessions.list.set(sessionState())
    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenCalledWith(created)
    })
    await flush()
    expect(wait.settled).toBe(false)

    b.sessions.face(created).setOpenState('open')
    await wait.ready
  })

  it('settles once, so a later disposal neither re-resolves nor unsubscribes twice', async () => {
    // Readiness and Cordis disposal both run the same settle. The second one
    // has to be inert: it would otherwise call disposers already run.
    const first = summary('first')
    const b = bench({
      sessions: sessionState([first], first.id, 'pending'),
      workspaces: workspaceState([workspace('one', [first.id])], [], 'pending'),
    })
    b.sessions.face(first.id, 'loading')
    const wait = await pendingFlag(b.uiWorkspace.whenInitialDataReady())
    b.workspaces.list.set(workspaceState([workspace('one', [first.id])]))
    b.sessions.list.set(sessionState([first], first.id))
    b.sessions.face(first.id).setOpenState('open')
    await wait.ready

    await b.ctx.fiber.dispose()
    await expect(b.uiWorkspace.whenInitialDataReady()).resolves.toBeUndefined()
  })

  it('resolves when its Cordis lifetime is disposed', async () => {
    const b = bench()
    const wait = await pendingFlag(b.uiWorkspace.whenInitialDataReady())
    expect(wait.settled).toBe(false)
    await b.ctx.fiber.dispose()
    await wait.ready
  })
})
