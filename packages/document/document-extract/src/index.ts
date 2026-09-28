/** Document text-extraction provider registry (`ctx.documentExtract`). @module @aeven/document-extract */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { documentExtension } from './formats.ts'
import type {
  DocumentExtractProvider,
  DocumentExtractProviderId,
  DocumentExtractProviderInfo,
  DocumentExtractResult,
  DocumentExtractSnapshot,
  DocumentFormats,
  ExtractedDocument,
} from './types.ts'

export type * from './types.ts'
export { documentExtension } from './formats.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Document text-extraction provider registry. */
    documentExtract: DocumentExtract
  }
}

/** Stable extraction failure codes. */
export type DocumentExtractErrorCode = 'UNSUPPORTED_FORMAT' | 'EXTRACTION_FAILED'

/** Extraction failure routed by `code`. */
export class DocumentExtractError extends Error {
  /** Stable machine-routing failure code. */
  readonly code: DocumentExtractErrorCode

  /**
   * @param message - human-readable failure without document content.
   * @param code - stable machine-routing code.
   * @param options - optional chained cause.
   */
  constructor(message: string, code: DocumentExtractErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DocumentExtractError'
    this.code = code
  }
}

/** Deployment policy for extracted text. */
export interface Config {
  /** Maximum characters kept from one document; longer text is cut and marked truncated. */
  maxTextChars: number
}

interface Registration {
  readonly provider: DocumentExtractProvider
  readonly unsubscribe: () => void
}

/** Registry shared by every document consumer in one Host composition. */
export default class DocumentExtract extends Service {
  static Config: z<Partial<Config>, Config> = z.object({
    maxTextChars: z.natural().min(1).default(400_000),
  })

