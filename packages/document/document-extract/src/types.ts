/** Document text-extraction vocabulary shared by providers and consumers. @module @aeven/document-extract/types */

import type { Branded } from '@aeven/brand'

/** Stable identity of one registered extraction provider. */
export type DocumentExtractProviderId = Branded<'DocumentExtractProviderId'>

/** File formats one provider claims, matched by lowercase extension without the dot. */
export interface DocumentFormats {
  /** Lowercase extensions without the leading dot, for example `pdf`. */
  readonly extensions: readonly string[]
  /** Browser-declared media types accepted for the same formats. */
  readonly mediaTypes: readonly string[]
}

/** Static facts about one provider. */
export interface DocumentExtractProviderInfo {
  readonly id: DocumentExtractProviderId
  /** Extractor version recorded with stored text so a later extractor change never rewrites history. */
  readonly version: string
  /** Formats this provider reads. */
  readonly formats: DocumentFormats
  /** Lower values run first; a later provider runs when an earlier one returns no text. */
  readonly priority: number
}

/** One document submitted for extraction. */
export interface DocumentExtractInput {
  readonly data: Uint8Array
  /** Browser-declared media type, possibly empty. */
  readonly mediaType: string
  /** Display name without path information. */
  readonly name: string
  /** Lowercase extension without the dot, resolved by the service. */
  readonly extension: string
}

/** How the text was obtained. */
export type DocumentExtractMethod = 'native' | 'office' | 'ocr'

/** Provider output before the service applies its character budget. */
export interface ExtractedDocument {
  readonly text: string
  readonly method: DocumentExtractMethod
  /** Page, slide, or sheet count when the format has one. */
  readonly pages?: number
}

/** One registered extractor. */
export interface DocumentExtractProvider {
  readonly info: DocumentExtractProviderInfo
  /**
   * Extract plain text from one document.
   * @param input - bytes and resolved format facts.
   * @param signal - cancellation owned by the caller.
   * @returns the extracted text, possibly empty.
   */
  extract(input: DocumentExtractInput, signal: AbortSignal): Promise<ExtractedDocument>
}

/** Service result after the character budget is applied. */
export interface DocumentExtractResult extends ExtractedDocument {
  /** Provider that produced the text. */
  readonly providerId: DocumentExtractProviderId
  /** Provider version identity recorded with the stored text. */
  readonly extractor: string
  /** Whether the service cut the text at its character budget. */
  readonly truncated: boolean
}
