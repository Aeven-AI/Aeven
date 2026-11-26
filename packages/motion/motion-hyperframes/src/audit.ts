/**
 * Measure a bundled composition in a headless page: load the document, seek its player to each audit time, and
 * return what the audit script measured. The browser is the Puppeteer that HyperFrames itself captures with.
 * @module
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { withMotionAuditScript, type MotionAuditSamples } from '@aeven/motion'

/** The part of Puppeteer's page this module calls. */
interface AuditPage {
  setViewport(viewport: { width: number; height: number }): Promise<void>
  goto(url: string, options: { waitUntil: 'load'; timeout: number }): Promise<unknown>
  waitForFunction(expression: string, options: { timeout: number }): Promise<unknown>
  evaluate<T>(expression: string): Promise<T>
}

/** The part of Puppeteer's browser this module calls. */
interface AuditBrowser {
  newPage(): Promise<AuditPage>
  close(): Promise<void>
}

/** The part of Puppeteer this module calls. */
interface AuditPuppeteer {
  launch(options: { executablePath: string; headless: boolean | 'shell'; args: string[] }): Promise<AuditBrowser>
}

/**
 * Load the Puppeteer that HyperFrames' producer depends on, so the audit drives the browser build the capture does.
 * @returns the Puppeteer entry.
 */
async function producerPuppeteer(): Promise<AuditPuppeteer> {
  const producer = fileURLToPath(import.meta.resolve('@hyperframes/producer'))
  const entry = createRequire(producer).resolve('puppeteer-core')
  const loaded = await import(pathToFileURL(entry).href) as { default: AuditPuppeteer }
  return loaded.default
}

/**
 * Measure a bundled composition at the given film times.
 * @param html - the bundled document, as the live player plays it.
 * @param chromePath - Chromium executable.
 * @param times - film times in seconds.
 * @param readyMs - how long the composition's player may take to report ready, in milliseconds.
 * @param signal - cancellation; the browser closes when it aborts.
 * @returns the page's samples, or undefined when the page carries no HyperFrames player to seek.
 * @throws When the browser cannot start, the page fails to load, or the player does not report ready in time.
 */
export async function auditComposition(
  html: string, chromePath: string, times: readonly number[], readyMs: number, signal: AbortSignal,
): Promise<MotionAuditSamples | undefined> {
  const puppeteer = await producerPuppeteer()
  const scratch = await mkdtemp(join(tmpdir(), 'avn-motion-audit-'))
  try {
    const pagePath = join(scratch, 'page.html')
    await writeFile(pagePath, await withMotionAuditScript(html))
    signal.throwIfAborted()
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: basename(chromePath).includes('headless-shell') ? 'shell' : true,
      args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
    })
    const abort = (): void => { void browser.close() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      const page = await browser.newPage()
      await page.goto(pathToFileURL(pagePath).href, { waitUntil: 'load', timeout: readyMs })
      await page.waitForFunction('globalThis.__playerReady === true && globalThis.__player !== undefined', { timeout: readyMs })
      const frame = await page.evaluate<{ width: number; height: number }>(`(() => {
        const root = document.querySelector('[data-composition-id][data-width][data-height]')
        return { width: Number(root?.getAttribute('data-width')) || 1920, height: Number(root?.getAttribute('data-height')) || 1080 }
      })()`)
      await page.setViewport(frame)
      const samples = await page.evaluate<MotionAuditSamples | null>(`globalThis.__avnMotionAudit(${JSON.stringify(times)})`)
      signal.throwIfAborted()
      return samples ?? undefined
    } finally {
      signal.removeEventListener('abort', abort)
      await browser.close()
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
