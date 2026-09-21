/**
 * Web boot kernel. It owns only the module system, Cordis loader, and a
 * framework-free boot page. The dynamic UI renderer receives the mount
 * point after every client entry activates.
 * @module @aeven/client-web/src/boot
 */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as auth from '@aeven/client-ui-auth-aeven'
import type {
  BootManifest, ClientModuleCreateOptions, ClientModuleSystem, AvnWindow,
} from '@aeven/client-modules/client'
import type {} from '@aeven/client-ui-renderer/client'
import { BootPage } from './boot-page.ts'
import { startStaticModules } from './seed.ts'
import { STATE_LABELS } from './loader-status.ts'
import { fontsReady } from './fonts.ts'
import { hidePreloader, showPreloader } from './preloader.ts'
import './base.css'

/** Module transport hook replaced by jsdom tests. */
export type BootSeams = Pick<ClientModuleCreateOptions, 'loadBundle'>

/** Browser boot entry consumed by `apps/web`. */
export class AppWebEntry {
  private readonly container: HTMLElement
  private readonly seams: BootSeams | undefined
  private readonly page: BootPage
  private ctx: Context | undefined
  private modules!: ClientModuleSystem
  private manifest!: BootManifest

  /**
   * Draw the boot page; {@link run} starts the loader.
   * @param container - Application mount point.
   * @param seams - Optional module transport replacement.
   */
  constructor(container: HTMLElement, seams?: BootSeams) {
    this.container = container
    this.seams = seams
    this.page = new BootPage(container)
  }

  /**
   * Load and activate every client entry, then hand the mount point to the
   * UI renderer. Plugin failures remain visible on the boot page.
   * @returns Resolves after application mount or failure rendering.
   */
  async run(): Promise<void> {
    const { table: staticModules, rendering: renderingReady } = startStaticModules()
    const facesReady = fontsReady()
    try {
      // Boot-readiness gate: whichever bootstrap applies the injection table
      // settles this deferred once every row has taken effect — the served
      // index resolves it in the rendered tail, so the await returns on the
      // next microtask; an asynchronous bootstrap resolves it after its last
      // row, or rejects it into the failure rendering below. An absent global
      // means no bootstrap owns the document and there is nothing to wait for.
      await (globalThis as { __AVN_BOOT_READY__?: { promise: Promise<void> } }).__AVN_BOOT_READY__?.promise
      const win = globalThis as AvnWindow
      const moduleLoader = win.__ModuleLoader__
      if (moduleLoader === undefined) {
        throw new Error('web boot: window.__ModuleLoader__ bootstrap facade is missing')
      }
      // A pre-injected transport (the worker preview page) owns bundle bytes;
      // its loadBundle is the default and explicit seams still win. The global
      // is `ClientTransportHooks`, owned by @aeven/client-connection;
      // this structural slice reads one optional member without adding a
      // package edge.
      const transport = (globalThis as {
        __AVN_TRANSPORT__?: { loadBundle?: ClientModuleCreateOptions['loadBundle'] }
      }).__AVN_TRANSPORT__
      // Authentication runs here, before the plugin graph, so no client entry
      // ever sees an unauthenticated context — a plugin cannot be asked to
      // check, because by the time it could, it would already be running. It
      // waits the reader out rather than abandoning the boot: a session
      // established on a screen boots this document, where a document load
      // would restart the whole kernel to arrive at the same place.
      // Returns once a session exists. The gate restores the cover itself the
      // moment a screen settles — before the session re-read and the boot that
      // follow it — so the wait is covered from the point the reader commits,
      // not from the end of another round trip.
      await this.gateOnAuthentication()

      const rendering = await renderingReady
      if ('error' in rendering) throw rendering.error
      staticModules['@aeven/client-ui-primitives'] = rendering.module
      // ClientModuleSystem snapshots staticModules into its seed Map. Create it
      // only after the eager rendering request has completed so every plugin
      // bundle sees the complete platform table during evaluation.
      this.modules = moduleLoader.create({
        boot: win.__AVN_BOOT__,
        staticModules,
        ...transport?.loadBundle === undefined ? {} : { loadBundle: transport.loadBundle },
        ...this.seams,
      })
      this.manifest = this.modules.manifest
      const prefetching = this.prefetchImmediateTier()
      const ctx = new Context()
      this.ctx = ctx
      await this.runPluginBoot(ctx, prefetching)
      await facesReady
      await this.mountApp(ctx)
      await this.awaitInitialShellData(ctx)
      hidePreloader()
    } catch (reason) {
      console.error(reason)
      // Cut the fade: the preloader is opaque and would otherwise cover the
      // failure report for its whole duration.
      hidePreloader(false)
      this.page.fail(reason instanceof Error ? reason.message : String(reason))
    }
  }

