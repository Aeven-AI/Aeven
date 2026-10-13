/** Document text-extraction provider registry (`ctx.documentExtract`). @module @aeven/document-extract */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { documentExtension } from './formats.ts'
import type {
  DocumentExtractProvider,
  DocumentExtractProviderId,
  DocumentExtractProviderInfo,
  DocumentExtractResult,
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

/** Registry shared by every document consumer in one Host composition. */
export default class DocumentExtract extends Service {
  static Config: z<Partial<Config>, Config> = z.object({
    maxTextChars: z.natural().min(1).default(400_000),
  })

  private readonly providers = new Map<DocumentExtractProviderId, DocumentExtractProvider>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'documentExtract')
  }

  /**
   * Register one extractor; duplicate ids fail without replacing the original.
   * @param provider - extractor owned by the contributing fiber.
   * @returns idempotent disposer removing the provider.
   */
  register(provider: DocumentExtractProvider): () => void {
    if (this.providers.has(provider.info.id)) {
      throw new Error(`Document extraction provider already registered: ${provider.info.id}`)
    }
    this.providers.set(provider.info.id, provider)
    return () => {
      if (this.providers.get(provider.info.id) === provider) this.providers.delete(provider.info.id)
    }
  }

  private ordered(): DocumentExtractProvider[] {
    return [...this.providers.values()].sort((a, b) => a.info.priority - b.info.priority)
  }

  /**
   * Union of the formats every registered provider reads.
   * @returns one detached value.
   */
  accepted(): DocumentFormats {
    const extensions = new Set<string>()
    const mediaTypes = new Set<string>()
    for (const provider of this.providers.values()) {
      for (const extension of provider.info.formats.extensions) extensions.add(extension)
      for (const mediaType of provider.info.formats.mediaTypes) mediaTypes.add(mediaType)
    }
    return { extensions: [...extensions].sort(), mediaTypes: [...mediaTypes].sort() }
  }

  /**
   * Report whether a provider reads this document's format.
   * @param name - display name.
   * @param mediaType - browser-declared media type, possibly empty.
   * @returns whether {@link extract} can be attempted.
   */
  accepts(name: string, mediaType: string): boolean {
    const extension = documentExtension(name, mediaType)
    return this.ordered().some(provider => claims(provider.info, extension, mediaType))
  }

  /**
   * Extract text through providers in priority order until one returns text.
   * @param input - document bytes, display name, and declared media type.
   * @param signal - caller cancellation.
   * @returns text cut to the configured budget, with the producing provider.
   * @throws DocumentExtractError when no provider claims the format or every claimant fails.
   */
  async extract(
    input: { readonly data: Uint8Array; readonly name: string; readonly mediaType: string },
    signal: AbortSignal,
  ): Promise<DocumentExtractResult> {
    const extension = documentExtension(input.name, input.mediaType)
    const candidates = this.ordered().filter(provider => claims(provider.info, extension, input.mediaType))
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
