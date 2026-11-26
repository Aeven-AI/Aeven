/**
 * One headless browser shared by every page preview: started on the first such preview, reused while
 * previews keep coming, and closed once it has been idle for the configured time.
 * @module @aeven/host-artifact-previews/browser
 */
import { existsSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { Browser } from 'puppeteer-core'
import { serveFolder, type FolderServer } from './folder-server.ts'

/** Where the browser comes from. */
export interface BrowserSource {
  /** Chromium executable; omitted, an installed Chrome, Chromium, Edge or Brave. */
  readonly browserPath?: string | undefined
  /** Directory a headless shell is downloaded into when no browser is installed; omitted, nothing is downloaded. */
  readonly browserCacheDir?: string | undefined
}

/** What one screenshot loads. */
export type ScreenshotSource =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'html'; readonly html: string }

/** No browser could be started: a fact about this machine, not about the page being previewed. */
export class BrowserUnavailableError extends Error {
  override readonly name = 'BrowserUnavailableError'
}

/** Shared headless browser for previews. */
export class PreviewBrowser {
  private browser: Promise<Browser> | undefined
  private idle: ReturnType<typeof setTimeout> | undefined
  private open = 0

  /**
   * @param source - where the browser comes from.
   * @param idleMs - how long an unused browser stays open.
   * @param waits - the longest wait for the page's network to go quiet after it loaded, and how long it is then
   * given to finish drawing before the screenshot, in milliseconds.
   */
  constructor(
    private readonly source: BrowserSource,
    private readonly idleMs: number,
    private readonly waits: { readonly networkIdleMs: number; readonly settleMs: number },
  ) {}

  /**
   * Screenshot a page at card shape.
   * @param page - a local file to open, or a document to set.
   * @param picture - the card's size and WebP quality; the page lays out at twice that size.
   * @param timeoutMs - the budget for loading and drawing.
   * @param signal - aborts the screenshot.
   * @returns the WebP picture.
   */
  async screenshot(
    page: ScreenshotSource,
    picture: { readonly width: number; readonly height: number; readonly quality: number },
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    this.open += 1
    if (this.idle !== undefined) clearTimeout(this.idle)
    try {
      const browser = await this.launch()
      const tab = await browser.newPage()
      let folder: FolderServer | undefined
      const close = (): void => { void tab.close().catch(() => {}) }
      signal.addEventListener('abort', close, { once: true })
      try {
        await tab.setViewport({ width: picture.width * 2, height: picture.height * 2, deviceScaleFactor: 0.5 })
        tab.setDefaultTimeout(timeoutMs)
        if (page.kind === 'file') {
          // Served over loopback rather than opened as a file, so the page's JavaScript modules run.
          folder = await serveFolder(dirname(page.path))
          await tab.goto(`${folder.origin}/${encodeURIComponent(basename(page.path))}`, { waitUntil: 'load', timeout: timeoutMs })
        } else {
          await tab.setContent(page.html, { waitUntil: 'load', timeout: timeoutMs })
        }
        // A page that keeps fetching, such as one polling or streaming, is shot once the wait runs out instead.
        await tab.waitForNetworkIdle({ idleTime: 300, timeout: this.waits.networkIdleMs }).catch(() => {})
        await tab.evaluate(async (settleMs: number) => {
          await document.fonts.ready
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          await new Promise(resolve => setTimeout(resolve, settleMs))
        }, this.waits.settleMs)
        const image = await tab.screenshot({ type: 'webp', quality: picture.quality, optimizeForSpeed: true })
        return new Uint8Array(image)
      } finally {
        signal.removeEventListener('abort', close)
        close()
        await folder?.close()
      }
    } finally {
      this.open -= 1
      if (this.open === 0) this.idle = setTimeout(() => { void this.close() }, this.idleMs)
    }
  }

  /** Close the browser now. */
  async close(): Promise<void> {
    if (this.idle !== undefined) clearTimeout(this.idle)
    this.idle = undefined
    const running = this.browser
    this.browser = undefined
    if (running !== undefined) await (await running.catch(() => undefined))?.close().catch(() => {})
  }

  private launch(): Promise<Browser> {
    this.browser ??= (async () => {
      try {
        const { launch } = await import('puppeteer-core')
        const executablePath = await this.executable()
        return await launch({ executablePath, headless: true, args: ['--hide-scrollbars', '--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
      } catch (error) {
        throw new BrowserUnavailableError(error instanceof Error ? error.message : String(error), { cause: error })
      }
    })()
    // A failed start is tried again on the next preview.
    this.browser.catch(() => { this.browser = undefined })
    return this.browser
  }

  private async executable(): Promise<string> {
    if (this.source.browserPath !== undefined) {
      if (!existsSync(this.source.browserPath)) throw new Error(`artifact-previews: browser not found at ${this.source.browserPath}`)
      return this.source.browserPath
    }
    const { headlessShellBuildId, resolveBrowser } = await import('@aeven/motion-hyperframes/browser')
    if (this.source.browserCacheDir === undefined) {
      return await resolveBrowser({ cacheDir: '', headlessShellBuildId: '', allowDownload: false }, AbortSignal.timeout(1000))
    }
    const request = { cacheDir: this.source.browserCacheDir, headlessShellBuildId: await headlessShellBuildId() }
    return await resolveBrowser(request, new AbortController().signal)
  }
}
