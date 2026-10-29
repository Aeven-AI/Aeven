/** Electron shell: desktop project ownership, custom protocol, windows, and lifecycle. */

import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { delimiter, dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  powerMonitor,
  protocol,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import { DESKTOP_MENU_ZOOM_STEP, FULL_SCREEN_ITEM_ID, applicationMenuTemplate, type DesktopMenuZoom } from './application-menu.ts'
import { ABOUT_WINDOW_HEIGHT, ABOUT_WINDOW_WIDTH, aboutPageDocument } from './about-window.ts'
import { adoptedHostSignIn, completeOAuthLanding, forwardAevenApiRequest } from './aeven-sign-in.ts'
import { collectNow, startBrowserSignIn } from './oauth-browser.ts'
import { AevenSession } from './aeven-session.ts'
import { installContextMenu, registerContextMenuIpc } from './context-menu.ts'
import { listenForPageLinks, openContentAddress } from './external-links.ts'
import { hardenBrowserGuests, registerBrowserIpc } from './browser-guests.ts'
import { acquireHostClientLease, resolveAvnHome } from '@aeven/home-paths'
import { planDesktopBackend } from './attached-host.ts'
import { resolveDesktopPaths } from './paths.ts'
import { DesktopProjectManager, type DesktopProjectHooks, type DesktopReleaseStep } from './project-manager.ts'
import { DesktopHostProcess } from './host-process.ts'
import { DESKTOP_AEVEN_API_PATH, type DesktopAevenSignIn } from './host-protocol.ts'
import { DESKTOP_IPC, type DesktopCaptionAction, type DesktopMenuCommand, type DesktopProviderSignInState } from './ipc.ts'
import { formatDesktopMessage, resolveDesktopLocale } from './locale.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { DesktopBackgroundMode } from './background-mode.ts'
import { DesktopUpdateCoordinator } from './update-coordinator.ts'
import { stagedReleaseResources, stageNativeUpdate } from './update-staging.ts'
import type { DesktopUpdateState } from './ipc.ts'
import { desktopUpdatePrompt } from './update-prompt.ts'
import { loginShellPath, mergePath } from './login-shell-path.ts'
import { sendVideoEmbedReferrer } from './video-embeds.ts'
import { START_PAGE_PATH, readStartScreenScheme, startPageDocument, startPageUrl } from './start-screen.ts'
import { bundleIdentifier, clearUpdateResidue, updateCacheRoot, updaterCacheDir } from './update-residue.ts'

const SCHEME = 'avn-app'
let focusPrimaryWindow = (): void => {}

/** The menu command the shell sends when Settings… is chosen. */
const OPEN_SETTINGS_COMMAND: DesktopMenuCommand = 'open-settings'

/** The menu command the shell sends when the dictation item is chosen. */
const START_DICTATION_COMMAND: DesktopMenuCommand = 'start-dictation'

/**
 * Set when a live Host already serves this home, in which case the shell
 * renders that origin instead of starting a second Host. `origin` scopes the
 * navigation guard: adopting a Host must not turn the window into a general
 * browser.
 */
let attachedBackend: { readonly url: string; readonly origin: string } | undefined

/**
 * Whether the shell's own provider sign-in claims an address before the
 * navigation guard hands it to the system browser. The flow needs the window
 * that started it, so the window that runs it sets this; nothing claims an
 * address until then.
 */
let claimsAppAddress: (url: string) => boolean = () => false

/** Root URL the main window renders: the adopted Host, or this shell's own app. */
function appEntryUrl(): string {
  return attachedBackend?.url ?? `${SCHEME}://app/index.html`
}

/** Absolute URL inside whichever app the main window is rendering. */
function appPathUrl(path: string): string {
  return attachedBackend === undefined ? `${SCHEME}://app${path}` : `${attachedBackend.origin}${path}`
}

function errorOf(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    stream: true,
    codeCache: true,
  },
}])

const MIME: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

interface RuntimeResources {
  readonly node: string
  readonly pnpm: string
  readonly seed: string
}

/**
 * Give the Host the deployment settings packaging recorded in this application's `package.json`
 * (`aevenDeployment`): an installed copy has no `.env`, and the profile rows read the Aeven account, web, media,
 * and sign-in URLs from the Host environment. A value the launching environment already sets wins.
 */
async function applyPackagedDeployment(): Promise<void> {
  if (!app.isPackaged) return
  const manifest: unknown = JSON.parse(await readFile(join(app.getAppPath(), 'package.json'), 'utf8'))
  const deployment = typeof manifest === 'object' && manifest !== null && 'aevenDeployment' in manifest
    ? manifest.aevenDeployment
    : undefined
  if (typeof deployment !== 'object' || deployment === null
    || !Object.values(deployment).every(value => typeof value === 'string')) {
    throw new Error('avn desktop: the application package carries no valid aevenDeployment settings')
  }
  for (const [name, value] of Object.entries(deployment as Record<string, string>)) {
    process.env[name] ??= value
  }
}

/**
 * Point the Host's computer-use row at the Cua Driver packaging shipped in `runtime/cua-driver`, so computer use
 * works without a separate driver install. `AVN_CUA_DRIVER_EMBEDDED` makes the macOS row run the driver as a child
 * that inherits Aeven's own Accessibility and Screen Recording grants. A driver path the launching environment
 * already sets wins.
 */
