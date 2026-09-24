/**
 * The Chromium the web client's right sidebar browser opens on the Host.
 *
 * A browser tab cannot start a process, so the sidebar asks this service to.
 * The browser is launched the way a person starts one for DevTools: a remote
 * debugging port and a dedicated profile, and no `--enable-automation`, which
 * is what puts the "controlled by automated test software" banner up and makes
 * sites refuse sign-in. chrome-devtools-mcp attaches to that port with
 * `--browserUrl`; the model drives the browser through its tools.
 *
 * One profile serves every session, so a site signed in to once stays signed
 * in. A browser already answering on the port is brought to the front at its
 * current tab rather than started again, which would add an empty tab.
 *
 * The model's browser tools attach to the same port, so a call to one of them
 * (the `mcpServerName` server's tools) first makes sure the browser answers,
 * launching it here on the Host when it does not. The launch never goes through
 * the model's shell: a sandboxed shell cannot write the profile a browser
 * needs, which left the tools failing under every mode short of full access.
 *
 * @module @aeven/browser-chromium
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@aeven/agent'
import type {} from '@aeven/tools'
import { resolveAvnHome } from '@aeven/home-paths'
import { Remote, TypertRemoteService } from '@aeven/typert-protocol'
import type { BrowserChromiumOpened } from './types.ts'

export type { BrowserChromiumOpened } from './types.ts'

/** Schemes the browser may be opened at. */
const OPENABLE_PROTOCOLS = new Set(['http:', 'https:'])

/** How long a launch may take to answer on its debugging port, in ms. */
const READY_TIMEOUT_MS = 20_000

/** How often a launch's debugging port is polled, in ms. */
const READY_POLL_MS = 250

declare module '@deepseek-ai/cordis' {
  interface Context {
    browserChromium: BrowserChromium
  }
}

/** Where the browser runs and what it stores. */
export interface Config {
  /** Chromium or Chrome executable to launch. */
  executablePath: string
  /** Remote debugging port; chrome-devtools-mcp's `--browserUrl` names the same one. */
  port: number
  /** Profile directory. Omit for `<AVN_HOME>/runtime/chrome-profile`. */
  userDataDir?: string
  /**
   * MCP server whose tools drive this browser (chrome-devtools-mcp attached with
   * `--browserUrl` to `port`); a call to one of them launches the browser first
   * when it is not answering. Empty disables the launch-on-call.
   */
  mcpServerName: string
}

/** Launches and addresses the Host's Chromium. */
export class BrowserChromium extends TypertRemoteService {
  static Config: z<Config> = z.object({
    executablePath: z.string().required(),
    port: z.number().step(1).min(1).max(65_535).required(),
    userDataDir: z.string(),
    mcpServerName: z.string().default('chrome_devtools'),
  })

  private readonly executablePath: string
  private readonly port: number
  private readonly userDataDir: string
  /** The launch in progress, which concurrent tool calls wait on instead of starting their own. */
  private launching: Promise<BrowserChromiumOpened> | undefined

  /**
   * @param ctx - owning context.
   * @param config - the executable, debugging port, and profile.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'browserChromium')
    this.executablePath = config.executablePath
    this.port = config.port
    this.userDataDir = config.userDataDir ?? join(resolveAvnHome(), 'runtime', 'chrome-profile')
    const toolPrefix = config.mcpServerName === '' ? undefined : `mcp__${config.mcpServerName}__`
    if (toolPrefix !== undefined) {
      ctx.on('tools/execute', async (exec, next) => {
        if (exec.name.startsWith(toolPrefix)) {
          // A browser that cannot be started is the tool's to report: it then
          // fails as it would have, naming the unreachable port.
          this.launching ??= this.ensureRunning('', exec.signal)
            .finally(() => { this.launching = undefined })
          await this.launching.catch(() => undefined)
        }
        return next()
      })
    }
  }

  /**
   * Open the browser at an address: launch it, or bring the running one to the front.
   * @param agent - the session asking; every session shares the one browser.
   * @param url - the http(s) address to show, or empty for the browser's start page.
   * @param signal - caller cancellation.
   * @returns the debugging endpoint once the browser answers on it.
   * @throws {Error} when the address is not http(s) or the browser does not come up.
   */
  @Remote('open')
  async remoteExportOpen(agent: Agent, url: string, signal: AbortSignal): Promise<BrowserChromiumOpened> {
    void agent
    if (url !== '' && !OPENABLE_PROTOCOLS.has(new URL(url).protocol)) {
      throw new Error(`browser-chromium: only an http(s) address opens, got ${url}`)
    }
    const browserUrl = `http://127.0.0.1:${String(this.port)}`
    const targets = await fetch(`${browserUrl}/json/list`, { signal })
      .then(async response => response.ok ? await response.json() as Array<{ id: string; type: string }> : undefined, () => undefined)
    if (targets !== undefined) {
      // A running browser whose last window was closed still answers with no
      // page, so a new one is opened for it: the reader asked to see a browser.
      const opened = url !== '' || !targets.some(target => target.type === 'page')
        ? await fetch(`${browserUrl}/json/new${url === '' ? '' : `?${encodeURI(url)}`}`, { method: 'PUT', signal })
          .then(async response => response.ok ? await response.json() as { id: string } : undefined, () => undefined)
        : undefined
      const page = opened ?? targets.find(target => target.type === 'page')
      if (page !== undefined) await fetch(`${browserUrl}/json/activate/${page.id}`, { signal })
      return { browserUrl }
    }
    return this.ensureRunning(url, signal)
  }

  /**
   * Make the browser answer on its debugging port, launching it when nothing does.
   * @param url - address a fresh launch opens, or empty for the start page.
   * @param signal - caller cancellation.
   * @returns the debugging endpoint.
   * @throws {Error} when the browser does not come up in time.
   */
  private async ensureRunning(url: string, signal: AbortSignal): Promise<BrowserChromiumOpened> {
    const browserUrl = `http://127.0.0.1:${String(this.port)}`
    const answering = await fetch(`${browserUrl}/json/version`, { signal }).then(response => response.ok, () => false)
    if (answering) return { browserUrl }
    const child = spawn(this.executablePath, [
      `--remote-debugging-port=${String(this.port)}`,
      `--user-data-dir=${this.userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...url === '' ? [] : [url],
    ], { detached: true, stdio: 'ignore' })
    child.unref()
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      signal.throwIfAborted()
      const ready = await fetch(`${browserUrl}/json/version`, { signal }).then(response => response.ok, () => false)
      if (ready) return { browserUrl }
      await new Promise(resolve => setTimeout(resolve, READY_POLL_MS))
    }
    throw new Error(`browser-chromium: ${this.executablePath} did not answer on port ${String(this.port)}`)
  }
}

export default BrowserChromium
