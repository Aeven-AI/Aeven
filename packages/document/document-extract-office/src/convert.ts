/**
 * Headless LibreOffice conversion of one document to text, per-sheet CSV, or PDF.
 * @module @aeven/document-extract-office/convert
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { RunProcess } from './runtime.ts'

/** Word-processor formats exported as UTF-8 text. */
export const TEXT_FORMATS: readonly string[] = [
  'pages', 'doc', 'dot', 'docx', 'docm', 'dotx', 'rtf', 'odt', 'ott', 'fodt', 'wpd', 'wps', 'lwp', 'hwp', 'sxw', 'abw', 'uot',
]
/** Spreadsheet formats exported as one CSV per sheet. */
export const SHEET_FORMATS: readonly string[] = [
  'numbers', 'xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'ots', 'fods', 'sxc', 'wk1', 'wks', 'dbf', 'uos',
]
/** Presentation and drawing formats exported as PDF and read by the PDF reader. */
export const PDF_FORMATS: readonly string[] = [
  'key', 'ppt', 'pps', 'pot', 'pptx', 'pptm', 'ppsx', 'potx', 'odp', 'otp', 'fodp', 'sxi', 'odg', 'otg', 'fodg', 'vsd', 'vsdx', 'cdr', 'pub', 'uop',
]

/** Conversion output. */
export type OfficeConversion =
  | { readonly kind: 'text'; readonly text: string; readonly pages?: number }
  | { readonly kind: 'pdf'; readonly data: Uint8Array }

// Filter options of the CSV export: comma, double quote, UTF-8, first line,
// cell format, then sheet -1 writes every sheet to its own file.
const CSV_FILTER = 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1'

/**
 * Convert one document with a private LibreOffice profile, so a running
 * LibreOffice window or a concurrent conversion never shares its lock.
 * @param soffice - LibreOffice executable.
 * @param input - document bytes and lowercase extension.
 * @param run - subprocess runner.
 * @param signal - caller cancellation.
 * @returns extracted text, or PDF bytes for the PDF reader.
 */
export async function convertDocument(
  soffice: string,
  input: { readonly data: Uint8Array; readonly extension: string },
  run: RunProcess,
  signal: AbortSignal,
): Promise<OfficeConversion> {
  const work = await mkdtemp(join(tmpdir(), 'avn-office-'))
  try {
    const source = join(work, `document.${input.extension}`)
    const out = join(work, 'out')
    await writeFile(source, input.data)
    const target = SHEET_FORMATS.includes(input.extension)
      ? CSV_FILTER
      : PDF_FORMATS.includes(input.extension) ? 'pdf' : 'txt:Text (encoded):UTF8'
    const { exitCode, stderr } = await run({
      argv: [
        soffice,
        `-env:UserInstallation=${pathToFileURL(join(work, 'profile')).href}`,
        '--headless', '--invisible', '--norestore', '--nologo', '--nodefault', '--nolockcheck',
        '--convert-to', target, '--outdir', out, source,
      ],
      cwd: work,
      signal,
    })
    let outputs: string[] = []
    try {
      outputs = (await readdir(out)).sort()
    } catch {
      // No output directory: LibreOffice produced nothing; reported below.
    }
    if (outputs.length === 0) {
      throw new Error(`LibreOffice produced no output (exit ${String(exitCode)}): ${stderr.trim().slice(0, 500)}`)
    }
    if (target === 'pdf') return { kind: 'pdf', data: new Uint8Array(await readFile(join(out, outputs[0] as string))) }
    if (target === CSV_FILTER) {
      const sections: string[] = []
      for (const name of outputs) {
        const sheet = /^document-(.+)\.csv$/.exec(name)?.[1] ?? name.replace(/\.csv$/, '')
        const csv = (await readFile(join(out, name), 'utf8')).trim()
        if (csv !== '') sections.push(`# Sheet: ${sheet}\n${csv}`)
      }
      return { kind: 'text', text: sections.join('\n\n'), pages: outputs.length }
    }
    const text = (await readFile(join(out, outputs[0] as string), 'utf8')).replace(/^﻿/, '').replace(/\r\n?/g, '\n')
    return { kind: 'text', text: text.replace(/\n{3,}/g, '\n\n').trim() }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
