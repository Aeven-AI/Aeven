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
  /** Short human-readable name shown in Settings. */
  readonly label: string
  /** Extractor version recorded with stored text so a later extractor change never rewrites history. */
  readonly version: string
  /** Formats this provider can read once ready. */
  readonly formats: DocumentFormats
  /** Lower values run first; a later provider runs when an earlier one returns no text. */
  readonly priority: number
}

/** Readiness of one provider's runtime resources. */
export type DocumentPreparationState =
  | { readonly phase: 'ready' }
  | { readonly phase: 'unprepared'; readonly downloadBytes?: number }
  | { readonly phase: 'preparing'; readonly receivedBytes: number; readonly totalBytes?: number }
  | { readonly phase: 'failed'; readonly reason: string }
  | { readonly phase: 'unavailable'; readonly reason: string }

/** Provider-owned preparation of downloadable runtime resources. */
export interface DocumentPreparation {
  /**
   * Read the current readiness.
   * @returns one detached state value.
   */
  snapshot(): DocumentPreparationState
  /**
   * Observe readiness changes.
   * @param listener - called after each state change.
   * @returns an idempotent unsubscribe function.
   */
  subscribe(listener: () => void): () => void
  /** Start or join preparation. */
  prepare(): void
  /**
   * Cancel an in-flight preparation.
   * @returns after the preparation task settles.
   */
  cancel(): Promise<void>
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
  /** Absent when the provider needs no preparation. */
  readonly preparation?: DocumentPreparation
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

/** Provider facts with current readiness. */
export interface DocumentExtractProviderState extends DocumentExtractProviderInfo {
  readonly preparation: DocumentPreparationState
}

/** Complete readiness observation. */
export interface DocumentExtractSnapshot {
  readonly providers: readonly DocumentExtractProviderState[]
  /** Union of the formats every ready provider accepts. */
  readonly accepted: DocumentFormats
}
