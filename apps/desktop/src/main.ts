/** Electron shell: desktop project ownership, custom protocol, windows, and lifecycle. */

import { existsSync } from 'node:fs'
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
  protocol,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import { DESKTOP_MENU_ZOOM_STEP, FULL_SCREEN_ITEM_ID, applicationMenuTemplate, type DesktopMenuZoom } from './application-menu.ts'
import { adoptedHostSignIn, completeOAuthLanding, forwardAevenApiRequest } from './aeven-sign-in.ts'
import { startBrowserSignIn } from './oauth-browser.ts'
import { installContextMenu, registerContextMenuIpc } from './context-menu.ts'
import { listenForPageLinks, openContentAddress } from './external-links.ts'
import { hardenBrowserGuests, registerBrowserIpc } from './browser-guests.ts'
import { acquireHostClientLease, resolveAvnHome } from '@aeven/home-paths'
import { planDesktopBackend } from './attached-host.ts'
import { resolveDesktopPaths } from './paths.ts'
import { DesktopProjectManager, type DesktopProjectHooks } from './project-manager.ts'
import { DesktopHostProcess } from './host-process.ts'
import { DESKTOP_AEVEN_API_PATH, type DesktopAevenSignIn } from './host-protocol.ts'
import { DESKTOP_IPC, type DesktopCaptionAction, type DesktopMenuCommand, type DesktopUpdateState } from './ipc.ts'
import { formatDesktopMessage, resolveDesktopLocale } from './locale.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { DesktopUpdateCoordinator } from './update-coordinator.ts'
import { DesktopBackgroundMode } from './background-mode.ts'
import { loginShellPath, mergePath } from './login-shell-path.ts'
import { sendVideoEmbedReferrer } from './video-embeds.ts'

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
 * Height of the Windows and Linux caption strip: Windows 11's own caption
 * height. The preload moves the page below it (`CAPTION_STRIP_HEIGHT` there).
 */
const CAPTION_BUTTONS_HEIGHT = 32

/** Caption glyph colours, matching the page's primary label in each scheme. */
const CAPTION_SYMBOL_COLOR = { light: '#0f1115', dark: '#f9fafb' } as const

/**
 * Windows and Linux lay the page below a page-drawn strip (`installCaptionStrip`
 * in the preload). Windows draws its own caption buttons over it; Linux has the
 * preload draw them, since GTK would paint its theme's buttons.
 */
