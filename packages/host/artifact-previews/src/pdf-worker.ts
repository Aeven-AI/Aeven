/**
 * PDF worker-thread entry: draws a PDF's first page at card width on white and cuts the card from its top.
 * @module @aeven/host-artifact-previews/pdf-worker
 */
import { parentPort, workerData } from 'node:worker_threads'
import type { PdfWorkerInit, PdfWorkerReply } from './pdf-protocol.ts'

async function draw(init: PdfWorkerInit): Promise<Uint8Array> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createCanvas } = await import('@napi-rs/canvas')
  const task = getDocument({ data: init.data, wasmUrl: init.wasmPath, standardFontDataUrl: init.fontPath })
  const pdf = await task.promise
  const page = await pdf.getPage(1)
  const scale = init.width / page.getViewport({ scale: 1 }).width
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(init.width, init.height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, init.width, init.height)
  // pdf.js draws through the Canvas 2D API, which @napi-rs/canvas implements; the page runs past the card's foot.
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise
  page.cleanup()
  await task.destroy()
  return new Uint8Array(await canvas.encode('webp', init.quality))
}

const port = parentPort
if (port === null) throw new Error('artifact-previews PDF worker requires a parent port')

void draw(workerData as PdfWorkerInit).then(
  (image) => { port.postMessage({ ok: true, image } satisfies PdfWorkerReply, [image.buffer as ArrayBuffer]) },
  (error: unknown) => {
    port.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) } satisfies PdfWorkerReply)
  },
)
