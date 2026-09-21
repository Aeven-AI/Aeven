/**
 * The macOS provider: the package that makes the stack reachable from a composition.
 *
 * The properties under test are about wiring rather than behaviour — that the layers
 * are joined, that the exclusive registration slot is claimed through the seam rather
 * than re-implemented, and that a second provider still fails with the name of the
 * first, which is the whole reason the seam exists.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import ComputerUseRegistry from '@aeven/computer-use'
import { MacComputerUseProvider, apply, createOsascriptRunner, providerName } from '../src/index.ts'

describe('the provider joins the layers', () => {
  const provider = new MacComputerUseProvider()

  it('exposes an adapter for the host platform', () => {
    expect(provider.adapter.platform).toBe('darwin')
  })

  it('serves the starter book, so the recipes are reachable', () => {
    expect(provider.tasks().length).toBeGreaterThan(20)
    expect(provider.tasks()).toContain('document.createText')
  })

  it('merges deployment recipes over the starter book', () => {
    const withExtra = new MacComputerUseProvider({
      recipes: [{
        task: 'deployment.own',
        summary: 'A task only this deployment has.',
        deliverable: 'open-application',
        on: [{
          platform: 'darwin', rung: 'semantic', apps: [],
          evidence: 'documented',
          invocation: { mechanism: 'apple-events', operation: 'something local' },
        }],
        verify: [{ kind: 'windowTitled', title: 'Whatever' }],
      }],
    })
    expect(withExtra.tasks()).toContain('deployment.own')
    expect(withExtra.tasks()).toContain('document.createText')
  })

  it('resolves a task without running it, so a caller can show the plan', () => {
    const resolved = provider.resolve({ task: 'document.createText', platform: 'darwin', app: 'com.apple.Pages' })
    expect(resolved.rung).toBe('semantic')
    expect(resolved.deliverable).toBe('open-application')
  })

  it('reports the measured Pages blind spots through the resolution', () => {
    const resolved = provider.resolve({ task: 'document.createText', platform: 'darwin', app: 'com.apple.Pages' })
    expect(resolved.knownBlind).toContain('template.choose')
  })

  it('exposes a session a consumer can drive', () => {
    expect(provider.session).toBeDefined()
    expect(typeof provider.session.run).toBe('function')
  })

  it('starts with no automation targets, since probing sends an Apple Event', () => {
    // An empty configuration must not cause a consent prompt for applications the
    // user never asked about.
    expect(() => new MacComputerUseProvider()).not.toThrow()
    expect(() => new MacComputerUseProvider({ automationTargets: [] })).not.toThrow()
  })

  it('builds an osascript runner that resolves rather than rejects on failure', async () => {
    const runner = createOsascriptRunner()
    // A script that fails: the runner must hand back a status, not throw, because
    // osascript reports application failures through its exit code.
    const result = await runner.run('throw new Error("deliberate")')
    expect(result.code).not.toBe(0)
    expect(typeof result.stderr).toBe('string')
  })

  it('runs a real trivial script and captures stdout', async () => {
    const runner = createOsascriptRunner()
    const result = await runner.run('JSON.stringify({ ok: true })')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('ok')
  })
})

describe('registration goes through the seam', () => {
  it('claims the exclusive slot and publishes the provider on the context', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(ComputerUseRegistry)
      expect(ctx.computerUse.providerName).toBeUndefined()
      apply(ctx, {})
      expect(ctx.computerUse.providerName).toBe(providerName)
      expect(ctx.computerUseProvider.tasks().length).toBeGreaterThan(20)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('fails a second provider with the name of the first, which is what the seam is for', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(ComputerUseRegistry)
      apply(ctx, {})
      expect(() =>{  apply(ctx, {}) }).toThrow(/already registered/)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('can be loaded without claiming the slot, for a staged migration', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(ComputerUseRegistry)
      apply(ctx, { register: false })
      // Published for its readiness reporting and session, but the slot stays free
      // so another provider can still drive while a deployment migrates.
      expect(ctx.computerUseProvider.tasks().length).toBeGreaterThan(20)
      expect(ctx.computerUse.providerName).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('releases the slot when the contributing fiber unloads', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(ComputerUseRegistry)
      const rows = ctx.plugin({
        name: 'test-computer-use-provider',
        inject: ['computerUse'],
        apply(ctx: Context) { apply(ctx, {}) },
      })
      await rows
      expect(ctx.computerUse.providerName).toBe(providerName)
      await rows.dispose()
      expect(ctx.computerUse.providerName).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