  /**
   * Present the authentication surface until a session exists, and the naming
   * step when the reader Aeven restored has no name yet.
   *
   * The screens and the session they restore belong to whichever authority the
   * deployment configured; a harness with none configured reports `disabled`
   * and boots as it always has. Each screen settles once the reader has left it,
   * and the gate re-reads the session rather than trusting that the reader is
   * done — a session without a name lands on the step rather than the
   * application.
   *
   * The cover is restored the moment a screen settles, which is the earliest
   * point at which the sign-in button has stopped meaning anything: everything
   * after it — the session re-read, the plugin graph, the first shell data —
   * then happens behind an opaque cover instead of in front of a reader.
   */
  private async gateOnAuthentication(): Promise<void> {
    for (;;) {
      const result = await auth.restoreSession()
      if (result.state === 'disabled') return
      if (result.state === 'authenticated') {
        // Before the graph boots: the connection builds its caller once, from
        // whatever the transport hook holds at that moment.
        auth.installAuthenticatedTransport()
        return
      }
      // A screen is the page now, so the boot's cover comes off it.
      hidePreloader()
      // Whatever was rendered into the mount point has to let go of it before
      // the next screen — or the application — renders there.
      this.page.dispose()
      if (result.state === 'unnamed') {
        // The name is what the account menu and every session that follows call
        // the reader by, and the API holds none for them yet: the step stands
        // between them and the application, as it does in the Aeven client.
        const step = auth.mountNameScreen(this.container, window.location.pathname)
        await step.authenticated
        step.unmount()
      } else {
        const pathname = window.location.pathname
        // An address that is not itself an authentication screen is remembered,
        // so signing in returns the reader to what they asked for.
        let screen = auth.mountAuthScreen(this.container, pathname)
        if (screen === undefined) {
          auth.requireSignIn(pathname)
          screen = auth.mountAuthScreen(this.container, window.location.pathname)
        }
        if (screen === undefined) throw new Error('web boot: no authentication screen owns the page')
        await screen.authenticated
        screen.unmount()
      }
      // The reader has committed, so the cover comes back here rather than after
      // the re-read — the button has stopped reading as progress, and the rest of
      // the boot is not something they can watch anyway.
      showPreloader()
    }
  }

  /** Dispose the client plugin tree and whichever page owns the mount point. */
  async dispose(): Promise<void> {
    const ctx = this.ctx
    this.ctx = undefined
    if (ctx !== undefined) await ctx.fiber.dispose()
    this.page.dispose()
  }

  /**
   * Hold the static preloader until the first sidebar lists and selected
   * conversation history have arrived. Compositions without `uiWorkspace`
   * reveal immediately after mount.
   * @param ctx - Boot context after plugin activation.
   */
  private async awaitInitialShellData(ctx: Context): Promise<void> {
    // Read structurally through a locally typed view of `get`: this package
    // declares no dependencies, so the providing plugin's Context declaration
    // is not in scope to key the lookup by name.
    const source = ctx as unknown as {
      get(name: 'uiWorkspace'): { whenInitialDataReady?: () => Promise<void> } | undefined
    }
    await source.get('uiWorkspace')?.whenInitialDataReady?.()
    await afterPaint()
  }


  /** Mount through a dependency fiber so replacing uiRenderer remounts the application. */
  private async mountApp(ctx: Context): Promise<void> {
    const mounted = ctx.inject(['uiRenderer'], (scope) => {
      scope.effect(() => scope.uiRenderer.mount(this.container), 'web boot: application mount')
    })
    await mounted
  }

  /** Prefetch stage-one bundles and their dynamic requests before concurrent plugin imports. */
  private async prefetchImmediateTier(): Promise<void> {
    await Promise.all(this.manifest.plugins
      .filter(row => row.immediately)
      .map(row => this.modules.prefetch(row.id).catch((_prefetchError: unknown) => {
        // Prefetch only starts transport early; the Loader import retries and reports this bundle failure.
      })))
  }

  /** Mount the Loader, create all graph entries, await quiescence, and audit activation. */
  private async runPluginBoot(ctx: Context, prefetching: Promise<void>): Promise<void> {
    await ctx.plugin(Loader)
    const loader = ctx.loader
    loader.internal = this.modules as never

    ctx.on('internal/status', (fiber) => {
      const entry = fiber.entry
      if (entry === undefined || entry.fiber === undefined) return
      this.page.setState(entry.options.name, STATE_LABELS[entry.fiber.state])
    })

    const rows = this.manifest.plugins.map(row => row.id)
    this.page.setTotal(rows.length)
    await prefetching
    await Promise.all(rows.map(async (name) => {
      this.page.setState(name, 'loading')
      const id = await loader.create({ name })
      if (loader.resolve(id).fiber === undefined) this.page.setState(name, 'failed')
    }))

    await loader.await()
    this.assertEntriesActive(ctx)
  }

  /** Reject entries that failed import/apply or still wait on missing services. */
  private assertEntriesActive(ctx: Context): void {
    const failures: string[] = []
    for (const entry of ctx.loader.entries()) {
      const name = entry.options.name
      if (entry.fiber === undefined) {
        failures.push(`${name}: import failed (see console for the import error)`)
        continue
      }
      const state = STATE_LABELS[entry.fiber.state]
      if (state === 'active') continue
      if (state === 'pending') {
        const missing = Object.keys(entry.fiber.inject).filter(service => ctx.get(service) === undefined)
        failures.push(`${name}: pending (waiting for service${missing.length === 1 ? '' : 's'}: ${missing.join(', ') || 'unknown'})`)
      } else {
        failures.push(`${name}: ${state}`)
      }
    }
    if (failures.length > 0) {
      throw new Error(`web boot: ${String(failures.length)} entr${failures.length === 1 ? 'y' : 'ies'} did not activate\n${failures.join('\n')}`)
    }
  }
}

/** Yield one macrotask so the mounted shell can commit the arrived data. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}
