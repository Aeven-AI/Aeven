/** Authenticated Client access to document-reader readiness and preparation. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@aeven/typert-protocol'
import type {} from '@aeven/document-extract'
import type { DocumentExtractProviderId } from '@aeven/document-extract/types'
import type { DocumentReaderCatalog } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Document-reader Remote controller. */
    documentReaderController: DocumentReaderController
  }
}

/** Reader readiness and preparation; extraction itself runs in the Host upload route. */
export default class DocumentReaderController extends TypertRemoteService {
  static inject = ['documentExtract', 'typert']

  constructor(ctx: Context) {
    super(ctx, 'documentReaderController', { namespace: 'documents' })
  }

  /**
   * Read reader readiness without preparing anything.
   * @returns providers, their readiness, and the accepted formats.
   */
  @Remote
  catalog(): DocumentReaderCatalog {
    return this.ctx.documentExtract.snapshot()
  }

  /**
   * Follow reader readiness.
   * @param signal - Client observation lifetime.
   * @returns initial and subsequent complete snapshots.
   */
  @Remote({ mode: 'stream' })
  follow(signal: AbortSignal): AsyncIterable<DocumentReaderCatalog> {
    return this.ctx.documentExtract.follow(signal)
  }

  /**
   * Start or join one Host-owned reader preparation.
   * @param providerId - reader to prepare.
   */
  @Remote
  prepare(providerId: DocumentExtractProviderId): void {
    this.ctx.documentExtract.prepare(providerId)
  }

  /**
   * Cancel reader preparation.
   * @param providerId - reader whose preparation stops.
   * @returns after the preparation task settles.
   */
  @Remote
  cancelPreparation(providerId: DocumentExtractProviderId): Promise<void> {
    return this.ctx.documentExtract.cancelPreparation(providerId)
  }
}
