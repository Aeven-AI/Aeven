/** Choose the Chromium executable HyperFrames captures frames with. @module */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Browser, detectBrowserPlatform, install } from '@puppeteer/browsers'

/**
 * Installed Chromium browsers this platform keeps at fixed locations, in preference order.
 * @returns absolute executable paths to test.
 */
function installedCandidates(): string[] {
  switch (process.platform) {
    case 'darwin': {
      const apps = ['/Applications', join(homedir(), 'Applications')]
      const bundles: readonly (readonly [bundle: string, binary: string])[] = [
        ['Google Chrome.app', 'Google Chrome'],
        ['Chromium.app', 'Chromium'],
        ['Microsoft Edge.app', 'Microsoft Edge'],
        ['Brave Browser.app', 'Brave Browser'],
      ]
      return apps.flatMap(root => bundles.map(([bundle, binary]) => join(root, bundle, 'Contents', 'MacOS', binary)))
    }
    case 'win32': {
      const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
        .filter((root): root is string => root !== undefined && root !== '')
      return [
        ...roots.map(root => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
        ...roots.map(root => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
      ]
    }
    default:
      return [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        '/usr/bin/microsoft-edge',
      ]
  }
}

/**
 * Resolve the browser: the configured path, else an installed Chromium browser, else Chrome for Testing's
 * headless shell downloaded once into `cacheDir`.
 * @param options - configured path, download cache, and the headless shell build to download.
 * @param signal - cancellation for the download.
 * @returns absolute executable path.
 * @throws When the configured path is missing, or no browser is installed and none can be downloaded for this
 *   platform (Chrome for Testing publishes no Linux arm64 build).
 */
export async function resolveBrowser(
  options: { browserPath?: string | undefined; cacheDir: string; headlessShellBuildId: string },
  signal: AbortSignal,
): Promise<string> {
  if (options.browserPath !== undefined) {
    if (!existsSync(options.browserPath)) throw new Error(`motion-hyperframes: browser not found at ${options.browserPath}`)
    return options.browserPath
  }
  const installed = installedCandidates().find(path => existsSync(path))
  if (installed !== undefined) return installed
  const platform = detectBrowserPlatform()
  if (platform === undefined || (process.platform === 'linux' && process.arch === 'arm64')) {
    throw new Error('Motion rendering needs Google Chrome or Chromium; install one and try again.')
  }
  signal.throwIfAborted()
  const browser = await install({
    browser: Browser.CHROMEHEADLESSSHELL,
    buildId: options.headlessShellBuildId,
    cacheDir: options.cacheDir,
    platform,
  })
  return browser.executablePath
}
