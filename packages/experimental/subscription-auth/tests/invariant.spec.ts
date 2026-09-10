import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/invariant.ts'

describe('invariant companion', () => {
  it('registers the package under its published name and hands back the host disposer', async () => {
    const registered: Array<readonly [string, () => void]> = []
    const dispose = () => {}
    const ctx = {
      invariants: {
        register(packageName: string, installer: () => void) {
          registered.push([packageName, installer])
          return dispose
        },
      },
    } as unknown as Context

    await expect(apply(ctx)).resolves.toBe(dispose)
    expect(registered).toHaveLength(1)
    expect(registered[0]?.[0]).toBe('@deepseek-ai/dsh-experimental-subscription-auth')
  })

  it('installs no invariants of its own', async () => {
    let installer: (() => void) | undefined
    const ctx = {
      invariants: {
        register(_packageName: string, install: () => void) {
          installer = install
          return () => {}
        },
      },
    } as unknown as Context

    await apply(ctx)
    // The companion exists so the host can attribute invariants to this
    // package; the installer itself must stay a no-op.
    expect(installer?.()).toBeUndefined()
  })

  it('declares the cordis plugin contract', () => {
    expect(name).toBe('grok-build-invariant')
    expect(inject).toStrictEqual(['invariants'])
  })
})
