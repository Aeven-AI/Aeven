/** Browser attachment plugin: fills conversation's composer and message-image slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@aeven/client-ui-chat/client'
import type {} from '@aeven/client-ui-conversation/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-trajectory/client'
import type {} from '@aeven/client-ui-settings/client'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/api-remotes/client'
import { ComposerAttachments } from './ComposerAttachments.tsx'
import { observeDocumentReaders } from './document-readers.ts'
import { DocumentsSection, type DocumentsSectionInjected } from './DocumentsSection.tsx'
import { MessageImages } from './MessageImages.tsx'

/** Slot registry required by this presentation plugin. */
export const inject = ['slots']

/** Register attachment presentation without exporting React components as package values. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
    name: 'conversation.input.attachments',
    locale: 'conversation',
  }, ComposerAttachments))
  ctx.slots.inject('conversation.message.images', () => ctx.slots.register({
    name: 'conversation.message.images',
    locale: 'conversation',
  }, MessageImages))
  ctx.slots.inject('conversation.trajectory.images', () => ctx.slots.register({
    name: 'conversation.trajectory.images',
    locale: 'conversation',
  }, MessageImages))
  // Settings → Documents exists only while the Host serves the `documents` Remote.
  ctx.inject(['remote', 'remote.documents', 'locale'], (remoteCtx) => {
    const readiness = observeDocumentReaders(remoteCtx)
    remoteCtx.effect(() => readiness.dispose, 'ui-attachment: document readiness')
    const t = remoteCtx.locale.bind('conversation')
    const injected: DocumentsSectionInjected = {
      hooks: { documentReadiness: readiness.state },
      prepare: async (providerId) => {
        const result = await remoteCtx.remote.documents.prepare(providerId)
        if (!result.ok) throw result.error
      },
      cancelPreparation: async (providerId) => {
        const result = await remoteCtx.remote.documents.cancelPreparation(providerId)
        if (!result.ok) throw result.error
      },
    }
    remoteCtx.slots.inject('settings.section', () => remoteCtx.slots.register({
      name: 'settings.section', id: 'documents', order: 45, label: () => t('documents.nav'), locale: 'conversation', inject: () => injected,
    }, DocumentsSection))
  })
}
