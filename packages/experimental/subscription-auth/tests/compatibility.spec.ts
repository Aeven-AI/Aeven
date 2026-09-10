import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { DSH_EXACT_BOM } from '../src/compatibility.ts'
import { createDshHostAdapter } from '../src/dsh-host-adapter.ts'

describe('DSH compatibility contracts', () => {
  it('keeps the published BOM identical to the executable exact-version gate', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh: { compatibility: { bom: Record<string, string> } }
    }
    expect(manifest.dsh.compatibility.bom).toEqual(DSH_EXACT_BOM)
    for (const version of Object.values(manifest.dsh.compatibility.bom)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
    }
    const matrix = JSON.parse(await readFile(new URL('../compatibility/dsh-bom.json', import.meta.url), 'utf8')) as {
      coreAbi: string
      verified: { packages: Record<string, string> }
      candidates: Array<{ status: string }>
    }
    expect(matrix.coreAbi).toBe('dsh-coding-oauth-core/v1')
    expect(matrix.verified.packages).toEqual(manifest.dsh.compatibility.bom)
    expect(matrix.candidates.every(candidate => candidate.status === 'unverified')).toBe(true)
  })

  it('reports missing host APIs before participant activation', () => {
    const adapter = createDshHostAdapter({} as Context)
    expect(adapter.participantId).toBe('coding-subscription-oauth')
    expect(adapter.diagnostics().map(item => item.id)).toContain('host.api.llm.registerAdapter')
    expect(() =>{  adapter.assertCompatible() }).toThrow(/incompatible DSH host API/)
  })

  it('reports a missing optional LLM registry as degraded while owner Web APIs remain usable', () => {
    const context = {
      effect() {},
      inject() {},
      get() {},
      logger() {},
    } as unknown as Context
    const unInjected = new Set<PropertyKey>(['webServer', 'settings', 'credentials', 'llm', 'ownerRequestPolicy'])
    const adapter = createDshHostAdapter(
      new Proxy(context, {
        get(target, property, receiver) {
          if (unInjected.has(property)) {
            throw new Error(`cannot get property "${String(property)}" without inject`)
          }
          return Reflect.get(target, property, receiver)
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
    const adapter = createDshHostAdapter(context)
    expect(adapter.diagnostics()).toEqual([])
    expect(() =>{  adapter.assertCompatible() }).not.toThrow()
  })

  it('discovers a DSH-native owner request policy without coupling it to activation', () => {
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
    const adapter = createDshHostAdapter(context)

    expect(adapter.ownerRequestPolicy()).toBe(policy)
    expect(adapter.compatibility().capabilities.ownerRequestPolicy).toEqual({
      state: 'available',
      contract: 'owner-request-policy-v1',
    })
  })
})
