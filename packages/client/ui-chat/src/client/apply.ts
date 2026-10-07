/** Register the Chat Conversation target, renderers, stats, and details surface. */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@aeven/attachment'
import type {} from '@aeven/api-remotes/client'
import type { SessionBinding } from '@aeven/api-session-controller/client'
import type { BoundActions, ObservableSnapshot } from '@aeven/client-store'
import type { SessionId } from '@aeven/session/types'
import { resolveWorkspacePath } from '@aeven/util-workspace-path'
// Type-only service and declaration merges used by the apply world.
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-conversation/client'
import type {} from '@aeven/client-ui-layout/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-session/client'
import type {} from '@aeven/client-ui-settings/client'
import type {} from '@aeven/client-ui-workspace/client'
import type {
  ChatNodeTurnDataInjected, ChatScrollPosition, ChatViewInjected, DetailsInjected,
  TurnTailOwnerProps,
} from './contract/slots.ts'
import type { ChatSnapshot } from './contract/snapshot.ts'
import { EMPTY_CHAT_SNAPSHOT } from './contract/snapshot.ts'
import { ApprovalCommand } from './chat/ApprovalCommand.tsx'
import { ChatView } from './chat/ChatView.tsx'
import { registerChatNodeRenderers } from './chat/register-node-renderers.ts'
import { registerConversationNodes } from './conversation-nodes/register.ts'
import { DetailsPanel } from './details/DetailsPanel.tsx'
import { en, NS, zh } from './locale.ts'
import { TranscriptViewRow, type TranscriptViewRowInjected } from './settings/TranscriptViewRow.tsx'
import { createChatStore } from './stores.ts'
import { TranscriptViewPolicy } from './transcript-view.ts'
import { TextAnimationPolicy } from './text-animation.ts'
import { TextAnimationRow, type TextAnimationRowInjected } from './settings/TextAnimationRow.tsx'
import { CHAT_SETTINGS_NAMESPACE, type ChatSettings } from '../chat-settings.ts'
import { useTurnDataValue } from './chat/use-turn-data.ts'

const CHAT_NODE_INJECT: ChatNodeTurnDataInjected = {
  hooks: {
    turnData: (_standard, data) => function useTurnData(key) {
      return useTurnDataValue(data, key)
    },
  },
}

/** Services required by the Chat target and its presentation registrations. */
export const inject = [
  'slots', 'sessions', 'uiSession', 'uiConversation', 'layout', 'locale',
  'settingsScope', 'remote', 'remote.session',
]