function applyBundledComputerUseDriver(): void {
  if (!app.isPackaged || process.env.AVN_CUA_DRIVER !== undefined) return
  const driver = join(process.resourcesPath, 'runtime', 'cua-driver', process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver')
  if (!existsSync(driver)) return
  process.env.AVN_CUA_DRIVER = driver
  process.env.AVN_CUA_DRIVER_EMBEDDED = '1'
}

function runtimeResources(): RuntimeResources {
  const development = !app.isPackaged
  const node = (development ? process.env.AVN_DESKTOP_NODE_BINARY : undefined)
    ?? join(process.resourcesPath, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  const pnpm = (development ? process.env.AVN_DESKTOP_PNPM_ENTRY : undefined)
    ?? join(process.resourcesPath, 'runtime', 'pnpm', 'bin', 'pnpm.mjs')
  const seed = (development ? process.env.AVN_DESKTOP_SEED_DIR : undefined) ?? join(process.resourcesPath, 'seed')
  return { node, pnpm, seed }
}

function developmentProject(): string | undefined {
  const configured = process.env.AVN_DESKTOP_DEV_PROJECT_DIR
  if (configured === undefined || configured === '') return undefined
  if (app.isPackaged) throw new Error('avn desktop: development project override is unavailable in packaged applications')
  return resolve(configured)
}

function developmentHostInspectPort(enabled: boolean): number | undefined {
  const configured = process.env.AVN_DESKTOP_HOST_INSPECT_PORT
  if (!enabled || configured === undefined || configured === '') return undefined
  const port = Number(configured)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('avn desktop: AVN_DESKTOP_HOST_INSPECT_PORT must be an integer from 1 through 65535')
  }
  return port
}

/**
 * Top padding above the client's sidebar toggle row
 * (client ui-sidebar SidebarRoot.module.css).
 */
const SIDEBAR_ROW_PADDING = 8

/** `--dsw-aeven-control-size`, the height of the toggle beside the controls. */
const CONTROL_SIZE = 40

/** Diameter of a macOS window button. */
const WINDOW_BUTTON_SIZE = 12

/**
 * Left inset of the traffic lights: `--dsw-aeven-page-inset`, so the gutter
 * they sit in matches the page's own edge inset.
 */
const TRAFFIC_LIGHT_INSET_X = 24

/**
 * Top inset of the traffic lights.
 *
 * The sidebar's toggle glyph is 18px in a 40px control below the row's
 * padding, so its centre line is `SIDEBAR_ROW_PADDING + CONTROL_SIZE / 2`.
 * Centring the buttons on that line is a pixel low in practice, because macOS
 * measures the inset against the button group's box rather than the painted
 * circles, so the value is taken from the rendered result.
 */
const TRAFFIC_LIGHT_INSET_Y = SIDEBAR_ROW_PADDING + (CONTROL_SIZE - WINDOW_BUTTON_SIZE) / 2 - 1

/**
 * The cache directory Squirrel keeps this application's staged installs in.
 * Squirrel names it after the bundle identifier the packaged application declares.
 * @param resourcesPath - the packaged application's resources directory.
 * @param cacheRoot - the platform's cache root.
 * @returns Squirrel's directory, or undefined where Squirrel is not the installer.
 */
function shipItCacheDir(resourcesPath: string, cacheRoot: string): string | undefined {
  if (process.platform !== 'darwin') return undefined
  let plist: string
  try {
    plist = readFileSync(join(resourcesPath, '..', 'Info.plist'), 'utf8')
  } catch {
    // A bundle without an Info.plist beside its resources has no identifier to name the cache by.
    return undefined
  }
  const identifier = bundleIdentifier(plist)
  return identifier === undefined ? undefined : join(cacheRoot, `${identifier}.ShipIt`)
}

/**
 * Clear the updater state a completed install left behind: the release it
 * staged, that release's differential baseline, and Squirrel's record of a
 * staged bundle it no longer has. Only a packaged application carries them.
 */
async function clearStaleUpdateResidue(): Promise<void> {
  if (!app.isPackaged) return
  const cacheRoot = updateCacheRoot(process.platform, process.env)
  const cacheDir = updaterCacheDir(process.resourcesPath, cacheRoot)
  if (cacheDir === undefined) return
  const removed = await clearUpdateResidue({
    cacheDir,
    shipItDir: shipItCacheDir(process.resourcesPath, cacheRoot),
    installedVersion: app.getVersion(),
  })
  if (removed.length > 0) console.info('avn desktop: cleared update residue', removed)
}

/**
 * Height of the Windows and Linux caption strip: Windows 11's own caption
 * height. The preload moves the page below it (`CAPTION_STRIP_HEIGHT` there).
 */
const CAPTION_BUTTONS_HEIGHT = 32

/** Caption glyph colours, matching the page's primary label in each scheme. */
const CAPTION_SYMBOL_COLOR = { light: '#000', dark: '#f9fafb' } as const

/**
 * Windows and Linux lay the page below a page-drawn strip (`installCaptionStrip`
 * in the preload). Windows draws its own caption buttons over it; Linux has the
 * preload draw them, since GTK would paint its theme's buttons.
 */
const CAPTION_STRIP_PLATFORM = process.platform === 'win32' || process.platform === 'linux'

/** The deployment a packaged shell talks to when the launching environment names none. */
const DESKTOP_AEVEN_API_BASE = 'https://aeven.io/api'

/** Wait after launch before the first automatic update check. */
const UPDATE_CHECK_STARTUP_DELAY_MS = 10_000

/**
 * Interval between automatic update checks. GitHub answers an unauthenticated
 * release request 60 times an hour for the whole machine, and a downloaded
 * release installs on quit, so a slower cadence costs nothing.
 */
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000

function createWindow(preload: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    // The client lays out down to a 375px phone width, so the window may too.
    minWidth: 375,
    minHeight: 600,
    show: false,
    // The page draws its own header, so the window contributes no title strip.
    // macOS insets the traffic lights over the page's top-left and keeps the
    // application menu in the system menu bar. Windows and Linux show a slim
    // strip above the page, which the preload clears and makes the window's
    // drag area; the menu's accelerators stay active without a native menu
    // bar. Windows draws its minimize, maximize and close buttons over the
    // strip. Linux gets no frame at all, so neither GTK's menu bar nor its
    // theme's caption buttons sit outside the page's colours, and the preload
    // draws the buttons.
    ...process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: TRAFFIC_LIGHT_INSET_X, y: TRAFFIC_LIGHT_INSET_Y } }
      : process.platform === 'win32'
        ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#00000000',
            symbolColor: CAPTION_SYMBOL_COLOR[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'],
            height: CAPTION_BUTTONS_HEIGHT,
          },
        }
        : process.platform === 'linux'
          ? { frame: false }
          : {},
    // Packaged builds take the icon from the executable or desktop entry; an unpackaged
    // Windows or Linux run would otherwise show Electron's. macOS development uses its bundle icon.
    ...!app.isPackaged && process.platform !== 'darwin'
      ? { icon: join(app.getAppPath(), 'resources', process.platform === 'win32' ? 'icon-windows.ico' : 'icon-macos.png') }
      : {},
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      // The right sidebar's browser renders visited pages in a `<webview>`.
      // The tag alone grants nothing: `hardenBrowserGuests` refuses every
      // guest outside the browser partition and fixes the rest of its
      // preferences in this process, where the renderer cannot reach them.
      webviewTag: true,
    },
  })
  hardenBrowserGuests(window.webContents)
  // A window the page asks for is a web destination the reader chose. The page
  // opens it where the client's own policy says when it listens for addresses,
  // and the operating system opens it otherwise; either way no second Electron
  // window is created.
  window.webContents.setWindowOpenHandler(({ url }) => {
    openContentAddress(window.webContents, url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url)
    if (target.protocol === `${SCHEME}:`) return
    // An adopted Host is the same application on this machine, so its own
    // origin is the one non-shell destination this window may reach.
    if (attachedBackend !== undefined && target.origin === attachedBackend.origin) return
    event.preventDefault()
    // A flow the shell runs itself loads its landing into a window, so the
    // window that started it keeps the address rather than the system browser.
    if (!claimsAppAddress(url)) openContentAddress(window.webContents, url)
  })
  return window
}

