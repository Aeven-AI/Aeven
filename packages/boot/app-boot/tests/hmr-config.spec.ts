import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, unwatchFile, utimesSync, watchFile, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Hmr from '@deepseek-ai/cordis-plugin-hmr'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { describe, expect, it, vi } from 'vitest'

async function bootHmr(dir: string, root: string[] = [], usePolling?: boolean): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(dir).href + '/'
  await ctx.plugin(Loader)
  await ctx.plugin(Timer)
  await ctx.plugin(Hmr, {
    root,
    ignored: [],
    debounce: 0,
    ...usePolling === undefined ? {} : { usePolling },
  })
  return ctx
}

/**
 * Await one filesystem notification. The deadline is the latency the watcher is
 * allowed, not the latency it normally has: under the coverage lane both sides
 * are instrumented, and a notification that arrives in under a second on its
 * own has taken more than ten there.
 */
async function eventually(test: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (!test()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/**
 * Await the first observation from a freshly registered watcher, re-applying the
 * stimulus while it does not arrive. Chokidar reports ready after its initial
 * scan, which does not say the OS has begun delivering events for the path, and
 * a write landing in that window is lost with no later trace. Re-applying keeps
 * these cases about HMR reporting a path rather than about when its watcher
 * started listening; once one notification lands the watcher is proven live, and
 * the cases that follow wait plainly.
 */
async function eventuallyObserved(
  test: () => boolean,
  stimulus: () => void,
  message: string,
  budgetMs = 90_000,
): Promise<void> {
  // The registration waits sit inside cases that allow 120 s, and a starved event queue under
  // the full suite's fork fan-out is the condition these pollers exist for.
  const deadline = Date.now() + budgetMs
  while (!test()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 250))
    if (!test()) stimulus()
  }
}

/** Chokidar's default polling cadence, which the oracle below also runs at. */
const POLL_INTERVAL_MS = 100

/**
 * Apply one edit, prove it is on disk, and resolve once the registration has
 * reported it.
 *
 * The edit is proved from the file's own size and modification time immediately
 * before and after it, which needs no timer and cannot be starved. Proving the
 * edit is not enough to rely on it, though: Chokidar emits `ready` when its
 * directory scan completes, which does not say the per-file `fs.watchFile`
 * StatWatcher that reports changes has taken its baseline yet. A write landing
 * in that window produces no tick at all and is lost for good, not delayed — 5
 * of 480 deliveries under twelve-way contention, none of 480 idle, and none of
 * the lost ones recovered within 30 s. Waiting a fixed cadence cannot close
 * that window, so the caller passes `observed`, a reading of what the
 * registration has actually seen, and this helper re-applies the edit until one
 * of them is reported.
 *
 * Re-applying is sound here where it would not be for the first edit of a case:
 * the registration's refresh reads the file rather than counting notifications,
 * so re-touching the file delivers the same content the case asserts on. The
 * edit itself runs once, and each repeat only advances the modification time,
 * which leaves those asserted bytes untouched.
 *
 * @param filename - Config path being edited.
 * @param edit - Applies the edit; re-run while the registration has not reported it.
 * @param observed - Reads what the registration has reported so far.
 * @throws when the edit left both the size and the modification time unchanged,
 * so no watcher can report it, or when nothing arrives within the budget.
 */
async function deliverChange(filename: string, edit: () => void, observed: () => number): Promise<void> {
  const seen = observed()
  const deadline = Date.now() + 30_000
  const before = statSync(filename)
  edit()
  const after = statSync(filename)
  if (after.mtimeMs === before.mtimeMs && after.size === before.size) {
    throw new Error(
      `the edit to ${filename} left its size (${after.size} bytes) and modification time (${after.mtimeMs}) unchanged, so no watcher can report it`,
    )
  }
  while (observed() === seen) {
    if (Date.now() >= deadline) {
      throw new Error(
        `the registration did not report the edit to ${filename} within 30 s, though it is on disk (${after.size} bytes, modified ${after.mtimeMs})`,
      )
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS + 50))
    // A repeat must leave the file's content exactly as the edit left it, so it
    // cannot grow the file to force a distinct size. Advance the modification
    // time instead, which is the other half of what a polling watcher compares.
    const now = new Date()
    utimesSync(filename, now, now)
  }
}

