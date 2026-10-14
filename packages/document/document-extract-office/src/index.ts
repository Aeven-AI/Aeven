/**
 * Office document reader backed by the LibreOffice engine that
 * `@deepseek-ai/libreoffice-kit` installs for the host platform. It runs after
 * the built-in readers: it reads legacy Word, Excel, and PowerPoint files and
 * retries Office files the built-in readers return no text for. The engine is
 * an ordinary npm dependency; nothing is downloaded at runtime.
 * @module @aeven/document-extract-office
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ENGINE_VERSION, createConverterFactory } from '@deepseek-ai/libreoffice-kit'
import type { ConverterFactory } from '@deepseek-ai/libreoffice-kit'
import { DocumentExtractionLimiter } from '@aeven/document-extract/execution'
import type {} from '@aeven/document-extract'
import type { DocumentExtractInput, DocumentExtractProviderId, ExtractedDocument } from '@aeven/document-extract'

/** Stable plugin name. */
export const name = 'document-extract-office'
/** Services this provider needs. */
export const inject = ['documentExtract']

/** Office reader policy. */
export interface Config {
  /** Wall-clock limit of one conversion, measured from when it leaves the queue. */
  timeoutMs: number
  /** Simultaneous conversions; each runs its own engine process. */
  concurrency: number
}

export const Config: z<Partial<Config>, Config> = z.object({
  timeoutMs: z.natural().min(1).default(120_000),
  concurrency: z.natural().min(1).max(4).default(1),
})

/** Provider id registered on `ctx.documentExtract`. */
export const PROVIDER_ID = 'office' as DocumentExtractProviderId

/** Word-processing formats the engine exports as UTF-8 text. */
const TEXT_FORMATS: readonly string[] = ['doc', 'docx', 'odt']
/** Spreadsheet and presentation formats exported as PDF and read by the registry's PDF readers. */
const PDF_FORMATS: readonly string[] = ['xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp']

const MEDIA_TYPES: readonly string[] = [
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
]

/**
 * Convert one document in a private directory the engine alone writes to.
 * @param factory - engine shared by this plugin's conversions.
 * @param input - document bytes and lowercase extension.
 * @param signal - caller cancellation.
 * @returns text for word-processing formats, PDF bytes otherwise.
 */
async function convert(
  factory: ConverterFactory,
  input: DocumentExtractInput,
  signal: AbortSignal,
): Promise<{ readonly kind: 'text'; readonly text: string } | { readonly kind: 'pdf'; readonly data: Uint8Array }> {
  const work = await mkdtemp(join(tmpdir(), 'avn-office-'))
  const converter = await factory.create()
  try {
    const inputPath = join(work, `document.${input.extension}`)
    await writeFile(inputPath, input.data)
    const text = TEXT_FORMATS.includes(input.extension)
    const outputPath = join(work, text ? 'document.txt' : 'document.pdf')
    await converter.convert({ inputPath, outputPath }, signal)
    if (!text) return { kind: 'pdf', data: new Uint8Array(await readFile(outputPath)) }
    const decoded = (await readFile(outputPath, 'utf8')).replace(/^﻿/, '').replace(/\r\n?/g, '\n')
    return { kind: 'text', text: decoded.replace(/\n{3,}/g, '\n\n').trim() }
  } finally {
    await converter.dispose()
    await rm(work, { recursive: true, force: true })
  }
}

/**
 * Register the Office reader. Startup rejects when the kit's engine for this
 * platform is missing from the installation.
 * @param ctx - plugin context carrying `documentExtract`.
 * @param config - conversion policy.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const factory = await createConverterFactory({ timeoutMs: config.timeoutMs })
  ctx.effect(() => () => factory.dispose(), 'document-extract-office: engine')
  const limiter = new DocumentExtractionLimiter(config.concurrency)
  const extract = async (input: DocumentExtractInput, signal: AbortSignal): Promise<ExtractedDocument> => {
    const converted = await limiter.run(() => convert(factory, input, signal))
    if (converted.kind === 'text') return { text: converted.text, method: 'office' }
    // The office provider claims no PDF extension, so this cannot re-enter it.
    const read = await ctx.documentExtract.extract({ data: converted.data, name: 'converted.pdf', mediaType: 'application/pdf' }, signal)
    return { text: read.text, method: 'office', ...read.pages === undefined ? {} : { pages: read.pages } }
  }
  ctx.effect(() => ctx.documentExtract.register({
    info: {
      id: PROVIDER_ID,
      version: ENGINE_VERSION,
      formats: { extensions: [...TEXT_FORMATS, ...PDF_FORMATS], mediaTypes: MEDIA_TYPES },
      priority: 10,
    },
    extract,
  }), 'document-extract-office: provider')
}