/**
 * Mount all Chat-owned contributions.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  const chatSources = new WeakMap<SessionBinding, ObservableSnapshot<ChatSnapshot>>()
  const chatSource = (binding: SessionBinding): ObservableSnapshot<ChatSnapshot> => {
    let source = chatSources.get(binding)
    if (source === undefined) {
      const target = ctx.uiConversation.binding(binding).target('chat')
      source = {
        getSnapshot: () => target.getSnapshot() ?? EMPTY_CHAT_SNAPSHOT,
        subscribe: listener => target.subscribe(listener),
      }
      chatSources.set(binding, source)
    }
    return source
  }
  registerConversationNodes(ctx)
  registerChatNodeRenderers(ctx)
  ctx.uiSession.provide({
    hooks: ['chat'],
    resolve: binding => ({ hooks: { chat: chatSource(binding) } }),
  })

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-chat: dictionaries')
  const t = ctx.locale.bind(NS)
  const chatStore = createChatStore()
  const chatScrollPositions = new Map<SessionId, ChatScrollPosition>()
  ctx.effect(() => {
    let currentSessionId = ctx.sessions.list.getSnapshot().current
    return ctx.sessions.list.subscribe(() => {
      const nextSessionId = ctx.sessions.list.getSnapshot().current
      if (nextSessionId === currentSessionId) return
      currentSessionId = nextSessionId
      if (nextSessionId === undefined) return
      // A content-search result owns an exact event destination. Every other
      // Session activation starts at the live tail instead of restoring a
      // reading position saved during an earlier visit.
      if (ctx.uiConversation.eventNavigation(nextSessionId).getSnapshot() === null) {
        chatScrollPositions.delete(nextSessionId)
      }
    })
  }, 'ui-chat: Session activation scroll policy')
  const chatSettings = ctx.settingsScope.bind<ChatSettings>({ namespace: CHAT_SETTINGS_NAMESPACE })
  const transcriptView = new TranscriptViewPolicy(chatSettings)
  const textAnimation = new TextAnimationPolicy(chatSettings)

  ctx.slots.inject('settings.appearance.item', () => ctx.slots.register({
    name: 'settings.appearance.item',
    id: 'transcript-view',
    order: 12,
    locale: NS,
    inject: (): TranscriptViewRowInjected => ({
      hooks: { transcriptView: transcriptView.mode },
      setTranscriptView: (mode) => { transcriptView.setMode(mode) },
    }),
  }, TranscriptViewRow))

  ctx.slots.inject('settings.appearance.item', () => ctx.slots.register({
    name: 'settings.appearance.item',
    id: 'text-animation',
    order: 13,
    locale: NS,
    inject: (): TextAnimationRowInjected => ({
      hooks: { textAnimationSetting: textAnimation.enabled },
      setTextAnimation: (enabled) => { textAnimation.setEnabled(enabled) },
    }),
  }, TextAnimationRow))

  ctx.slots.inject('conversation.view', () => {
    const disposeView = ctx.slots.register({
      name: 'conversation.view',
      id: 'chat',
      order: 0,
      label: () => t('view.chat'),
      locale: NS,
      children: {
        'conversation.chat.node': { kind: 'keyed', scope: 'session', inject: CHAT_NODE_INJECT },
        'conversation.message.images': { kind: 'single', scope: 'session' },
      },
      store: chatStore,
      inject: (sessionId: SessionId, actions: BoundActions<typeof chatStore>): ChatViewInjected => {
        const binding = ctx.sessions.binding(sessionId)
        if (binding === undefined) throw new Error(`ui-chat: unknown session "${sessionId}"`)
        const session = binding.session
        const chat = chatSource(binding)
        return {
          hooks: {
            transcriptView: transcriptView.mode,
            textAnimationPreference: textAnimation.enabled,
            eventNavigation: ctx.uiConversation.eventNavigation(sessionId),
          },
          keyedHooks: {
            chatNode: key => chat.getSnapshot().nodes.source(key),
            chatNodeProcess: key => chat.getSnapshot().nodes.processSource(key),
          },
          openDetails: (target) => {
            actions.select(target)
            ctx.layout.openDetails()
          },
          fileMentions: (owner: TurnTailOwnerProps) => ctx.get('chatFileMentions')?.forClosing(owner),
          // A transcript block covering the viewport is shell state, not chat
          // state: the shell's own chrome is what has to yield to it.
          onFullscreenChange: (fullscreen: boolean) => { ctx.layout.setFullscreen(fullscreen) },
          openFile: async (path) => {
            const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
            const result = await ctx.remote.session.openWorkspacePath({
              path: resolveWorkspacePath(cwd, path),
            })
            if (!result.ok) throw new Error(`path open failed: ${result.error.message}`)
          },
          loadOlder: () => { void session.loadOlder() },
          loadNewer: () => { void session.loadNewer() },
          returnToLive: () => { void session.returnToLive() },
          loadThrough: seq => session.loadThrough(seq),
          navigateToEvent: (seq, options) => { ctx.uiConversation.navigateToEvent(sessionId, seq, options) },
          completeEventNavigation: (requestId) => {
            ctx.uiConversation.completeEventNavigation(sessionId, requestId)
          },
          loadImage: Object.assign(
            (attachment: ImageAttachmentRef) => ctx.uiConversation.imageUrl(sessionId, attachment),
            { peek: (attachment: ImageAttachmentRef) => ctx.uiConversation.peekImageUrl(sessionId, attachment) },
          ),
          chatScroll: {
            save: (position) => {
              if (position === null) chatScrollPositions.delete(sessionId)
              else chatScrollPositions.set(sessionId, position)
            },
            read: () => chatScrollPositions.get(sessionId) ?? null,
          },
          updateQueue: async (itemId, action) => {
            const conversation = ctx.sessions.scope(sessionId)?.get('conversation')
            if (conversation === undefined) throw new Error(`ui-chat: session "${sessionId}" has no conversation service`)
            await conversation.updateQueue(itemId, action)
          },
          editMessage: async (seq, text) => {
            const session = ctx.sessions.binding(sessionId)?.session
            if (session === undefined) throw new Error(`ui-chat: session "${sessionId}" resolved no binding`)
            const result = await session.edit(seq, text)
            if (!result.ok) throw new Error(`ui-chat: edit failed: ${result.error.code}: ${result.error.message}`)
          },
          notifyError: (text) => {
            const actx = ctx.sessions.scope(sessionId)
            actx?.get('conversation')?.input.for(actx).notify('error', text)
          },
          forkAt: (seq) => {
            ctx.sessions.fork({ sessionId, atSeq: seq, increaseTitle: true })
              .then((childId) => { ctx.sessions.open(childId) })
              .catch(() => {
                // Fork or child-title failure leaves the source view unchanged.
              })
          },
        }
      },
    }, ChatView)
    return disposeView
  })

  ctx.slots.inject('conversation.approval.detail', () =>
    ctx.slots.register({ name: 'conversation.approval.detail', locale: 'approval' }, ApprovalCommand))

  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    locale: NS,
    children: { 'conversation.details.tool': { kind: 'single', scope: 'session' } },
    store: chatStore,
    inject: (): DetailsInjected => ({ closeDetails: () => { ctx.layout.closeDetails() } }),
  }, DetailsPanel))
}
