/**
 * OCR worker-thread entry: renders PDF pages and recognizes their text.
 * @module @aeven/document-extract-ocr/worker
 */

import { parentPort, workerData } from 'node:worker_threads'
import type { ExtractedDocument } from '@aeven/document-extract'
import type { OcrWorkerInit, OcrWorkerReply } from './protocol.ts'

async function recognize(init: OcrWorkerInit): Promise<ExtractedDocument> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createScheduler, createWorker } = await import('tesseract.js')
  // The full pdf.js build carries the JBIG2 and JPEG 2000 decoders scanners emit.
  const pdf = await getDocument({
    data: init.data,
    wasmUrl: init.wasmPath,
    standardFontDataUrl: init.fontPath,
  }).promise
  const pages = Math.min(pdf.numPages, init.maxPages)
  const scheduler = createScheduler()
  const recognizers = Math.min(init.recognizers, pages)
  const workers = await Promise.all(Array.from({ length: recognizers }, () =>
    createWorker(init.languages, 1, { langPath: init.langPath, cacheMethod: 'none', gzip: true })))
  for (const worker of workers) scheduler.addWorker(worker)
  try {
    const sections: string[] = []
    // Pages render in order on this thread while the recognizers work through
    // the queue; two rendered pages per recognizer bound the images held at once.
    const pending: Array<Promise<void>> = []
    for (let page = 1; page <= pages; page += 1) {
      if (pending.length >= recognizers * 2) await pending.shift()
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
      await pdfPage.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise
      pdfPage.cleanup()
      const index = page - 1
      const image = canvas.toBuffer('image/png')
      pending.push(scheduler.addJob('recognize', image).then(({ data }) => {
        const text = data.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
        sections[index] = `--- Page ${page} ---\n${text}`
      }))
    }
    await Promise.all(pending)
    if (pdf.numPages > pages) sections.push(`[Recognized the first ${pages} of ${pdf.numPages} pages.]`)
    const hasText = sections.some(section => section.replace(/^--- Page \d+ ---\n?/, '').trim() !== '')
    return { text: hasText ? sections.join('\n\n') : '', method: 'ocr', pages: pdf.numPages }
  } finally {
    await scheduler.terminate()
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
