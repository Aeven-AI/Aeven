import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { AVN_EXACT_BOM } from '../src/compatibility.ts'
import { createAvnHostAdapter } from '../src/avn-host-adapter.ts'

describe('AVN compatibility contracts', () => {
  it('keeps the published BOM identical to the executable exact-version gate', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      avn: { compatibility: { bom: Record<string, string> } }
    }
    expect(manifest.avn.compatibility.bom).toEqual(AVN_EXACT_BOM)
    // The gate, the matrix, and the manifest name the release they ship in.
    const workspace = JSON.parse(
      await readFile(new URL('../../../../package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    for (const [name, version] of Object.entries(manifest.avn.compatibility.bom)) {
      if (name.startsWith('@aeven/')) expect(version).toBe(workspace.version)
    }
    for (const version of Object.values(manifest.avn.compatibility.bom)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
    }
    const matrix = JSON.parse(await readFile(new URL('../compatibility/avn-bom.json', import.meta.url), 'utf8')) as {
      coreAbi: string
      verified: { packages: Record<string, string> }
      candidates: Array<{ status: string }>
    }
    expect(matrix.coreAbi).toBe('dsh-coding-oauth-core/v1')
    expect(matrix.verified.packages).toEqual(manifest.avn.compatibility.bom)
    expect(matrix.candidates.every(candidate => candidate.status === 'unverified')).toBe(true)
  })

  it('reports missing host APIs before participant activation', () => {
    const adapter = createAvnHostAdapter({} as Context)
    expect(adapter.participantId).toBe('coding-subscription-oauth')
    expect(adapter.diagnostics().map(item => item.id)).toContain('host.api.llm.registerAdapter')
    expect(() =>{  adapter.assertCompatible() }).toThrow(/incompatible AVN host API/)
  })

  it('reports a missing optional LLM registry as degraded while owner Web APIs remain usable', () => {
    const context = {
      effect() {},
      inject() {},
      get() {},
      logger() {},
    } as unknown as Context
    const unInjected = new Set<PropertyKey>(['webServer', 'settings', 'credentials', 'llm', 'ownerRequestPolicy'])
    const adapter = createAvnHostAdapter(
      new Proxy(context, {
        get(target, property, receiver) {
          if (unInjected.has(property)) {
            throw new Error(`cannot get property "${String(property)}" without inject`)
          }
          return Reflect.get(target, property, receiver) as unknown
        },
      }),
    )

    expect(adapter.compatibility().status).toBe('degraded')
    expect(() =>{  adapter.assertCompatible() }).toThrow(/host\.api\.llm\.registerAdapter/)
  })

  it('accepts the exact host surface used by the participant', () => {
    const context = {
      effect() {},
      inject() {},
      get() {},
      logger() {},
      llm: { registerAdapter() {} },
    } as unknown as Context
    const adapter = createAvnHostAdapter(context)
    expect(adapter.diagnostics()).toEqual([])
    expect(() =>{  adapter.assertCompatible() }).not.toThrow()
  })

  it('discovers a AVN-native owner request policy without coupling it to activation', () => {
    const policy = { authorize: vi.fn(), diagnostics: vi.fn(() => []) }
    const context = {
      effect() {},
      inject() {},
      get(name: string) {
        return name === 'ownerRequestPolicy' ? policy : undefined
      },
      logger() {},
      llm: { registerAdapter() {} },
    } as unknown as Context
    const adapter = createAvnHostAdapter(context)

    expect(adapter.ownerRequestPolicy()).toBe(policy)
    expect(adapter.compatibility().capabilities.ownerRequestPolicy).toEqual({
      state: 'available',
      contract: 'owner-request-policy-v1',
    })
  })

  it('reports a service that exists but does not implement its contract as an error', () => {
    const context = {
      effect() {},
      inject() {},
      get() {},
      logger() {},
      llm: { registerAdapter() {} },
      // Present, but with none of the methods `exact-route-v1` verifies.
      webServer: {},
    } as unknown as Context
    const adapter = createAvnHostAdapter(context)

    expect(adapter.compatibility().capabilities.webServer).toEqual({
      state: 'incompatible',
      contract: 'exact-route-v1',
      reason: 'service shape does not match the verified contract',
    })
    const diagnostics = adapter.compatibility().diagnostics
    expect(diagnostics).toContain('host.capability.webServer: webServer is incompatible')
    expect(adapter.compatibility().status).toBe('incompatible')
    // Capability drift is reported through `compatibility()`; activation is
    // gated only on the host API surface itself, which is intact here.
    expect(() =>{  adapter.assertCompatible() }).not.toThrow()
  })

  it('reports a healthy host once every verified contract is present', () => {
    const context = {
      effect() {},
      inject() {},
      get() {},
      logger() {},
      webServer: { register() {} },
      settings: { register() {} },
      credentials: { resolve() {} },
      llm: { registerAdapter() {} },
      ownerRequestPolicy: { authorize() {}, diagnostics() {} },
    } as unknown as Context
    const adapter = createAvnHostAdapter(context)
    const compatibility = adapter.compatibility()

    expect(adapter.diagnostics()).toEqual([])
    expect(compatibility.status).toBe('healthy')
    expect(compatibility.diagnostics).toEqual([])
    expect(compatibility.avnVersion).toMatch(/^\d+\.\d+\.\d+/u)
    expect(compatibility.uiOwner).toBe('standalone')
    expect(compatibility.accessMode).toBe('loopback')
    expect(() =>{  adapter.assertCompatible() }).not.toThrow()
  })

  it('resolves the participant scope from the root context it was handed', () => {
    const root = {
      effect() {},
      inject() {},
      get() {},
      logger() {},
      llm: { registerAdapter() {} },
    }
    const adapter = createAvnHostAdapter({ ...root, root } as unknown as Context)

    expect(adapter.scope()).toBe(root)
  })

  it('reports no owner request policy when the host service is absent or partial', () => {
    const bare = createAvnHostAdapter({
      effect() {},
      inject() {},
      get() {},
      logger() {},
      llm: { registerAdapter() {} },
    } as unknown as Context)
    expect(bare.ownerRequestPolicy()).toBeUndefined()

    const partial = createAvnHostAdapter({
      effect() {},
      inject() {},
      get() {},
      logger() {},
      llm: { registerAdapter() {} },
      // Declares an authorizer but no diagnostics surface, so it is not the
      // `owner-request-policy-v1` contract this participant verifies.
      ownerRequestPolicy: { authorize() {} },
    } as unknown as Context)
    expect(partial.ownerRequestPolicy()).toBeUndefined()
  })

  it('reports an unavailable AVN manifest as an unknown version', async () => {
    vi.resetModules()
    vi.doMock('node:module', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:module')>()
      return Object.assign({}, actual, {
        createRequire: () => () => {
          throw new Error('the installed AVN manifest is unreadable')
        },
      })
    })
    try {
      const { createAvnHostAdapter: create } = await import('../src/avn-host-adapter.ts')
      const adapter = create({
        effect() {},
        inject() {},
        get() {},
        logger() {},
        llm: { registerAdapter() {} },
      } as unknown as Context)

      expect(adapter.compatibility().avnVersion).toBeNull()
      expect(adapter.compatibility().status).toBe('degraded')
    } finally {
      vi.doUnmock('node:module')
      vi.resetModules()
    }
  })

  it('reports a manifest without a version string as an unknown version', async () => {
    vi.resetModules()
    vi.doMock('node:module', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:module')>()
      return Object.assign({}, actual, { createRequire: () => () => ({ version: 4 }) })
    })
    try {
      const { createAvnHostAdapter: create } = await import('../src/avn-host-adapter.ts')
      const adapter = create({
        effect() {},
        inject() {},
        get() {},
        logger() {},
        llm: { registerAdapter() {} },
      } as unknown as Context)

      expect(adapter.compatibility().avnVersion).toBeNull()
    } finally {
      vi.doUnmock('node:module')
      vi.resetModules()
    }
  })
})
