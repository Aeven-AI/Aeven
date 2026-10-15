/**
 * The Windows provider: the package that makes the stack reachable from a composition.
 *
 * The properties under test are about wiring rather than behaviour — that the layers
 * are joined, that the exclusive registration slot is claimed through the seam rather
 * than re-implemented, and that a second provider still fails with the name of the
 * first, which is the whole reason the seam exists.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import ComputerUseRegistry from '@aeven/computer-use'
import { COM_MECHANISM } from '@aeven/computer-use-windows-com'
import { WindowsComputerUseProvider, apply, providerName } from '../src/index.ts'

describe('the provider joins the layers', () => {
  const provider = new WindowsComputerUseProvider()

  it('exposes an adapter for the host platform', () => {
    expect(provider.adapter.platform).toBe('win32')
  })

  it('serves the starter book, so the recipes are reachable', () => {
    expect(provider.tasks().length).toBeGreaterThan(20)
    expect(provider.tasks()).toContain('spreadsheet.setCell')
  })

  it('merges deployment recipes over the starter book', () => {
    const withExtra = new WindowsComputerUseProvider({
      recipes: [{
        task: 'deployment.own',
        summary: 'A task only this deployment has.',
        deliverable: 'open-application',
        on: [{
          platform: 'win32', rung: 'semantic', apps: [],
          evidence: 'documented',
          invocation: { mechanism: COM_MECHANISM, operation: 'something local' },
        }],
        verify: [{ kind: 'windowTitled', title: 'Whatever' }],
      }],
    })
    expect(withExtra.tasks()).toContain('deployment.own')
    expect(withExtra.tasks()).toContain('spreadsheet.setCell')
  })

  it('resolves a task without running it, so a caller can show the plan', () => {
    const resolved = provider.resolve({ task: 'spreadsheet.setCell', platform: 'win32', app: 'Excel.Application' })
    expect(resolved.rung).toBe('semantic')
    expect(resolved.invocation.mechanism).toBe(COM_MECHANISM)
    expect(resolved.deliverable).toBe('open-application')
  })

  it('carries the book evidence tag through the resolution rather than upgrading it', () => {
    // The Office recipes are documented, not verified: nothing here has driven a live
    // Excel, and the resolution has to say so.
    expect(provider.resolve({ task: 'spreadsheet.setCell', platform: 'win32', app: 'Excel.Application' }).evidence)
      .toBe('documented')
  })

  it('exposes a session a consumer can drive', () => {
    expect(provider.session).toBeDefined()
    expect(typeof provider.session.run).toBe('function')
  })

  it('performs a task and establishes that it worked', async () => {
    const outcome = await provider.execute({
      task: 'file.exists',
      platform: 'win32',
      parameters: { path: import.meta.filename },
    })
    expect(outcome.mechanism).toBe('filesystem')
    expect(outcome.verified).toBe(true)
    expect(outcome.outcomes.map(entry => entry.satisfied)).toEqual([true])
  })

  it('reports a task whose evidence did not hold as unverified, never as done', async () => {
    // The recipe's own operation succeeds — the file is there — while its evidence
    // does not, which is the distinction the executor exists to report.
    const dir = mkdtempSync(join(tmpdir(), 'aeven-win-evidence-'))
    try {
      const written = join(dir, 'report.txt')
      writeFileSync(written, 'the report says this')
      const deployment = new WindowsComputerUseProvider({
        recipes: [{
          task: 'deployment.evidence',
          summary: 'A task whose evidence a deployment has to supply.',
          deliverable: 'open-application',
          on: [{
            platform: 'win32', rung: 'semantic', apps: [], evidence: 'documented',
            invocation: { mechanism: 'filesystem', operation: 'stat' },
          }],
          verify: [{ kind: 'fileContains', path: '{path}', text: 'text the file does not carry' }],
        }],
      })
      const outcome = await deployment.execute({
        task: 'deployment.evidence',
        platform: 'win32',
        parameters: { path: written },
      })
      expect(outcome.observed).toBe('present')
      expect(outcome.verified).toBe(false)
      expect(outcome.outcomes.map(entry => entry.satisfied)).toEqual([false])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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
      expect(ctx.windowsComputerUseProvider.tasks().length).toBeGreaterThan(20)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('fails a second provider with the name of the first, which is what the seam is for', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(ComputerUseRegistry)
      apply(ctx, {})
      expect(() => { apply(ctx, {}) }).toThrow(/already registered/)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('can be loaded without claiming the slot, so semantic batches mount beside the driver', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(ComputerUseRegistry)
      apply(ctx, { register: false })
      // Published for its readiness reporting and session, but the slot stays free
      // so the Cua Driver MCP provider keeps the registration.
      expect(ctx.windowsComputerUseProvider.tasks().length).toBeGreaterThan(20)
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
        name: 'test-computer-use-windows-provider',
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