const CAPTION_STRIP_PLATFORM = process.platform === 'win32' || process.platform === 'linux'

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
  let mainWindow: BrowserWindow | undefined
  let shellInstallerOwnsQuit = false
  let updateState: DesktopUpdateState = { phase: 'idle' }
  const locale = resolveDesktopLocale(app.getLocale())
  const messages = locale.messages
  // Every page gets the right-click menu, including the sidebar browser's guests.
  app.on('web-contents-created', (_event, contents) => { installContextMenu(contents, messages) })
  const appPreload = fileURLToPath(new URL('./preload-app.cjs', import.meta.url))

  const publishUpdate = (state: DesktopUpdateState): DesktopUpdateState => {
    updateState = state
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DESKTOP_IPC.updatesState, state)
    }
    return state
  }

  const startupFinished = Promise.withResolvers<void>()

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
  const openSettings = (): void => { sendMenuCommand(OPEN_SETTINGS_COMMAND) }
  const startDictation = (): void => { sendMenuCommand(START_DICTATION_COMMAND) }

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
        // The update installer must not quit the shell while startup installs or starts the backend.
        checkForUpdates: () => { void startupFinished.promise.then(() => checkAndPrompt(true)) },
        openSettings,
        startDictation,
        fullScreen: { label: fullScreenLabel(), click: toggleFullScreen },
        zoom: zoomApplicationWindow,
      },
    })))
  }
  installApplicationMenu()

  // A packaged shell replaces a desktop Host from another release; a
  // development shell adopts whatever serves the home.
  // The Host and every process it starts inherit this PATH; a GUI launch alone carries the session's minimal one.
  const loginPath = await loginShellPath(process.env)
  if (loginPath === undefined) console.warn('desktop: the login shell did not report a PATH; the Host keeps the inherited one')
  else process.env.PATH = mergePath(loginPath, process.env.PATH, delimiter)
  // Last, so an installed Node.js still wins: on a machine without one, the bundled `node`, `npm`, and `npx` resolve.
  process.env.PATH = mergePath(process.env.PATH ?? '', dirname(resources.node), delimiter)
  const plan = await planDesktopBackend(development === undefined ? { avnVersion: app.getVersion() } : {})
  if (development === undefined && plan.kind === 'spawn') manager.recover()

  const startHost = async (projectDir = activeProject): Promise<DesktopHostProcess> => {
    const next = new DesktopHostProcess(resources.node, projectDir, hostInspectPort)
    const ready = await next.start()
    if (!ready.ownsHost && projectDir !== activeProject) {
      next.release()
      throw new Error('stop the existing Aeven Host before validating a desktop update')
    }
    if (!ready.ownsHost) await holdAttachedHost()
    if (projectDir === activeProject) {
      aevenSignIn = ready.aevenSignIn ?? await adoptedHostSignIn(ready.url)
      attachedBackend = { url: ready.url, origin: new URL(ready.url).origin }
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
  }

  if (development === undefined && plan.kind === 'spawn') {
    await manager.applyRelease(resources.seed, app.getVersion(), {
      ...hooks,
      beforeActivate: async () => {},
      afterActivate: async () => {},
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
  } else {
    console.log(`desktop: starting a Host of its own because ${plan.reason}`)
    host = await startHost()
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

  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'shell') return serveShellAsset(request)
    if (url.hostname !== 'app') return Promise.resolve(new Response(null, { status: 404 }))
    if (url.pathname.startsWith(`${DESKTOP_AEVEN_API_PATH}/`)) return forwardAevenApiRequest(request, aevenSignIn)
    const active = host
    if (active === undefined) return Promise.resolve(new Response('backend unavailable', { status: 503 }))
    return active.fetch(request)
  })

  ipcMain.handle(DESKTOP_IPC.updatesCheck, async (event) => {
    assertDesktopSender(event, ['shell'])
    return updates.check()
  })
  ipcMain.handle(DESKTOP_IPC.updatesInstall, async (event) => {
    assertDesktopSender(event, ['shell'])
    await updates.install()
  })
  // The app window may render an adopted Host's origin rather than this
  // shell's scheme, so the browser operations admit the window's own top frame
  // instead of a hostname.
  registerBrowserIpc(event => mainWindow !== undefined
    && event.sender === mainWindow.webContents
    && event.senderFrame === event.sender.mainFrame)
  registerContextMenuIpc(event => mainWindow !== undefined
    && event.sender === mainWindow.webContents
    && event.senderFrame === event.sender.mainFrame)
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
  // The app page says once that it takes the addresses its own content opens;
  // until then the shell hands them to the system browser, which is what a page
  // the client does not drive expects.
  ipcMain.on(DESKTOP_IPC.linksListen, (event) => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) return
    if (event.senderFrame !== event.sender.mainFrame) return
    listenForPageLinks(event.sender)
  })

  const checkAndPrompt = async (manual: boolean): Promise<void> => {
    const state = await updates.check()
    if (state.phase === 'error') {
      if (manual) {
        await dialog.showMessageBox({
          type: 'error',
          title: messages.updateCheckFailedTitle,
          message: state.message ?? messages.unknownError,
        })
      }
      return
    }
    if (state.phase !== 'available') {
      if (manual) {
        await dialog.showMessageBox({
          type: 'info',
          title: messages.updateCheckTitle,
          message: state.message ?? messages.updateCurrent,
        })
      }
      return
    }
    const result = await dialog.showMessageBox({
      type: 'info',
      title: messages.updateTitle,
      message: messages.updateAvailable,
      detail: formatDesktopMessage(messages.updateDetail, { version: state.version ?? '' }),
      buttons: [messages.installAndRestart, messages.later],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response !== 0) return
    const installed = await updates.install()
    if (installed.phase === 'error') {
      await dialog.showMessageBox({
        type: 'error',
        title: messages.updateFailedTitle,
        message: installed.message ?? messages.unknownError,
      })
    }
  }

  startupFinished.resolve()

  /**
   * Sign in with a provider in the default browser, then bring the app back.
   * Providers refuse embedded windows, so none is opened here.
   */
  const beginProviderSignIn = (window: BrowserWindow, url: string, land: (path: string) => void): void => {
    void startBrowserSignIn({
      providerUrl: url,
      labels: { continuing: messages.signInContinuing, signedIn: messages.signInDone, failed: messages.signInFailed },
      openExternal: target => shell.openExternal(target),
      land: (path) => {
        land(path)
        if (window.isDestroyed()) return
        if (window.isMinimized()) window.restore()
        window.focus()
        app.focus({ steal: true })
      },
    }).catch((error: unknown) => { console.error('avn desktop: provider sign-in could not start', error) })
  }

  const createMainWindow = (): BrowserWindow => {
    const window = createWindow(appPreload)
    mainWindow = window
    claimsAppAddress = url => aevenSignIn?.oauthUrls.includes(url) === true
    // Either way the page reaches a provider, the provider opens in the default
    // browser and every other window stays denied. A page whose flow is a window
    // waits for the session this shell exchanges; a page whose flow is a redirect
    // gets the landing it expects loaded back into the window it came from.
    // Every other address the page asks a window for is content the reader
    // chose: the page opens it itself when it listens for addresses, and the
    // system browser opens it otherwise.
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (aevenSignIn?.oauthUrls.includes(url) === true) {
        beginProviderSignIn(window, url, (path) => { void completeOAuthLanding(path, aevenSignIn) })
      } else {
        openContentAddress(window.webContents, url)
      }
      return { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event, url) => {
      if (aevenSignIn?.oauthUrls.includes(url) !== true) return
      event.preventDefault()
      beginProviderSignIn(window, url, (path) => { void window.loadURL(appPathUrl(path)) })
    })
    window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
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

  mainWindow = createMainWindow()
  await mainWindow.loadURL(appEntryUrl())
  if (development !== undefined && process.env.AVN_DESKTOP_OPEN_DEVTOOLS !== '0') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
  publishUpdate(updateState)
  setTimeout(() => { void checkAndPrompt(false) }, 10_000)

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
