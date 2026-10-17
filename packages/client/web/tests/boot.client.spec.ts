// @vitest-environment jsdom
import type { Context } from '@deepseek-ai/cordis'
import * as modulesClient from '@aeven/client-modules/client'
import type {
  ClientBundleRegistration, ClientModuleCreateOptions, ClientModuleLoaderTarget, AvnWindow,
  WebBootEntry,
} from '@aeven/client-modules/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
// The trigger a refused RPC reaches, from the same module instance the kernel
// subscribes through at the `/client` entry.
import { leaveForSignIn } from '@aeven/client-ui-auth-aeven/src/client/auth/services/watch.ts'
import { AppWebEntry } from '../src/boot.ts'
import { PRELOADER_ELEMENT_ID } from '../src/preloader.ts'

const MODULES_ID = '@aeven/client-modules'
const PROVIDER_CLIENT_ID = 'provider/client'
const RUNTIME_CLIENT_ID = 'runtime/client'
const win = globalThis as AvnWindow
const transportGlobal = globalThis as {
  __AVN_TRANSPORT__?: { loadBundle(url: string): Promise<void> }
}
const moduleFace = modulesClient as unknown as Record<string, unknown>

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete win.__AVN_BOOT__
  delete win.__ModuleLoader__
  delete transportGlobal.__AVN_TRANSPORT__
  delete (globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__
  // The gate mounts the real session services, and what they store outlives a
  // test: a token kept here would sign the next test's reader in.
  window.localStorage.clear()
  document.body.innerHTML = ''
})

/** Install the stable facade shape that the Host injects before AppWebEntry runs. */
function installFacade(
  create?: (options: ClientModuleCreateOptions) => modulesClient.ClientModuleSystem,
): ClientModuleLoaderTarget {
  const pendingQueue: ClientBundleRegistration[] = []
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue,
    load: (registration) => { pendingQueue.push(registration) },
    create: create ?? (options => modulesClient.createClientModuleSystem(target, {
      id: MODULES_ID,
      exports: moduleFace,
    }, options)),
  }
  win.__ModuleLoader__ = target
  return target
}

async function expectBootFailure(setup: () => void, message: string): Promise<void> {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const container = document.createElement('div')
  document.body.append(container)
  setup()
  const entry = new AppWebEntry(container)
  await entry.run()
  expect(container.textContent).toContain(message)
  expect(error).toHaveBeenCalledOnce()
  await entry.dispose()
}

/**
 * Install a bootable page: the facade, a one-row graph whose plugin supplies a
 * `uiRenderer`, the static preloader the served index carries, and the entry
 * over them.
 * @param workspace - the shell-data service that row provides, when the case needs one.
 * @returns the mount point, the preloader element, the entry, and the boot it started.
 */
function installBootPage(workspace?: { whenInitialDataReady?: () => Promise<void> }): {
  container: HTMLElement
  preloader: HTMLElement
  entry: AppWebEntry
  booting: Promise<void>
} {
  const container = document.createElement('div')
  const preloader = document.createElement('div')
  preloader.id = PRELOADER_ELEMENT_ID
  document.body.append(preloader, container)
  const target = installFacade()
  win.__AVN_BOOT__ = {
    rev: 'graph',
    entries: [{ id: 'renderer', url: '/renderer.js', rev: '1' }],
    batches: [{
      phase: 'application',
      url: '/application.js',
      rev: 'batch',
      entries: ['renderer'],
    }],
  }
  const registrations = new Map<string, ClientBundleRegistration>([
    ['/renderer.js', {
      id: 'renderer',
      factory: () => ({
        apply: (ctx: Context) => {
          if (workspace !== undefined) ctx.reflect.provide('uiWorkspace', workspace)
          ctx.reflect.provide('uiRenderer', {
            mount: (element: HTMLElement) => {
              element.textContent = 'mounted'
              return () => { element.textContent = '' }
            },
          })
        },
      }),
    }],
  ])
  const entry = new AppWebEntry(container, {
    loadBundle: async (url) => {
      if (url !== '/application.js') throw new Error(`missing fixture batch ${url}`)
      for (const registration of registrations.values()) target.load(registration)
    },
  })
  return { container, preloader, entry, booting: entry.run() }
}

/** The grant the API signs a reader in with; only its payload is read. */
const GRANT = { userId: 'u-1', accessToken: 'header.eyJ1c2VySWQiOiJ1LTEiLCJleHAiOjk5OTk5OTk5OTl9.sig' }

/** The profile the API answers for a reader who signed in and then chose a name. */
const NAMED_PROFILE = { userId: 'u-1', displayName: 'Ollie', displayNameSet: true }

/** Configure the Aeven authority and stub `fetch` with a route-answering function. */
function installAevenApi(answer: (route: string) => Promise<Response>): void {
  ;(globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__ = { apiUrl: 'http://api.test' }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.href : input
    return answer(new URL(url as string).pathname)
  }))
}