describe('HMR exact config paths', () => {
  it('observes module changes when its watch base is a filesystem alias', { timeout: 30_000 }, async () => {
    const target = mkdtempSync(join(tmpdir(), 'avn-hmr-module-canonical-'))
    const alias = `${target}-alias`
    const aliasFilename = join(alias, 'module.ts')
    symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    writeFileSync(aliasFilename, 'export const generation = 0\n')
    // This acceptance owns alias-to-cache identity. Other cases below exercise
    // native events; polling keeps Windows fs.watch queue pressure out of it.
    const ctx = await bootHmr(alias, ['.'], true)
    const filename = join(await realpath(target), 'module.ts')
    const expected = pathToFileURL(filename).href
    const cacheHas = vi.spyOn(ctx.loader.internal!.loadCache, 'has').mockReturnValue(false)
    const observed: string[] = []
    ctx.on('hmr/change', (url) => { observed.push(url) })
    try {
      const deadline = Date.now() + 20_000
      for (let generation = 1; !observed.includes(expected); generation += 1) {
        if (Date.now() >= deadline) {
          throw new Error(`HMR did not observe ${expected} through the alias; observed ${JSON.stringify(observed)}`)
        }
        // The watch base, not the writer spelling, is the alias under test.
        // Grow the file on every write: polling must not depend on timestamp
        // precision when several generations land inside one filesystem tick.
        writeFileSync(filename, `export const generation = ${generation}\n${' '.repeat(generation)}\n`)
        // Leave Chokidar's atomic-write window idle so one coalesced change can publish.
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      expect(cacheHas).toHaveBeenCalledWith(expected)
    } finally {
      await ctx.fiber.dispose()
      unlinkSync(alias)
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('collapses filesystem aliases before registering an exact watch', async () => {
    const target = mkdtempSync(join(tmpdir(), 'avn-hmr-canonical-'))
    const alias = `${target}-alias`
    symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const ctx = await bootHmr(alias)
    try {
      await ctx.hmr.registerConfig('plugins.yml', () => {})
      await expect(ctx.hmr.registerConfig(join(await realpath(target), 'plugins.yml'), () => {}))
        .rejects.toThrow('config path already registered')
    } finally {
      await ctx.fiber.dispose()
      unlinkSync(alias)
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('observes add, change, and unlink outside its module roots', { timeout: 120_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'avn-hmr-config-'))
    const filename = join(dir, 'plugins.yml')
    const ctx = await bootHmr(dir)
    const observed: string[] = []
    try {
      await ctx.hmr.registerConfig(filename, () => {
        try {
          observed.push(readFileSync(filename, 'utf8'))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          observed.push('missing')
        }
      })

      writeFileSync(filename, 'one', { flag: 'wx' })
      await eventuallyObserved(
        () => observed.includes('one'),
        () => { writeFileSync(filename, 'one') },
        'HMR did not observe config creation',
      )
      writeFileSync(filename, 'two')
      await eventually(() => observed.includes('two'), 'HMR did not observe config change')
      unlinkSync(filename)
      await eventually(() => observed.includes('missing'), 'HMR did not observe config removal')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('observes creation when the config parent did not exist at registration', { timeout: 120_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'avn-hmr-config-'))
    const dir = join(root, 'later')
    const filename = join(dir, 'plugins.yml')
    const ctx = await bootHmr(root)
    const observed: string[] = []
    try {
      await ctx.hmr.registerConfig(filename, () => {
        observed.push(readFileSync(filename, 'utf8'))
      })
      mkdirSync(dir)
      // The parent appears and the file lands in the same tick, and the watcher
      // has to add the new directory before it can report anything inside it.
      writeFileSync(filename, 'created')
      await eventuallyObserved(
        () => observed.includes('created'),
        () => {
          writeFileSync(filename, 'created')
          // The watch sits on `root`, so a lost event for the parent's creation
          // leaves `later` unwatched and rewrites inside it unseen. An entry
          // written directly under `root` makes the watcher rescan it and add
          // the parent.
          writeFileSync(join(root, 'sibling'), 'rescan')
        },
        'HMR did not observe config creation under a new parent',
      )
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('serializes refreshes and waits for them during disposal', { timeout: 120_000 }, async () => {
    // HMR watches the canonical path, and Node shares one StatWatcher only between identical path
    // strings: through macOS's `/var` -> `/private/var` link the witness below would poll on its own
    // timer and could report an edit before the registration's poller has seen it.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'avn-hmr-config-')))
    const filename = join(dir, 'plugins.yml')
    writeFileSync(filename, 'one')
    // Polling, like the alias case above: this test's delivery has to survive the
    // full suite's fork fan-out, where the native event queue is starved enough
    // that a change delivered through it is never seen. A poller runs on a timer.
    const ctx = await bootHmr(dir, [], true)
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const observed: string[] = []
    let refreshFailure: Error | undefined
    let active = 0
    let maxActive = 0
    // A second poller on the config file, on the same cadence and the same
    // `fs.watchFile` StatWatcher that Chokidar's polling mode uses. The second
    // edit is written from inside the running refresh, where the registration
    // cannot report anything — HMR serializes the callback, so its next run is
    // what the case is waiting for. This witness reports the same file on the
    // same mechanism, which is the reading `deliverChange` needs to tell a
    // delivered edit from a lost one. It is proven live below, before the first
    // refresh, so its own baseline window is closed before anything relies on it.
    let witnessed = 0
    watchFile(filename, { interval: POLL_INTERVAL_MS }, () => { witnessed += 1 })
    // A StatWatcher takes its first stat asynchronously, so drive one change
    // through it before anything depends on it. `plugins.yml` still reads
    // `'one'` afterwards, which is the content the first refresh asserts on.
    await eventuallyObserved(
      () => witnessed > 0,
      () => { writeFileSync(filename, 'one') },
      'the witness poller never reported a change, so it cannot prove a delivery',
    )
    witnessed = 0
    try {
      const dispose = await ctx.hmr.registerConfig(filename, async () => {
        try {
          active += 1
          maxActive = Math.max(maxActive, active)
          observed.push(readFileSync(filename, 'utf8'))
          if (observed.length === 1) {
            // Deliver the second edit from INSIDE the running refresh, so it is
            // coalesced while this one is still in flight, and do not signal the
            // test until it is queued: `dispose()` closes the registration's
            // watcher, so an edit that has not landed yet would be dropped.
            try {
              await deliverChange(filename, () => { writeFileSync(filename, 'two') }, () => witnessed)
            } finally {
              // Never strand the test body here: a delivery failure must surface as
              // this case's failure below, not as this case's 120 s timeout.
              started.resolve(undefined)
            }
            await release.promise
          }
        } catch (error) {
          // The registration stays registered after a rejected refresh and runs it
          // again once the queued edit arrives, so a failure left here would raise
          // `active` a second time and read as an overlap that never happened.
          refreshFailure ??= error instanceof Error ? error : new Error(String(error), { cause: error })
          throw error
        } finally {
          active -= 1
        }
      })
      await started.promise

      let disposed = false
      const disposal = dispose().then(() => { disposed = true })
      await Promise.resolve()
      expect(disposed).toBe(false)
      release.resolve(undefined)
      await disposal
      if (refreshFailure !== undefined) throw refreshFailure
      expect(maxActive).toBe(1)
      expect(observed).toEqual(['one', 'two'])
    } finally {
      release.resolve(undefined)
      unwatchFile(filename)
      await ctx.fiber.dispose()
    }
  })

  it('normalizes refresh failures and broadcasts them without escaping the watcher', { timeout: 120_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'avn-hmr-config-'))
    const filename = join(dir, 'plugins.yml')
    // Polling, like the cases above: under the full suite's fork fan-out the
    // native event queue is starved enough that this case's first broadcast is
    // never delivered, and the case then spends its whole 120 s budget waiting
    // for it. A poller runs on a timer.
    const ctx = await bootHmr(dir, [], true)
    let observed: { filename: string; error: Error } | undefined
    let failureCount = 0
    try {
      ctx.on('hmr/config-update-failed', () => {
        throw new Error('observer failed')
      })
      ctx.on('hmr/config-update-failed', (failedFilename, error) => {
        failureCount += 1
        observed ??= { filename: failedFilename, error }
      })
      await ctx.hmr.registerConfig(filename, () => { throw 42 })
      let stimulus = 0
      writeFileSync(filename, 'invalid')
      // A StatWatcher takes its first stat asynchronously, so a write issued
      // right after registration can become its baseline and never be reported.
      // Re-apply until the first broadcast proves the watcher live, growing the
      // file each time: a rewrite of identical content leaves the size equal and
      // can land inside one filesystem timestamp tick, which a poller comparing
      // stats cannot distinguish from no write at all.
      await eventuallyObserved(
        () => observed !== undefined,
        () => {
          writeFileSync(filename, `invalid${' '.repeat(stimulus += 1)}`)
          // The file did not exist at registration, so a poller learns of it only from a change to
          // `dir`; rewriting the file alone leaves `dir` untouched if its creation landed before the
          // directory poller's baseline. An entry written beside it makes the watcher rescan `dir`.
          writeFileSync(join(dir, 'sibling'), `rescan ${stimulus}`)
        },
        'HMR did not broadcast the refresh failure',
      )
      expect(observed!.filename).toBe(filename)
      expect(observed!.error).toBeInstanceOf(Error)
      expect(observed!.error.message).toBe('42')

      // Let Chokidar's atomic-write window close before requiring a distinct
      // second notification from the same path.
      await new Promise(resolve => setTimeout(resolve, 250))
      const seen = failureCount
      writeFileSync(filename, 'invalid again')
      await eventuallyObserved(
        () => failureCount > seen,
        () => { writeFileSync(filename, `invalid again${' '.repeat(stimulus += 1)}`) },
        'HMR stopped broadcasting after an observer rejected',
      )
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
