/**
 * OCR worker-thread entry: renders PDF pages and recognizes their text.
 * @module @aeven/document-extract-ocr/worker
 */

import { parentPort, workerData } from 'node:worker_threads'
import type { ExtractedDocument } from '@aeven/document-extract'
import type { OcrWorkerInit, OcrWorkerReply } from './protocol.ts'

async function recognize(init: OcrWorkerInit): Promise<ExtractedDocument> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createWorker } = await import('tesseract.js')
  // The full pdf.js build carries the JBIG2 and JPEG 2000 decoders scanners emit.
  const pdf = await getDocument({
    data: init.data,
    wasmUrl: init.wasmPath,
    standardFontDataUrl: init.fontPath,
  }).promise
  const pages = Math.min(pdf.numPages, init.maxPages)
  const tesseract = await createWorker(init.languages, 1, { langPath: init.langPath, cacheMethod: 'none', gzip: true })
  try {
    const sections: string[] = []
    for (let page = 1; page <= pages; page += 1) {
      const pdfPage = await pdf.getPage(page)
      const viewport = pdfPage.getViewport({ scale: init.scale })
      const width = Math.ceil(viewport.width)
      const height = Math.ceil(viewport.height)
      const { createCanvas } = await import('@napi-rs/canvas')
      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      // pdf.js draws through the Canvas 2D API, which @napi-rs/canvas implements.
      await pdfPage.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise
      pdfPage.cleanup()
      const { data } = await tesseract.recognize(canvas.toBuffer('image/png'))
      const text = data.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
      sections.push(`--- Page ${page} ---\n${text}`)
    }
    if (pdf.numPages > pages) sections.push(`[Recognized the first ${pages} of ${pdf.numPages} pages.]`)
    const hasText = sections.some(section => section.replace(/^--- Page \d+ ---\n?/, '').trim() !== '')
    return { text: hasText ? sections.join('\n\n') : '', method: 'ocr', pages: pdf.numPages }
  } finally {
    await tesseract.terminate()
  }
}

const port = parentPort
if (port === null) throw new Error('document-extract-ocr worker requires a parent port')

void recognize(workerData as OcrWorkerInit).then(
  (result) => { port.postMessage({ ok: true, result } satisfies OcrWorkerReply) },
  (error: unknown) => {
    port.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) } satisfies OcrWorkerReply)
  },
)