describe('the boot gate waits the reader out', () => {
  it('boots the application in the same document once the reader signs in', async () => {
    // Nobody has a session until the reader's own request succeeds, which is
    // what the gate's next read of the profile reports.
    let signedIn = false
    installAevenApi(async (route) => {
      if (!signedIn) return new Response(null, { status: 401 })
      return route === '/refresh-token' ? Response.json(GRANT) : Response.json(NAMED_PROFILE)
    })
    const { container, preloader, entry, booting } = installBootPage()

    // The gate stops on the sign-in screen, and the application is not behind it.
    await vi.waitFor(() => { expect(container.querySelector('.authenticate')).not.toBeNull() })
    expect(container.textContent).not.toContain('mounted')

    // What the screen's success path does once the API answers: move to the
    // application's own address, which raises the event the gate waits for. The
    // handlers above that call are the ported view's own and stay as they are.
    signedIn = true
    window.history.pushState(null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await booting

    expect(container.textContent).toContain('mounted')
    // The cover came back for the boot and is dismissed over the mounted shell,
    // rather than being repainted by a document load.
    expect(preloader.classList.contains('animate') || preloader.classList.contains('hide')).toBe(true)
    await entry.dispose()
  })

  it('hands the page back to the sign-in screen when the session ends after the boot', async () => {
    // The reader is signed in, so the first pass boots the application.
    let signedIn = true
    installAevenApi(async (route) => {
      if (!signedIn) return new Response(null, { status: 401 })
      return route === '/refresh-token' ? Response.json(GRANT) : Response.json(NAMED_PROFILE)
    })
    const { container, entry, booting } = installBootPage()
    await booting
    expect(container.textContent).toContain('mounted')

    // A page of their own, which is where signing in again should return them.
    window.history.pushState(null, '', '/session/abc')
    signedIn = false
    leaveForSignIn()

    // The kernel hears it: the tree is disposed, the gate runs again in the same
    // container, and the reader is back at the sign-in screen — no document load.
    await vi.waitFor(() => { expect(container.querySelector('.authenticate')).not.toBeNull() })
    expect(container.textContent).not.toContain('mounted')
    expect(window.location.pathname).toBe('/sign-in')
    expect(window.localStorage.getItem('authReferrer')).toBe('/session/abc')
    await entry.dispose()
  })

  it('holds the naming step over an unnamed reader, then boots behind them', async () => {
    let named = false
    installAevenApi(async (route) => {
      if (route === '/refresh-token') return Response.json(GRANT)
      if (route === '/set-display-name') {
        named = true
        return Response.json({ result: 'display-name-set', displayName: 'Ollie', displayNameSet: true })
      }
      // The screen offers the second factor only to an account without one, and
      // that offer is a step of its own; this account already has it, so storing
      // the name is what boots the application.
      if (route === '/mfa/status') return Response.json({ enabled: true })
      // A fresh account reports the id the API derived a name from and no chosen
      // name of its own; the step is what gives it one.
      return named ? Response.json(NAMED_PROFILE) : Response.json({ userId: 'u-1', displayName: 'u-1' })
    })
    const { container, entry, booting } = installBootPage()

    await vi.waitFor(() => { expect(container.querySelector('.init-check')).not.toBeNull() })
    expect(container.textContent).toContain('Hi there!')
    // Nothing from the application is behind it: the step is the page.
    expect(container.textContent).not.toContain('mounted')

    // The reader types a name and presses Continue. `Input` holds the field's
    // value in React state, and React tracks each node it renders: the value is
    // set through the prototype setter, which the tracker cannot see, and then
    // announced with the `input` event the screen listens for. A plain
    // assignment would be a tracked write, and the screen would read no change.
    const field = container.querySelector('input')
    if (field === null) throw new Error('the naming step rendered no field')
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.bind(field)
    if (setValue === undefined) throw new Error('the field has no value setter')
    setValue('Ollie')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    container.querySelector('button')?.click()
    await booting

    expect(container.textContent).toContain('mounted')
    await entry.dispose()
  })
})

describe('bootstrap failure rendering', () => {
  it('renders a missing bootstrap facade', async () => {
    await expectBootFailure(
      () => { delete win.__ModuleLoader__ },
      'window.__ModuleLoader__ bootstrap facade is missing',
    )
  })

  it('renders a create failure owned by the facade', async () => {
    await expectBootFailure(() => {
      installFacade(() => { throw new Error('facade create failed') })
    }, 'facade create failed')
  })

  it('renders a malformed boot manifest', async () => {
    await expectBootFailure(() => {
      installFacade()
      delete win.__AVN_BOOT__
    }, 'window.__AVN_BOOT__ is missing or not an object')
  })

  it('renders a module-system construction failure', async () => {
    await expectBootFailure(() => {
      installFacade()
      const duplicate = { id: 'duplicate', url: '/duplicate/client.js', rev: '1' }
      win.__AVN_BOOT__ = {
        rev: 'graph',
        entries: [duplicate, duplicate],
        batches: [{ phase: 'application', url: '/batch.js', rev: 'batch', entries: ['duplicate'] }],
      }
    }, 'duplicate graph entry "duplicate"')
  })
})

describe('plugin activation', () => {
  it('prefetches a parser-loaded immediate row through the injected bundle transport', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const target = installFacade((options) => {
      expect(options.staticModules['@aeven/client-ui-primitives']).toBeDefined()
      return modulesClient.createClientModuleSystem(target, {
        id: MODULES_ID,
        exports: moduleFace,
      }, options)
    })
    const entries: WebBootEntry[] = [
      { id: 'consumer', url: '/consumer.js', rev: '1' },
      {
        id: 'runtime',
        url: '/runtime.js',
        rev: '1',
        external: [PROVIDER_CLIENT_ID],
        immediately: true,
      },
      { id: 'provider', url: '/provider.js', rev: '1' },
      { id: 'renderer', url: '/renderer.js', rev: '1' },
    ]
    const applicationUrl = '/application.js'
    win.__AVN_BOOT__ = {
      rev: 'graph',
      entries,
      batches: [{ phase: 'application', url: applicationUrl, rev: 'batch', entries: entries.map(row => row.id) }],
    }
    const loaded: string[] = []
    const registrations: ClientBundleRegistration[] = [
      {
        id: 'consumer',
        factory: require => ({
          apply: () => {
            expect((require(RUNTIME_CLIENT_ID) as { marker: string }).marker).toBe('provider')
          },
        }),
      },
      {
        id: 'provider',
        factory: () => ({ apply: () => {}, marker: 'provider' }),
      },
      {
        id: 'runtime',
        factory: require => ({
          apply: () => {},
          marker: (require(PROVIDER_CLIENT_ID) as { marker: string }).marker,
        }),
      },
      {
        id: 'renderer',
        factory: () => ({
          apply: (ctx: Context) => {
            ctx.reflect.provide('uiRenderer', { mount: () => () => {} })
          },
        }),
      },
    ]
    transportGlobal.__AVN_TRANSPORT__ = {
      loadBundle: async (url) => {
        loaded.push(url)
        if (url !== applicationUrl) throw new Error(`missing fixture batch ${url}`)
        for (const registration of registrations) target.load(registration)
      },
    }

    const entry = new AppWebEntry(container)
    await entry.run()

    expect(loaded).toEqual([applicationUrl])
    await entry.dispose()
  })

  it('allows a modules-dependent row to be created before the modules row', async () => {
    const events: string[] = []
    const container = document.createElement('div')
    document.body.append(container)
    const target = installFacade()
    const entries: WebBootEntry[] = [
      { id: 'consumer', url: '/consumer.js', rev: '1' },
      { id: MODULES_ID, url: '/modules.js', rev: '1' },
      { id: 'renderer', url: '/renderer.js', rev: '1' },
    ]
    win.__AVN_BOOT__ = {
      rev: 'graph',
      entries,
      batches: [{
        phase: 'application',
        url: '/application.js',
        rev: 'batch',
        entries: entries.map(row => row.id),
      }],
    }
    const registrations = new Map<string, ClientBundleRegistration>([
      ['/consumer.js', {
        id: 'consumer',
        factory: () => ({
          inject: ['modules'],
          apply: (ctx: Context) => {
            expect(ctx.modules).toBeDefined()
            events.push('consumer')
          },
        }),
      }],
      ['/renderer.js', {
        id: 'renderer',
        factory: () => ({
          apply: (ctx: Context) => {
            ctx.reflect.provide('uiRenderer', {
              mount: (element: HTMLElement) => {
                events.push('mount')
                element.textContent = 'mounted'
                return () => {}
              },
            })
          },
        }),
      }],
    ])
    const entry = new AppWebEntry(container, {
      loadBundle: async (url) => {
        if (url !== '/application.js') throw new Error(`missing fixture batch ${url}`)
        for (const registration of registrations.values()) target.load(registration)
      },
    })

    await entry.run()

    expect(target.mode).toBe('live')
    expect(events).toEqual(['consumer', 'mount'])
    expect(container.textContent).toBe('mounted')
    await entry.dispose()
  })
})

describe('preloader reveal after mount', () => {
  it('holds the static preloader until initial shell data is ready', async () => {
    const gate = Promise.withResolvers<undefined>()
    const { entry, preloader, booting } = installBootPage({
      whenInitialDataReady: () => gate.promise,
    })
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('mounted')
    })
    expect(preloader.classList.contains('hide')).toBe(false)
    expect(preloader.classList.contains('screen-hidden')).toBe(false)
    gate.resolve(undefined)
    await booting
    expect(preloader.classList.contains('animate') || preloader.classList.contains('hide')).toBe(true)
    await entry.dispose()
  })

  it('reveals immediately when uiWorkspace does not wait', async () => {
    const { entry, preloader, booting } = installBootPage()
    await booting
    expect(preloader.classList.contains('animate') || preloader.classList.contains('hide')).toBe(true)
    await entry.dispose()
  })
})
