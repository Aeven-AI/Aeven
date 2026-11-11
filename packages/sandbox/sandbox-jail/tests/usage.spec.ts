import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SandboxUnavailableError } from '@aeven/sandbox'
import JailSandboxProvider from '@aeven/sandbox-jail'
import type { Config } from '@aeven/sandbox-jail'
import { AccountCgroups } from '../src/cgroup.ts'

const LIMITS = { memoryMax: 'max', pidsMax: 'max', cpuMax: 'max 100000', cpuWeight: '100' }

function scratch(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)))
}

/** A stand-in for a program the provider probes at startup, answering success. */
function succeeding(name: string, output = ''): string {
  const path = join(scratch('avn-jail-bin-'), name)
  writeFileSync(path, `#!/bin/sh\necho "${output}"\nexit 0\n`, { mode: 0o755 })
  return path
}

function writeCpu(group: string, usec: number): void {
  writeFileSync(join(group, 'cpu.stat'), `usage_usec ${usec}\nuser_usec ${usec}\nsystem_usec 0\n`)
}

describe('AccountCgroups.cpuUsec', () => {
  it('reads the CPU time of each account group created in this lifetime, skipping a removed or unreadable one', () => {
    const root = scratch('avn-cgroup-')
    const cgroups = new AccountCgroups(root, LIMITS, LIMITS, undefined, scratch('avn-accounts-'))
    const alice = cgroups.groupOf('alice')
    const bob = cgroups.groupOf('bob')
    cgroups.groupOf('carol')
    // A group from an earlier lifetime is on disk but was not created by this instance.
    mkdirSync(join(root, 'jail', 'acct-dave'))
    writeCpu(join(root, 'jail', 'acct-dave'), 9)
    writeCpu(alice, 1_500_000)
    writeFileSync(join(bob, 'cpu.stat'), 'user_usec 4\n')

    expect([...cgroups.cpuUsec()]).toEqual([['alice', 1_500_000]])
  })
})

describe('sandbox-jail usage reports and admission', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor
  let ctx: Context | undefined

  beforeAll(() => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
  })

  afterAll(() => {
    Object.defineProperty(process, 'platform', platform)
  })

  let fiber: { dispose: () => unknown } | undefined

  afterEach(async () => {
    vi.useRealTimers()
    await stop()
  })

  async function stop() {
    await fiber?.dispose()
    fiber = undefined
    ctx = undefined
  }

  /**
   * Start the provider with every field its schema would default stated, inside a plugin so stopping it disposes its
   * effects; `ctx.plugin(JailSandboxProvider)` would also demand the optional `commandUser` and `cgroup` blocks.
   */
  async function start(config: Partial<Config> & { accountsRoot: string }): Promise<JailSandboxProvider> {
    ctx = new Context()
    let sandbox: JailSandboxProvider | undefined
    const full = {
      bwrap: succeeding('bwrap'),
      launcher: succeeding('landlock-run', 'landlock: fully enforced'),
      readOnlyPaths: [],
      symlinks: {},
      env: {},
      tmpSizeMb: 64,
      hostname: 'jail',
      probeTimeoutMs: 5000,
      unlimitedAccounts: [],
      sessionAttachments: false,
      usageIntervalMs: 60_000,
      ...config,
    } as Config
    fiber = ctx.plugin({ name: 'jail-under-test', apply: (inner: Context) => { sandbox = new JailSandboxProvider(inner, full) } })
    await (fiber as unknown as { then: (f: () => void) => Promise<void> })
    return sandbox as JailSandboxProvider
  }

  async function setup(extra: Partial<Config> = {}) {
    const accountsRoot = scratch('avn-jail-accounts-')
    const cgroupRoot = scratch('avn-jail-cgroup-')
    mkdirSync(join(accountsRoot, 'alice'))
    const usage: { account: string; cpuSeconds: number }[] = []
    const sandbox = await start({ accountsRoot, cgroup: { root: cgroupRoot, total: LIMITS, account: LIMITS }, ...extra })
    ctx?.on('sandbox-jail/usage', (report) => { usage.push(report) })
    const confine = () => sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: join(accountsRoot, 'alice') })
    return { usage, confine, group: join(cgroupRoot, 'jail', 'acct-alice'), accountsRoot }
  }

  it('reports the CPU seconds an account used since its previous report, and once more on stop', async () => {
    vi.useFakeTimers()
    const { usage, confine, group } = await setup({ usageIntervalMs: 1000 })
    confine()
    writeCpu(group, 2_000_000)

    vi.advanceTimersByTime(1000)
    expect(usage).toEqual([{ account: 'alice', cpuSeconds: 2 }])

    // No new CPU time, no report.
    vi.advanceTimersByTime(1000)
    expect(usage).toHaveLength(1)

    writeCpu(group, 2_500_000)
    await stop()
    expect(usage).toEqual([{ account: 'alice', cpuSeconds: 2 }, { account: 'alice', cpuSeconds: 0.5 }])
  })

  it('confines a command no admit listener refuses, and refuses one with the listener\'s reason', async () => {
    const { confine } = await setup()
    expect(confine().argv.length).toBeGreaterThan(1)

    expect(() => (ctx?.sandbox as JailSandboxProvider).confine(['true'], { mode: 'workspace-write', workspaceRoot: tmpdir() }))
      .toThrow('is not inside one account directory')

    ctx?.on('sandbox-jail/admit', account => account === 'alice' ? 'credit is used up' : undefined)
    expect(confine).toThrow(SandboxUnavailableError)
    expect(confine).toThrow('credit is used up')
  })

  it('reports nothing without cgroups', async () => {
    const accountsRoot = scratch('avn-jail-accounts-')
    const usage: unknown[] = []
    await start({ accountsRoot })
    ctx?.on('sandbox-jail/usage', (report) => { usage.push(report) })
    await stop()
    rmSync(accountsRoot, { recursive: true, force: true })
    expect(usage).toEqual([])
  })
})
