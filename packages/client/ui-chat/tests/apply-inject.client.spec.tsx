// @vitest-environment jsdom
/** Chat inject factories exercised over independently mounted Conversation and Chat plugins. */
import { describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@aeven/attachment'
import type { ISession } from '@aeven/api-session-controller/client'
import { LocaleRuntime } from '@aeven/client-locale/client'
import {
  RemoteError, SlotTestRuntime, TestRemote, stubSettingsScope, usePinnedBrowserLanguages,
} from '@aeven/client-test-runtime'
import type { SessionBehaviorOverrides } from '@aeven/client-test-runtime'
import type { ClientRemote } from '@aeven/api-remotes/client'
import {
  apply as applyConversation, inject as injectConversation,
} from '@aeven/client-ui-conversation/client'
import {
  apply as applyChat, inject as injectChat, type ChatViewInjected, type DetailsInjected,
} from '@aeven/client-ui-chat/client'
import { SessionSeq, type SessionId } from '@aeven/session/types'
import { createChatStore } from '../src/client/stores.ts'

usePinnedBrowserLanguages('zh-CN')

const ROOT = 'root-1' as SessionId
const OTHER = 'other-1' as SessionId
const ATTACHMENT = {
  attachmentId: AttachmentId('image-1'),
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
} as const

type ChatInstance = ReturnType<ReturnType<typeof createChatStore>['create']>
type ChatActions = ChatInstance['actions']

function sessionFakeFor() {
  return {
    loadOlder: vi.fn<ISession['loadOlder']>(() => Promise.resolve()),
    loadNewer: vi.fn<ISession['loadNewer']>(() => Promise.resolve()),
    returnToLive: vi.fn<ISession['returnToLive']>(() => Promise.resolve()),
    loadThrough: vi.fn<ISession['loadThrough']>(() => Promise.resolve()),
    readAttachment: vi.fn<ISession['readAttachment']>(() => Promise.resolve({
      ok: true,
      value: { attachment: ATTACHMENT, data: Uint8Array.of(1) },
    })),
    prompt: vi.fn<ISession['prompt']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
    cancel: vi.fn<ISession['cancel']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
  } satisfies SessionBehaviorOverrides
}

async function bench() {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const layout = { setFullscreen: vi.fn(), openDetails: vi.fn(), closeDetails: vi.fn() }
  runtime.ctx.provide('layout', layout as never)
  const openWorkspacePath = vi.fn<ClientRemote['session']['openWorkspacePath']>(
    () => Promise.resolve({ ok: true, value: { opened: true } }),
  )
  new TestRemote(runtime.ctx, { session: { openWorkspacePath } })
  runtime.ctx.provide('uiWorkspace', {
    connectWorkspace: vi.fn(async () => ROOT),
  } as never)
  const session = sessionFakeFor()
  await runtime.sessions.add({
    id: ROOT,
    summary: { title: 'R', displayTitle: 'R', cwd: '/proj' },
    session,
  }, { current: false })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.root.declare({
    'conversation': { kind: 'single', scope: 'session-maybe' },
    'details': { kind: 'single', scope: 'session' },
  }, (_props: { renderSlot?: unknown }) => null)
  await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
  await runtime.mount({ inject: [...injectChat], apply: applyChat })
  runtime.renderRoot()

  const chatViewApi = (id: SessionId) => {
    const entry = runtime.slots.entries('conversation.view')[0]!
    const instance = runtime.storeOf('conversation.view', id) as ChatInstance
    const injected = (entry.inject as unknown as (
      sessionId: SessionId,
      actions: ChatActions,
    ) => ChatViewInjected)(id, instance.actions)
    return { instance, injected }
  }
  return { runtime, layout, openWorkspacePath, session, chatViewApi }
}

describe('Chat inject API', () => {
  it('loads older history and forks through the Session Controller', async () => {
    const b = await bench()
    const { injected } = b.chatViewApi(ROOT)
    injected.loadOlder()
    expect(b.session.loadOlder).toHaveBeenCalledOnce()

    injected.forkAt(17)
    await vi.waitFor(() => {
      expect(b.runtime.sessions.calls).toContainEqual({ method: 'open', args: [ROOT] })
    })
    expect(b.runtime.sessions.calls).toContainEqual({
      method: 'fork', args: [{ sessionId: ROOT, atSeq: 17, increaseTitle: true }],
    })

    const fork = vi.spyOn(b.runtime.sessions, 'fork').mockRejectedValueOnce(new Error('fork failed'))
    injected.forkAt(18)
    await vi.waitFor(() => {
      expect(fork).toHaveBeenCalledWith({ sessionId: ROOT, atSeq: 18, increaseTitle: true })
    })
    await b.runtime.dispose()
  })

  it('installs one history window for a jump and hands the returned completion on', async () => {
    const b = await bench()
    const { injected } = b.chatViewApi(ROOT)
    let settle: (() => void) | undefined
    const installed = new Promise<void>((resolve) => { settle = resolve })

    // The window install is the Session's own operation; the Chat face passes
    // the completion through, which is what the rail waits on before it
    // acknowledges the request. A fake that resolved eagerly would hide a face
    // that dropped the promise.
    b.session.loadThrough.mockReturnValueOnce(installed)
    const pending = injected.loadThrough(SessionSeq(42))
    expect(b.session.loadThrough).toHaveBeenCalledWith(42)
    expect(pending).toBe(installed)

    settle?.()
    await expect(pending).resolves.toBeUndefined()
    await b.runtime.dispose()
  })

  it('forwards a jump request to the Session\'s own event navigation', async () => {
    const b = await bench()
    const { injected } = b.chatViewApi(ROOT)
    const navigate = vi.spyOn(b.runtime.ctx.uiConversation, 'navigateToEvent')

    injected.navigateToEvent(SessionSeq(9), { highlight: false })
    expect(navigate).toHaveBeenCalledWith(ROOT, 9, { highlight: false })
    // The rail's jump is addressed to the Session being shown, never to
    // whichever Session happens to be current.
    await b.runtime.sessions.add({
      id: OTHER,
      summary: { title: 'Other', displayTitle: 'Other', cwd: '/other' },
      session: sessionFakeFor(),
    }, { current: false })
    await b.runtime.sessions.setCurrent(ROOT)
    expect(b.runtime.sessions.list.getSnapshot().current).toBe(ROOT)
    b.chatViewApi(OTHER).injected.navigateToEvent(SessionSeq(11))
    expect(navigate).toHaveBeenLastCalledWith(OTHER, 11, undefined)

    // The acknowledgement follows the same addressing as its request.
    const complete = vi.spyOn(b.runtime.ctx.uiConversation, 'completeEventNavigation')
    injected.completeEventNavigation(3)
    expect(complete).toHaveBeenLastCalledWith(ROOT, 3)
    await b.runtime.dispose()
  })

  it('extends the window forward and reattaches the live tail', async () => {
    const b = await bench()
    const { injected } = b.chatViewApi(ROOT)

    injected.loadNewer()
    expect(b.session.loadNewer).toHaveBeenCalledOnce()
    injected.returnToLive()
    expect(b.session.returnToLive).toHaveBeenCalledOnce()
    // Each verb is its own Session operation: neither one stands in for the other.
    expect(b.session.loadOlder).not.toHaveBeenCalled()
    expect(b.session.loadThrough).not.toHaveBeenCalled()
    await b.runtime.dispose()
  })

  it('yields the shell chrome to a transcript block that takes the viewport', async () => {
    const b = await bench()
    const { injected } = b.chatViewApi(ROOT)

    injected.onFullscreenChange(true)
    expect(b.layout.setFullscreen).toHaveBeenLastCalledWith(true)
    injected.onFullscreenChange(false)
    expect(b.layout.setFullscreen).toHaveBeenLastCalledWith(false)
    expect(b.layout.setFullscreen).toHaveBeenCalledTimes(2)
    await b.runtime.dispose()
  })

  it('writes Chat selection before opening details', async () => {
    const b = await bench()
    const { instance, injected } = b.chatViewApi(ROOT)
    injected.openDetails({ turnSeq: 2, callId: 'c1' })
    expect(instance.store.getSnapshot().selection).toEqual({ turnSeq: 2, callId: 'c1' })
    expect(b.layout.openDetails).toHaveBeenCalledOnce()
    expect(b.runtime.storeOf('details', ROOT)).toBe(instance)
    expect(b.runtime.storeOf('conversation.session', ROOT)).not.toBe(instance)
    await b.runtime.dispose()
  })

  it('resolves file paths against the Session cwd and preserves failures', async () => {
    const b = await bench()
    const { injected } = b.chatViewApi(ROOT)
    await injected.openFile('src/a.ts')
    expect(b.openWorkspacePath).toHaveBeenCalledWith({ path: '/proj/src/a.ts' })

    b.openWorkspacePath.mockResolvedValueOnce({
      ok: false,
      error: new RemoteError('gateway/internal', 'xdg-open is not available', {}),
    })
    await expect(injected.openFile('src/b.ts')).rejects.toThrow('path open failed: xdg-open is not available')
    await b.runtime.dispose()
  })

  it('fails loud when a Chat View inject resolves no Session', async () => {
    const b = await bench()
    const entry = b.runtime.slots.entries('conversation.view')[0]!
    const injectView = entry.inject as unknown as (
      sessionId: SessionId,
      actions: ChatActions,
    ) => ChatViewInjected
    expect(() => injectView('never-listed' as SessionId, {} as ChatActions))
      .toThrow(/unknown session/)
    await b.runtime.dispose()
  })

  it('closes details while sharing selection through the Chat store', async () => {
    const b = await bench()
    const entry = b.runtime.slots.entries('details')[0]!
    const injected = (entry.inject as unknown as () => DetailsInjected)()
    expect(Object.keys(injected)).toEqual(['closeDetails'])
    injected.closeDetails()
    expect(b.layout.closeDetails).toHaveBeenCalledOnce()
    expect(b.runtime.storeOf('details', ROOT)).toBe(b.runtime.storeOf('conversation.view', ROOT))
    await b.runtime.dispose()
  })

  it('owns image loading, scroll memory, and optional closing-file mentions', async () => {
    const b = await bench()
    const { injected } = b.chatViewApi(ROOT)
    const owner = {} as never

    expect(injected.fileMentions(owner)).toBeUndefined()
    const mentions = { resolve: vi.fn() } as never
    const forClosing = vi.fn(() => mentions)
    b.runtime.ctx.provide('chatFileMentions', { forClosing } as never)
    expect(injected.fileMentions(owner)).toBe(mentions)
    expect(forClosing).toHaveBeenCalledWith(owner)

    expect(injected.chatScroll.read()).toBeNull()
    const position = { anchorKey: 'node-1', anchorTop: 4, scrollTop: 12 }
    injected.chatScroll.save(position)
    expect(injected.chatScroll.read()).toEqual(position)
    injected.chatScroll.save(null)
    expect(injected.chatScroll.read()).toBeNull()

    const loaded = await injected.loadImage(ATTACHMENT)
    // A browser reads the stored object from its own durable URL, so no bytes
    // travel back through the Session binding. ui-conversation's image cache
    // owns that URL per Session and reference, so a second ask — another
    // Conversation target, another row — shares the first one.
    expect(loaded).toContain('/api/attachment-image')
    expect(loaded).toContain('id=image-1')
    expect(b.session.readAttachment).not.toHaveBeenCalled()
    expect(await injected.loadImage(ATTACHMENT)).toBe(loaded)
    // The browser branch is not covered by `peek` today: ui-conversation's
    // HistoricalImageCache records a URL on its entry only on the byte-read
    // branch, so `peek` reports nothing for a reference whose displayable URL
    // is already known on this one. That gap is owned by ui-conversation and
    // reported with this cluster, so no assertion here pins it either way.
    await b.runtime.dispose()
  })

  it('forgets a revisited Session position except for content-search navigation', async () => {
    const b = await bench()
    await b.runtime.sessions.add({
      id: OTHER,
      summary: { title: 'Other', displayTitle: 'Other', cwd: '/other' },
      session: sessionFakeFor(),
    }, { current: false })
    await b.runtime.sessions.setCurrent(ROOT)
    const rootScroll = b.chatViewApi(ROOT).injected.chatScroll
    const otherScroll = b.chatViewApi(OTHER).injected.chatScroll
    const position = { anchorKey: 'node-1', anchorTop: 4, scrollTop: 12 }
    rootScroll.save(position)
    otherScroll.save(position)

    await b.runtime.sessions.setCurrent(OTHER)
    expect(otherScroll.read()).toBeNull()
    expect(rootScroll.read()).toEqual(position)

    otherScroll.save(position)
    await b.runtime.sessions.setCurrent(ROOT)
    b.runtime.ctx.uiConversation.navigateToEvent(OTHER, SessionSeq(8))
    await b.runtime.sessions.setCurrent(OTHER)
    expect(otherScroll.read()).toEqual(position)

    // Clearing the selection is not a Session activation, so it forgets no
    // reading position: what was saved survives for the return visit.
    rootScroll.save(position)
    await b.runtime.sessions.setCurrent(undefined)
    expect(rootScroll.read()).toEqual(position)
    await b.runtime.dispose()
  })

  it('reports a finished event navigation back to the Conversation', async () => {
    const b = await bench()
    const complete = vi.spyOn(b.runtime.ctx.uiConversation, 'completeEventNavigation')
    b.chatViewApi(ROOT).injected.completeEventNavigation(3)
    expect(complete).toHaveBeenCalledWith(ROOT, 3)
    await b.runtime.dispose()
  })
})