function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): void {
  const senderFrame = event.senderFrame
  if (senderFrame === null) throw new Error('avn desktop: rejected IPC without a sender frame')
  const url = new URL(senderFrame.url)
  const applicationHost = hostnames.includes('app') && attachedBackend !== undefined && url.origin === attachedBackend.origin
  if (!applicationHost && (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname))) {
    throw new Error('avn desktop: rejected IPC from an unowned renderer')
  }
}

async function serveShellAsset(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  const root = resolve(app.getAppPath(), 'renderer')
  const url = new URL(request.url)
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return new Response(null, { status: 400 })
  }
  const target = resolve(normalize(join(root, pathname)))
  if (target !== root && !target.startsWith(root + sep)) return new Response(null, { status: 403 })
  try {
    const body = request.method === 'HEAD' ? null : await readFile(target)
    return new Response(body, { headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' } })
  } catch {
    return new Response(null, { status: 404 })
  }
}

async function main(): Promise<void> {
  // The user's startup files can take seconds, and nothing before the backend install spawns a process that needs
  // their PATH, so the login shell runs alongside the deployment, the start screen, and the backend plan.
  const loginPathProbe = loginShellPath(process.env)
  await applyPackagedDeployment()
  applyBundledComputerUseDriver()
  const resources = runtimeResources()
  const paths = resolveDesktopPaths()
  const development = developmentProject()
  const activeProject = development ?? paths.profile
  const hostInspectPort = developmentHostInspectPort(development !== undefined)
  const manager = new DesktopProjectManager(paths, resources)
  let host: DesktopHostProcess | undefined
  // Held while this shell renders a Host another process launched, so that
  // Host keeps serving if its own shell quits first.
  let releaseClientLease: (() => Promise<void>) | undefined
  const holdAttachedHost = async (): Promise<void> => {
    releaseClientLease ??= await acquireHostClientLease(resolveAvnHome())
  }
  let aevenSignIn: DesktopAevenSignIn | undefined
  let aevenSession: AevenSession | undefined
  /** Keep the reader's Aeven session for the Host the window renders, replacing the previous keeper. */
  const keepAevenSession = (): void => {
    aevenSession?.dispose()
    aevenSession = undefined
    if (aevenSignIn === undefined || attachedBackend === undefined) return
    aevenSession = new AevenSession({
      apiUrl: aevenSignIn.apiUrl,
      hostOrigin: attachedBackend.origin,
      cookies: session.defaultSession.cookies,
      fetchApi: (url, init) => session.defaultSession.fetch(url, init),
      fetchHost: (url, init) => fetch(url, init),
      warn: (message) => { console.warn(message) },
    })
    aevenSession.start()
  }
  // Timers stall while the machine sleeps; a renewal it slept through runs on waking.
  powerMonitor.on('resume', () => { aevenSession?.wake() })
  let mainWindow: BrowserWindow | undefined
  let shellInstallerOwnsQuit = false
  const locale = resolveDesktopLocale(app.getLocale())
  const messages = locale.messages
  // Every page gets the right-click menu, including the sidebar browser's guests.
  app.on('web-contents-created', (_event, contents) => { installContextMenu(contents, messages) })
  const appPreload = fileURLToPath(new URL('./preload-app.cjs', import.meta.url))

  /**
   * Last state the coordinator published. The page's update popup reads it when
   * it opens, and a page that starts listening receives it as its first state.
   */
  let updateState: DesktopUpdateState = { phase: 'idle' }
  /**
   * Whether the page takes update states. The shell holds them until it does,
   * which is what a page that never subscribes — another build's client, a Host
   * served elsewhere — expects: no update surface at all.
   */
  let updateListening = false
  /** A surface the reader asked for before the page could show it. */
  let updateSurfaceRequested = false

  const publishUpdate = (state: DesktopUpdateState): DesktopUpdateState => {
    updateState = state
    const window = mainWindow
    if (updateListening && window !== undefined && !window.isDestroyed()) {
      window.webContents.send(DESKTOP_IPC.updatesState, state)
    }
    return state
  }

  const startupFinished = Promise.withResolvers<void>()

  /**
   * Write one line under the start screen's spinner. The application's own page
   * has replaced the start screen once this matters no more, so a window showing
   * anything else is left alone.
   * @param text - the line, already localized.
   */
  const showStartStatus = (text: string): void => {
    const window = mainWindow
    if (window === undefined || window.isDestroyed() || window.webContents.getURL() !== startPageUrl()) return
    window.webContents.executeJavaScript(
      `{const line=document.querySelector('.avn-start-status');if(line)line.textContent=${JSON.stringify(text)}}`,
    ).catch((error: unknown) => { console.warn('avn desktop: the start screen status did not update', error) })
  }

  /**
   * Hand one menu command to the page and bring its window forward: the page
   * owns both the Settings surface and the composer dictation acts on.
   * @param command - the command the page listens for.
   */
  const sendMenuCommand = (command: DesktopMenuCommand): void => {
    const window = mainWindow
    if (window === undefined || window.isDestroyed()) return
    window.webContents.send(DESKTOP_IPC.menuCommand, command)
    if (window.isMinimized()) window.restore()
    window.focus()
  }
  /**
   * Open the page's update popup: the application menu and a downloaded release
   * both surface through it. A page that has not subscribed yet keeps the
   * request, and receives it once it does.
   */
  const showUpdateSurface = (): void => {
    const window = mainWindow
    if (!updateListening || window === undefined || window.isDestroyed()) {
      updateSurfaceRequested = true
      return
    }
    window.webContents.send(DESKTOP_IPC.menuCommand, 'show-update')
  }
  const openSettings = (): void => { sendMenuCommand(OPEN_SETTINGS_COMMAND) }
  const startDictation = (): void => { sendMenuCommand(START_DICTATION_COMMAND) }

  /** The installed profile's release, absent until a launch has installed one. */
  const installedBackendVersion = (): string | undefined => {
    try {
      return manager.releaseVersion()
    } catch {
      // `releaseVersion` throws only while no profile is installed, which the start screen precedes.
      return undefined
    }
  }

  /** The open About window, kept so the menu item returns to it instead of opening another. */
  let aboutWindow: BrowserWindow | undefined

  /**
   * Show the running versions in the shell's own about window: one column with
   * one line per fact, the same on every platform.
   */
  const showAbout = (): void => {
    if (aboutWindow !== undefined && !aboutWindow.isDestroyed()) {
      aboutWindow.show()
      aboutWindow.focus()
      return
    }
    const backend = installedBackendVersion()
    const window = new BrowserWindow({
      width: ABOUT_WINDOW_WIDTH,
      height: ABOUT_WINDOW_HEIGHT,
      title: messages.aboutMenu,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      // The page draws the strip macOS's traffic lights sit in; Windows and Linux
      // keep their native frame, which carries the same title.
      ...process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 13 } }
        : {},
      webPreferences: { sandbox: true, contextIsolation: true },
    })
    aboutWindow = window
    window.on('closed', () => { aboutWindow = undefined })
    window.once('ready-to-show', () => { window.show() })
    const page = aboutPageDocument(process.platform, {
      title: messages.aboutMenu,
      name: app.name,
      version: formatDesktopMessage(messages.aboutVersionLine, { version: app.getVersion() }),
      backend: backend === undefined
        ? undefined
        : formatDesktopMessage(messages.aboutBackendLine, { version: backend }),
      electron: formatDesktopMessage(messages.aboutElectronLine, { version: process.versions.electron }),
      copyright: messages.aboutCopyrightLine,
    })
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
  }

  // The edit menu carries the clipboard and selection accelerators: macOS binds
  // Cmd+C, Cmd+V and Cmd+A through these roles, so a window without it cannot
  // copy or paste however the page is focused. The window menu is listed for
  // the same reason.
  const zoomApplicationWindow = (direction: DesktopMenuZoom): void => {
    const window = mainWindow
    if (window === undefined || window.isDestroyed()) return
    const contents = window.webContents
    const step = direction === 'in' ? DESKTOP_MENU_ZOOM_STEP : -DESKTOP_MENU_ZOOM_STEP
    contents.setZoomLevel(direction === 'reset' ? 0 : contents.getZoomLevel() + step)
  }

  // Every action reads `mainWindow` when it runs: the menu is installed before the backend starts and
  // before the first window exists, so a captured window would be undefined here.
  const fullScreenLabel = (): string => mainWindow?.isFullScreen() === true
    ? messages.exitFullScreenMenu
    : messages.enterFullScreenMenu

  const toggleFullScreen = (): void => {
    const window = mainWindow
    if (window === undefined || window.isDestroyed()) return
    window.setFullScreen(!window.isFullScreen())
  }

  /** Retitle the full-screen item in place; rebuilding the menu mid-transition breaks full screen. */
  const syncFullScreenLabel = (): void => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(FULL_SCREEN_ITEM_ID)
    if (item === undefined || item === null) return
    item.label = fullScreenLabel()
  }

  const installApplicationMenu = (): void => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate({
      platform: process.platform,
      applicationName: app.name,
      messages,
      actions: {
        // The update installer must not quit the shell while startup installs or starts the backend, so a
        // check asked for during startup says so on the start screen and opens the popup once the page is up.
        checkForUpdates: () => {
          showStartStatus(messages.updateCheckAfterStartup)
          void startupFinished.promise.then(() => {
            showUpdateSurface()
            void checkAndPrompt(true)
          })
        },
        showAbout,
        openSettings,
        startDictation,
        fullScreen: { label: fullScreenLabel(), click: toggleFullScreen },
        zoom: zoomApplicationWindow,
      },
    })))
  }
  installApplicationMenu()

  // Registered before the window below loads anything: the start screen is
  // served from this scheme, and every application request after it goes
  // through the same handler.
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'shell') {
      if (url.pathname !== START_PAGE_PATH) return serveShellAsset(request)
      // The Host's settings document holds the theme preference; the desktop
      // composition keeps it at the settings provider's default path.
      return readStartScreenScheme(join(resolveAvnHome(), 'settings.yaml')).then(scheme =>
        new Response(startPageDocument(process.platform, scheme), {
          headers: { 'content-type': MIME['.html'] ?? 'text/html; charset=utf-8' },
        }))
    }
    if (url.hostname !== 'app') return Promise.resolve(new Response(null, { status: 404 }))
    if (url.pathname.startsWith(`${DESKTOP_AEVEN_API_PATH}/`)) return forwardAevenApiRequest(request, aevenSignIn)
    const active = host
    if (active === undefined) return Promise.resolve(new Response('backend unavailable', { status: 503 }))
    return active.fetch(request)
  })

  /**
   * Sign in with a provider in the default browser, then bring the app back.
   * Providers refuse embedded windows, so none is opened here.
   */
  const reportProviderSignIn = (window: BrowserWindow, state: DesktopProviderSignInState): void => {
    if (!window.isDestroyed()) window.webContents.send(DESKTOP_IPC.providerSignIn, state)
  }
  const beginProviderSignIn = (window: BrowserWindow, url: string, land: (path: string) => Promise<void>): void => {
    void startBrowserSignIn({
      providerUrl: url,
      openExternal: target => shell.openExternal(target),
      // The window comes forward once the landing is settled, so the reader
      // returns to its cover rather than to the sign-in screen it left.
      land: (path) => {
        void land(path).finally(() => {
          if (window.isDestroyed()) return
          if (window.isMinimized()) window.restore()
          window.focus()
          app.focus({ steal: true })
        })
      },
    }).then((outcome) => {
      if (outcome === 'timed-out') reportProviderSignIn(window, 'ended')
    }, (error: unknown) => {
      console.error('avn desktop: provider sign-in failed', error)
      reportProviderSignIn(window, 'ended')
    })
  }

  /**
   * Exchange a landing in the session that holds the API's cookie, and tell the
   * window how it went; it shows its cover the moment the session exists.
   * @param window - the window that started the sign-in.
   * @param path - the `/oauth-result/...` path the sign-in collected.
   */
  const exchangeLanding = async (window: BrowserWindow, path: string): Promise<void> => {
    const signedIn = await completeOAuthLanding(path, aevenSignIn).catch((error: unknown) => {
      console.error('avn desktop: the provider sign-in could not be exchanged', error)
      return false
    })
    reportProviderSignIn(window, signedIn ? 'signed-in' : 'ended')
  }

  const createMainWindow = (): BrowserWindow => {
    const window = createWindow(appPreload)
    mainWindow = window
    claimsAppAddress = url => aevenSignIn?.oauthUrls.includes(url) === true
    // Either way the page reaches a provider, the provider opens in the default
    // browser and every other window stays denied. A page whose flow is a window
    // waits for the session this shell exchanges; a page whose flow is a redirect
    // gets the landing it expected loaded back into the window it came from.
    // Every other address the page asks a window for is content the reader
    // chose: the page opens it itself when it listens for addresses, and the
    // system browser opens it otherwise.
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (aevenSignIn?.oauthUrls.includes(url) === true) {
        beginProviderSignIn(window, url, path => exchangeLanding(window, path))
      } else {
        openContentAddress(window.webContents, url)
      }
      return { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event, url) => {
      if (aevenSignIn?.oauthUrls.includes(url) !== true) return
      event.preventDefault()
      beginProviderSignIn(window, url, path => window.loadURL(appPathUrl(path)))
    })
    window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
    // A reader switching back mid sign-in is either done in the browser or gave
    // up; collecting at once tells the window which before it decides.
    window.on('focus', collectNow)
    // The View menu's full-screen item names the state the window is in.
    window.on('enter-full-screen', syncFullScreenLabel)
    window.on('leave-full-screen', syncFullScreenLabel)
    window.on('closed', () => { if (mainWindow === window) mainWindow = undefined })
    return window
  }
  focusPrimaryWindow = () => {
    // Background mode hides the Dock icon while no window is open.
    if (process.platform === 'darwin') void app.dock?.show()
    const window = mainWindow
    if (window === undefined || window.isDestroyed()) {
      const replacement = createMainWindow()
      void replacement.loadURL(appEntryUrl())
      return
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  // Registered before the start screen loads: the preload fills the caption strip's menu bar on every page,
  // and a request with no handler yet would leave the strip empty for the whole startup.
  // The page reports the colour scheme it renders in, so the caption glyphs
  // stay legible against the page background the strip shows.
  ipcMain.on(DESKTOP_IPC.captionScheme, (event, scheme: unknown) => {
    if (process.platform !== 'win32' || mainWindow === undefined || event.sender !== mainWindow.webContents) return
    if (event.senderFrame !== event.sender.mainFrame || (scheme !== 'light' && scheme !== 'dark')) return
    mainWindow.setTitleBarOverlay({ color: '#00000000', symbolColor: CAPTION_SYMBOL_COLOR[scheme] })
  })
  // The caption strip's menu bar shows the application menu's top-level
  // entries and opens each one's submenu under its label, so the strip carries
  // the same native menus, accelerators included, that a framed window shows.
  const captionMenuWindow = (event: IpcMainInvokeEvent): BrowserWindow => {
    if (!CAPTION_STRIP_PLATFORM || mainWindow === undefined || event.sender !== mainWindow.webContents
      || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('avn desktop: caption menu request from another frame')
    }
    return mainWindow
  }
  ipcMain.handle(DESKTOP_IPC.captionMenuLabels, (event) => {
    captionMenuWindow(event)
    return (Menu.getApplicationMenu()?.items ?? []).map(item => item.label.replace(/&/gu, ''))
  })
  ipcMain.handle(DESKTOP_IPC.captionMenuOpen, (event, index: unknown, x: unknown, y: unknown) => {
    const window = captionMenuWindow(event)
    if (typeof index !== 'number' || !Number.isInteger(index)
      || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('avn desktop: invalid caption menu request')
    }
    // Electron's runtime stores null for an item with no submenu, while its typings declare only `Menu | undefined`.
    const submenu = Menu.getApplicationMenu()?.items[index]?.submenu ?? null
    if (submenu === null) return
    // The page measures in CSS pixels; the popup is placed in window pixels.
    const zoom = window.webContents.getZoomFactor()
    return new Promise<void>((resolvePopup) => {
      submenu.popup({ window, x: Math.round(x * zoom), y: Math.round(y * zoom), callback: () => { resolvePopup() } })
    })
  })
  // A frameless Linux window has only the strip's page-drawn buttons to
  // minimize, maximize and close it; their names follow the shell's locale.
  ipcMain.handle(DESKTOP_IPC.captionButtonLabels, (event): Record<DesktopCaptionAction, string> => {
    if (process.platform !== 'linux' || mainWindow === undefined || event.sender !== mainWindow.webContents
      || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('avn desktop: caption button request from another frame')
    }
    return { minimize: messages.minimizeWindow, maximize: messages.maximizeWindow, close: messages.closeWindow }
  })
  ipcMain.on(DESKTOP_IPC.captionWindowControl, (event, action: unknown) => {
    if (process.platform !== 'linux' || mainWindow === undefined || event.sender !== mainWindow.webContents) return
    if (event.senderFrame !== event.sender.mainFrame) return
    switch (action) {
      case 'minimize': mainWindow.minimize(); return
      case 'maximize': if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize(); return
      case 'close': mainWindow.close(); return
      default: return
    }
  })

  // The window is created, and the start screen is loaded into it, before any
  // of the waits below: the deployment, the login shell, a package install, and
  // a Host boot otherwise leave a launch showing nothing at all. A start screen
  // that fails to load is not fatal — the application still opens when ready.
  const startWindow = createMainWindow()
  await startWindow.loadURL(startPageUrl()).catch((error: unknown) => {
    console.error('avn desktop: the start screen did not load', error)
  })

  // The deployment whose services the Host's plugins resolve: the packaged app carries no `.env`,
  // so the launching environment supplies the base that the overlays and the search endpoint read.
  process.env.AEVEN_API_URL ??= DESKTOP_AEVEN_API_BASE
  // A packaged shell replaces a desktop Host from another release; a
  // development shell adopts whatever serves the home.
  const plan = await planDesktopBackend(development === undefined ? { avnVersion: app.getVersion() } : {})
  if (development === undefined && plan.kind === 'spawn') await manager.recover()
  // pnpm, the Host, and every process they start inherit this PATH; a GUI launch alone carries the session's minimal one.
  const loginPath = await loginPathProbe
  if (loginPath === undefined) console.warn('desktop: the login shell did not report a PATH; the Host keeps the inherited one')
  else process.env.PATH = mergePath(loginPath, process.env.PATH, delimiter)
  // Last, so an installed Node.js still wins: on a machine without one, the bundled `node`, `npm`, and `npx` resolve.
  process.env.PATH = mergePath(process.env.PATH ?? '', dirname(resources.node), delimiter)

  const startHost = async (projectDir = activeProject): Promise<DesktopHostProcess> => {
    // The serving Host keeps its profile as the cwd that sessions without a directory fall back to; a staged health
    // check runs from `paths.work`, since its profile is renamed into place as soon as it stops.
    const workDir = projectDir === activeProject ? projectDir : paths.work
    const next = new DesktopHostProcess(resources.node, projectDir, workDir, hostInspectPort)
    const ready = await next.start()
    if (!ready.ownsHost && projectDir !== activeProject) {
      next.release()
      throw new Error('stop the existing Aeven Host before validating a desktop update')
    }
    if (!ready.ownsHost) await holdAttachedHost()
    if (projectDir === activeProject) {
      aevenSignIn = ready.aevenSignIn ?? await adoptedHostSignIn(ready.url)
      attachedBackend = { url: ready.url, origin: new URL(ready.url).origin }
      keepAevenSession()
    }
    return next
  }
  const hooks: DesktopProjectHooks = {
    healthCheck: async (projectDir) => {
      const active = host
      if (attachedBackend !== undefined && (active === undefined || !active.ownsHost)) throw new Error('stop the existing Aeven Host before updating the desktop backend')
      host = undefined
      await active?.stop()
      let healthFailure: unknown
      let probe: DesktopHostProcess | undefined
      try {
        probe = await startHost(projectDir)
        await probe.stop()
      } catch (error) {
        healthFailure = error
        await probe?.stop().catch(() => undefined)
      }
      let restartFailure: unknown
      if (active !== undefined) {
        try {
          host = await startHost()
        } catch (error) {
          restartFailure = error
        }
      }
      if (healthFailure !== undefined && restartFailure !== undefined) {
        throw new AggregateError([
          errorOf(healthFailure, 'desktop project: staged health check failed'),
          errorOf(restartFailure, 'desktop project: active backend restart failed'),
        ], 'desktop project: staged health check and active backend restart failed')
      }
      if (healthFailure !== undefined) throw errorOf(healthFailure, 'desktop project: staged health check failed')
      if (restartFailure !== undefined) throw errorOf(restartFailure, 'desktop project: active backend restart failed')
    },
    beforeActivate: async () => {
      if (attachedBackend !== undefined && (host === undefined || !host.ownsHost)) throw new Error('stop the existing Aeven Host before updating the desktop backend')
      const active = host
      host = undefined
      await active?.stop()
    },
    afterActivate: async () => {
      host = await startHost()
    },
    progress: (step) => {
      // Every step runs before the swap, so a home without an active profile is a first install, not an update.
      const lines: Record<DesktopReleaseStep, string> = existsSync(paths.profile)
        ? { unpacking: messages.updateUnpacking, installing: messages.updateInstalling, checking: messages.updateChecking }
        : { unpacking: messages.setupUnpacking, installing: messages.setupInstalling, checking: messages.setupChecking }
      showStartStatus(lines[step])
    },
  }

  if (development === undefined && plan.kind === 'spawn') {
    const firstMacInstallation = process.platform === 'darwin' && !existsSync(paths.profile)
    await manager.applyRelease(resources.seed, app.getVersion(), {
      ...hooks,
      // A fresh Mac profile has no previous installation to protect. Its serving Host validates the final path
      // inside activation, so a failed boot still rejects the transaction without a separate staged Host boot.
      healthCheck: async (projectDir) => {
        if (!firstMacInstallation) await hooks.healthCheck(projectDir)
      },
      beforeActivate: async () => {},
      afterActivate: async () => {
        if (firstMacInstallation) await hooks.afterActivate()
      },
    })
  }
  // Decide the backend before starting one. A live Host that answers on its
  // advertised URL already owns this home, and two Hosts on one home overwrite
  // each other's domain state, so adopting it is both correct and cheaper.
  if (plan.kind === 'attach') {
    await holdAttachedHost()
    attachedBackend = { url: plan.url, origin: new URL(plan.url).origin }
    console.log(`desktop: adopting the Host already serving this home at ${attachedBackend.origin}`)
    // No Host of ours reports the provider URLs, and without them the window's
    // navigation guard drops every provider sign-in the page starts.
    aevenSignIn = await adoptedHostSignIn(plan.url).catch((error: unknown) => {
      console.error('avn desktop: could not read sign-in endpoints from the adopted Host; provider sign-in is unavailable', error)
      return undefined
    })
    keepAevenSession()
  } else if (host === undefined) {
    console.log(`desktop: starting a Host of its own because ${plan.reason}`)
    host = await startHost()
  }

  // The window is already painted, so this wait costs no paint. Failing to
  // clear caches is not a reason to refuse the launch.
  await clearStaleUpdateResidue().catch((error: unknown) => {
    console.warn('avn desktop: could not clear update residue', error)
  })
  /** Release Squirrel holds staged; a later periodic check finds the same release again. */
  let stagedVersion: string | undefined
  /**
   * Ready a downloaded release for its restart. On macOS Squirrel stages the
   * bundle, and the shell installs that bundle's profile with its own runtime,
   * so the first launch of the release adopts the profile instead of installing
   * it behind the start screen. A profile that cannot be prepared leaves that
   * launch to install it; a bundle Squirrel cannot stage fails the update.
   * @param version - the downloaded release.
   */
  const prepareDownloadedRelease = async (version: string): Promise<void> => {
    if (process.platform !== 'darwin' || !app.isPackaged) return
    if (stagedVersion !== version) {
      await stageNativeUpdate()
      stagedVersion = version
    }
    const shipItDir = shipItCacheDir(process.resourcesPath, updateCacheRoot(process.platform, process.env))
    if (shipItDir === undefined || development !== undefined || plan.kind !== 'spawn') return
    try {
      const staged = await stagedReleaseResources(shipItDir, version)
      await manager.prepareRelease(staged.seed, version, { node: staged.node, pnpm: staged.pnpm })
    } catch (error) {
      console.warn(`avn desktop: could not prepare release ${version}; its first launch installs it`, error)
    }
  }
  const updates = new DesktopUpdateCoordinator(
    publishUpdate,
    async () => {
      shellInstallerOwnsQuit = true
      const active = host
      host = undefined
      await active?.stop()
      await releaseClientLease?.()
    },
    prepareDownloadedRelease,
  )

  const background = new DesktopBackgroundMode(join(app.getPath('userData'), 'background-mode.json'), messages, {
    open: () => { focusPrimaryWindow() },
    quit: () => { app.quit() },
  })
  background.onChange((enabled) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(DESKTOP_IPC.backgroundModeState, enabled)
  })
  ipcMain.handle(DESKTOP_IPC.backgroundModeGet, (event) => {
    assertDesktopSender(event, ['app'])
    return background.enabled
  })
  ipcMain.handle(DESKTOP_IPC.backgroundModeSet, async (event, enabled: unknown) => {
    assertDesktopSender(event, ['app'])
    if (typeof enabled !== 'boolean') throw new Error('avn desktop: background mode must be a boolean')
    await background.setEnabled(enabled)
  })

  sendVideoEmbedReferrer(session.defaultSession)

  // The app window may render an adopted Host's origin rather than this
  // shell's scheme, so the browser operations admit the window's own top frame
  // instead of a hostname.
  registerBrowserIpc(event => mainWindow !== undefined
    && event.sender === mainWindow.webContents
    && event.senderFrame === event.sender.mainFrame)
  registerContextMenuIpc(event => mainWindow !== undefined
    && event.sender === mainWindow.webContents
    && event.senderFrame === event.sender.mainFrame)
  // The app page says once that it takes the addresses its own content opens;
  // until then the shell hands them to the system browser, which is what a page
  // the client does not drive expects.
  ipcMain.on(DESKTOP_IPC.linksListen, (event) => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) return
    if (event.senderFrame !== event.sender.mainFrame) return
    listenForPageLinks(event.sender)
  })
  // The page says once that it shows update state; the shell then sends what it
  // last published and any surface the reader asked for while the page loaded.
  ipcMain.on(DESKTOP_IPC.updatesListen, (event) => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) return
    if (event.senderFrame !== event.sender.mainFrame) return
    updateListening = true
    event.sender.send(DESKTOP_IPC.updatesState, updateState)
    if (!updateSurfaceRequested) return
    updateSurfaceRequested = false
    showUpdateSurface()
  })
  ipcMain.handle(DESKTOP_IPC.updatesGet, (event) => {
    assertDesktopSender(event, ['app'])
    return updateState
  })
  // A check the reader asked for answers through the popup it opened, so the
  // popup is up while the check runs and follows it to the release it finds.
  ipcMain.handle(DESKTOP_IPC.updatesCheck, async (event) => {
    assertDesktopSender(event, ['app'])
    showUpdateSurface()
    return checkAndPrompt(true)
  })
  ipcMain.handle(DESKTOP_IPC.updatesInstall, async (event) => {
    assertDesktopSender(event, ['app'])
    // Installs and restarts; the page is gone before this settles.
    await updates.install()
  })

  /** Version already offered to the reader, so one release is offered once. */
  let promptedVersion: string | undefined

  /**
   * Check the release stream, then show the page's update popup when the reader
   * asked or a release is ready to install. The popup carries the state, the
   * download in progress and the restart question; an automatic check nobody
   * asked about stays silent until there is something to install.
   * @param manual - whether the reader asked through the application menu.
   * @returns the state the check reached.
   */
  const checkAndPrompt = async (manual: boolean): Promise<DesktopUpdateState> => {
    const state = await updates.check()
    if (desktopUpdatePrompt(state, { manual, promptedVersion }) === 'silent') return state
    if (state.phase === 'ready') promptedVersion = state.version
    showUpdateSurface()
    return state
  }

  startupFinished.resolve()

  // The backend is serving: replace the start screen in the window that already
  // exists, so a launch reads as one screen rather than a window appearing only
  // now. The client's own preloader takes over from here.
  const appWindow = mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : createMainWindow()
  await appWindow.loadURL(appEntryUrl())
  if (development !== undefined && process.env.AVN_DESKTOP_OPEN_DEVTOOLS !== '0') {
    appWindow.webContents.openDevTools({ mode: 'detach' })
  }
  // One check shortly after launch, then one per interval: a background-mode
  // application runs for days, and a release published meanwhile installs on
  // the next quit. The interval stays well inside GitHub's unauthenticated
  // request budget, which the whole machine shares.
  setTimeout(() => { void checkAndPrompt(false) }, UPDATE_CHECK_STARTUP_DELAY_MS).unref()
  setInterval(() => { void checkAndPrompt(false) }, UPDATE_CHECK_INTERVAL_MS).unref()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) focusPrimaryWindow()
  })
  app.on('window-all-closed', () => {
    // In background mode the shell stays in the menu bar and keeps its Host lease.
    if (background.enabled) {
      if (process.platform === 'darwin') app.dock?.hide()
      return
    }
    if (process.platform !== 'darwin') app.quit()
  })
  /**
   * Whether quitting may stop running work: true when nothing would stop with
   * the Host, or the user confirmed. Work keeps running when another process
   * holds a client lease, and an unanswered query asks nothing.
   */
  const confirmQuit = async (active: DesktopHostProcess): Promise<boolean> => {
    const activity = await active.activity()
    if (activity === undefined || activity.runningAgents === 0 || activity.clientLeases > 0) return true
    const window = mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined
    const options = {
      type: 'warning' as const,
      message: messages.quitWhileWorkingTitle,
      detail: messages.quitWhileWorkingDetail,
      buttons: [messages.quitAnyway, messages.cancel],
      defaultId: 1,
      cancelId: 1,
    }
    const result = window === undefined ? await dialog.showMessageBox(options) : await dialog.showMessageBox(window, options)
    return result.response === 0
  }
  let quitting: Promise<void> | undefined
  let quitConfirmed = false
  app.on('before-quit', (event) => {
    if (shellInstallerOwnsQuit || quitConfirmed) return
    if (host === undefined && releaseClientLease === undefined) return
    event.preventDefault()
    quitting ??= (async () => {
      const active = host
      if (active !== undefined && !await confirmQuit(active)) {
        // Closing the last window quits on Windows and Linux; a cancelled quit reopens it.
        focusPrimaryWindow()
        return
      }
      // The Host stops itself once no client lease remains.
      host = undefined
      active?.release()
      await releaseClientLease?.()
      quitConfirmed = true
      app.quit()
    })().finally(() => { quitting = undefined })
  })
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character)
}