  private readonly providers = new Map<DocumentExtractProviderId, Registration>()
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'documentExtract')
    ctx.effect(() => () => {
      this.lifetime.abort(new Error('Document extraction service disposed'))
      for (const registration of this.providers.values()) registration.unsubscribe()
      this.providers.clear()
      this.listeners.clear()
    }, 'document-extract.lifetime')
  }

  /**
   * Register one extractor; duplicate ids fail without replacing the original.
   * @param provider - extractor owned by the contributing fiber.
   * @returns idempotent disposer removing the provider.
   */
  register(provider: DocumentExtractProvider): () => void {
    this.lifetime.signal.throwIfAborted()
    if (this.providers.has(provider.info.id)) {
      throw new Error(`Document extraction provider already registered: ${provider.info.id}`)
    }
    const registration: Registration = {
      provider,
      unsubscribe: provider.preparation?.subscribe(() => { this.changed() }) ?? (() => {}),
    }
    this.providers.set(provider.info.id, registration)
    this.changed()
    return () => {
      if (this.providers.get(provider.info.id) !== registration) return
      this.providers.delete(provider.info.id)
      registration.unsubscribe()
      this.changed()
    }
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  private ready(): DocumentExtractProvider[] {
    return [...this.providers.values()]
      .map(({ provider }) => provider)
      .filter(provider => (provider.preparation?.snapshot().phase ?? 'ready') === 'ready')
      .sort((a, b) => a.info.priority - b.info.priority)
  }

  /**
   * Read provider readiness and the accepted formats together.
   * @returns one detached complete observation.
   */
  snapshot(): DocumentExtractSnapshot {
    const extensions = new Set<string>()
    const mediaTypes = new Set<string>()
    for (const provider of this.ready()) {
      for (const extension of provider.info.formats.extensions) extensions.add(extension)
      for (const mediaType of provider.info.formats.mediaTypes) mediaTypes.add(mediaType)
    }
    const accepted: DocumentFormats = { extensions: [...extensions].sort(), mediaTypes: [...mediaTypes].sort() }
    return {
      providers: [...this.providers.values()].map(({ provider }) => ({
        ...provider.info,
        preparation: provider.preparation?.snapshot() ?? { phase: 'ready' },
      })),
      accepted,
    }
  }

  /**
   * Observe complete readiness snapshots; a slow reader coalesces intermediate progress.
   * @param caller - observer lifetime.
   * @returns an initial snapshot followed by the latest states.
   */
  async *follow(caller: AbortSignal): AsyncIterable<DocumentExtractSnapshot> {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    signal.throwIfAborted()
    let wake = Promise.withResolvers<undefined>()
    let changed = true
    const notify = (): void => { changed = true; wake.resolve(undefined) }
    this.listeners.add(notify)
    signal.addEventListener('abort', notify, { once: true })
    try {
      while (!signal.aborted) {
        if (!changed) await wake.promise
        if (signal.aborted) break
        wake = Promise.withResolvers<undefined>()
        changed = false
        yield this.snapshot()
      }
    } finally {
      this.listeners.delete(notify)
      signal.removeEventListener('abort', notify)
    }
  }

  /**
   * Start or join provider-owned preparation.
   * @param id - exact registered provider identity.
   */
  prepare(id: DocumentExtractProviderId): void {
    this.provider(id).preparation?.prepare()
  }

  /**
   * Cancel provider preparation.
   * @param id - exact registered provider identity.
   * @returns after the preparation task settles.
   */
  async cancelPreparation(id: DocumentExtractProviderId): Promise<void> {
    await this.provider(id).preparation?.cancel()
  }

  private provider(id: DocumentExtractProviderId): DocumentExtractProvider {
    const registration = this.providers.get(id)
    if (registration === undefined) throw new Error(`Document extraction provider is unavailable: ${id}`)
    return registration.provider
  }

  /**
   * Report whether a ready provider reads this document's format.
   * @param name - display name.
   * @param mediaType - browser-declared media type, possibly empty.
   * @returns whether {@link extract} can be attempted.
   */
  accepts(name: string, mediaType: string): boolean {
    const extension = documentExtension(name, mediaType)
    return this.ready().some(provider => claims(provider.info, extension, mediaType))
  }

  /**
   * Extract text through ready providers in priority order until one returns text.
   * @param input - document bytes, display name, and declared media type.
   * @param signal - caller cancellation.
   * @returns text cut to the configured budget, with the producing provider.
   * @throws DocumentExtractError when no ready provider claims the format or every claimant fails.
   */
  async extract(
    input: { readonly data: Uint8Array; readonly name: string; readonly mediaType: string },
    signal: AbortSignal,
  ): Promise<DocumentExtractResult> {
    const extension = documentExtension(input.name, input.mediaType)
    const candidates = this.ready().filter(provider => claims(provider.info, extension, input.mediaType))
    if (candidates.length === 0) {
      throw new DocumentExtractError(`No document reader accepts "${extension || input.mediaType || 'unknown'}" files.`, 'UNSUPPORTED_FORMAT')
    }
    let empty: { provider: DocumentExtractProviderInfo; result: ExtractedDocument } | undefined
    let failure: unknown
    for (const provider of candidates) {
      signal.throwIfAborted()
      try {
        const result = await provider.extract({ ...input, extension }, signal)
        if (result.text.trim() !== '') return this.budget(provider.info, result)
        empty ??= { provider: provider.info, result }
      } catch (error) {
        signal.throwIfAborted()
        failure ??= error
      }
    }
    if (empty !== undefined) return this.budget(empty.provider, empty.result)
    throw new DocumentExtractError('The document could not be read.', 'EXTRACTION_FAILED', { cause: failure })
  }

  private budget(info: DocumentExtractProviderInfo, result: ExtractedDocument): DocumentExtractResult {
    const truncated = result.text.length > this.config.maxTextChars
    return {
      text: truncated ? result.text.slice(0, this.config.maxTextChars) : result.text,
      method: result.method,
      ...result.pages === undefined ? {} : { pages: result.pages },
      providerId: info.id,
      extractor: `${info.id}@${info.version}`,
      truncated,
    }
  }
}

function claims(info: DocumentExtractProviderInfo, extension: string, mediaType: string): boolean {
  return extension !== ''
    ? info.formats.extensions.includes(extension)
    : info.formats.mediaTypes.includes(mediaType.toLowerCase())
}