/**
 * Show a failed start in a window instead of a dialog that quits: the application menu stays, so
 * View → Toggle Developer Tools opens on this window, and the error text, which carries the
 * backend's stderr, can be selected and copied. Closing the window quits with a failure status.
 * @param title - Localized failure heading.
 * @param explanation - Localized line telling the reader how to inspect and how to quit.
 * @param detail - Error stack or message.
 */
function showStartupFailure(title: string, explanation: string, detail: string): void {
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>:root{color-scheme:light dark}body{margin:0;padding:24px;font:14px/1.5 -apple-system,system-ui,sans-serif;background:Canvas;color:CanvasText}
h1{font-size:18px;margin:0 0 8px}p{margin:0 0 16px;opacity:.75}pre{margin:0;padding:12px;border-radius:8px;background:color-mix(in srgb,CanvasText 7%,Canvas);white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,Menlo,monospace;user-select:text}</style>
</head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(explanation)}</p><pre>${escapeHtml(detail)}</pre></body></html>`
  const window = new BrowserWindow({ width: 820, height: 560, title, webPreferences: { sandbox: true, contextIsolation: true } })
  window.on('closed', () => { app.exit(1) })
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
}

const ownsDesktopInstance = claimDesktopSingleInstance(app, () => { focusPrimaryWindow() })

if (ownsDesktopInstance) void app.whenReady().then(main).catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  const diagnosticFile = process.env.AVN_DESKTOP_DIAGNOSTIC_FILE
  if (diagnosticFile !== undefined) {
    await writeFile(diagnosticFile, `${error instanceof Error ? error.stack ?? message : message}\n`).catch(() => undefined)
  }
  const messages = resolveDesktopLocale(app.getLocale()).messages
  showStartupFailure(messages.startupFailed, messages.startupFailedDetail, error instanceof Error ? error.stack ?? message : message)
})
