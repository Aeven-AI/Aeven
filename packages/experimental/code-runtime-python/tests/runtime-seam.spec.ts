import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync, rmSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { PythonCodeRuntime, hostFrameParseCeiling, resolvePythonBin } from '../src/index.ts'
import type { CodeBindingFunction } from '@aeven/code-runtime'
import { PYABS, cleanupTempFixtures, makeTempDir, makeTempDirSync, setup } from './harness.ts'

/**
 * Names one `py/` script whose `copyFileSync` must fail, for the partial-staging
 * case. A real disk-full or missing-asset failure mid-copy cannot be produced
 * from a test, and the leak only shows when `mkdtempSync` has already succeeded.
 *
 * `stagedDirs` records every staging directory THIS test file creates, so the
 * leak assertions check the exact paths instead of a global tmpdir diff: a
 * parallel vitest worker running the same prefix could create or remove
 * `avn-code-runtime-python-*` directories inside the sampling window, which a
 * readdir diff would misattribute to this test. `boot-write-failure.spec.ts`
 * records the same race and solves it with argv-based identity; recording the
 * mkdtempSync results is the fs-mock equivalent.
 */
const { failNextCopyOf, stagedDirs } = vi.hoisted(() => ({
  failNextCopyOf: { value: undefined as string | undefined },
  stagedDirs: [] as string[],
}))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    copyFileSync(source: string, destination: string): void {
      if (failNextCopyOf.value !== undefined && basename(source) === failNextCopyOf.value) {
        failNextCopyOf.value = undefined
        throw Object.assign(new Error('simulated ENOSPC on copy'), { code: 'ENOSPC' })
      }
      actual.copyFileSync(source, destination)
    },
    mkdtempSync(prefix: string): string {
      const dir = actual.mkdtempSync(prefix)
      if (basename(prefix).startsWith('avn-code-runtime-python-')) stagedDirs.push(dir)
      return dir
    },
  }
})

// Remove every fixture this file created, so repeated runs do not accumulate
// `avn-*` directories and wrappers in the shared tmpdir.
afterEach(cleanupTempFixtures)

describe('PythonCodeRuntime — seam descriptors and misuse', () => {
  it('registers the seam descriptors', async () => {
    const { runtime } = await setup()
    expect(runtime.language).toBe('python')
    expect(runtime.isolation).toBe('process')
  })

  it('rejects non-positive config as seam misuse', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(PythonCodeRuntime, { cpuSeconds: 0 }))
      .rejects.toThrow(/cpuSeconds must be a positive number/)
    await expect(ctx.plugin(PythonCodeRuntime, { maxWallMs: -1 }))
      .rejects.toThrow(/maxWallMs must be a positive number/)
  })

  it('rejects a non-integer cpuSeconds at load (setrlimit needs an int)', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(PythonCodeRuntime, { cpuSeconds: 1.5 }))
      .rejects.toThrow(/cpuSeconds must be a positive integer, got 1.5/)
  })

  it('rejects a non-integer byte budget at load (the child int()-truncates it)', async () => {
    // maxLogBytes/maxValueBytes cross to the child, which reads them through
    // int(...): a float would floor there while the host meters the fraction, so
    // the two sides would enforce different public config. Reject at load.
    const ctxLog = new Context()
    await expect(ctxLog.plugin(PythonCodeRuntime, { maxLogBytes: 3.5 }))
      .rejects.toThrow(/maxLogBytes must be a positive integer/)
    const ctxValue = new Context()
    await expect(ctxValue.plugin(PythonCodeRuntime, { maxValueBytes: 1024.5 }))
      .rejects.toThrow(/maxValueBytes must be a positive integer/)
  })

  it('rejects finite numeric config that cannot cross as an exact rlimit integer', async () => {
    // `Number.isFinite` and `Number.isInteger` both admit values that cannot
    // round-trip. `addressSpaceMb: 1e308` overflows to `Infinity` once multiplied
    // by 1 MiB, and `encodeJsonPlain` renders that as `null`, so the child gets no
    // limit at all; `cpuSeconds: 1e100` clears `Number.isInteger` while sitting
    // far past the safe range, so `setrlimit` receives a different number than was
    // configured. Both used to end every run in a bootstrap exception instead of
    // failing at load, where a self-contained configuration error belongs.
    const ctx = new Context()
    await expect(ctx.plugin(PythonCodeRuntime, { addressSpaceMb: 1e308 }))
      .rejects.toThrow(/addressSpaceMb must be at most \d+ .*exact integer/)
    await expect(ctx.plugin(PythonCodeRuntime, { cpuSeconds: 1e100 }))
      .rejects.toThrow(/cpuSeconds must be at most \d+ .*exact integers/)
    // The boundary values still load: the bound rejects what cannot be encoded,
    // not everything large.
    const okMb = await ctx.plugin(PythonCodeRuntime, { addressSpaceMb: Math.floor(Number.MAX_SAFE_INTEGER / (1024 * 1024)) })
    await okMb.dispose()
    const okCpu = await ctx.plugin(PythonCodeRuntime, { cpuSeconds: Number.MAX_SAFE_INTEGER - 1 })
    await okCpu.dispose()
  })

  it('rejects an output cap whose payload could not cross the frame ceiling', async () => {
    // The caps budget a payload that must arrive inside ONE fd-3 frame, and the
    // 64 MiB frame parse cap is fixed. A larger cap is unsatisfiable rather
    // than generous: a completion the cap admits arrives as an over-ceiling
    // frame and fails the run as `worker-exit`, inverting the `output-limit`
    // the cap describes. Both budgets are metered in already-escaped serialized
    // bytes, so a payload occupies at most `cap + envelope` on the wire; the
    // bound is `parse-cap - envelope`, not `(ceiling - envelope) / 6` (that
    // divided in escape expansion the charge already counts). The receive path
    // rejects raw frames past the 64 MiB parse cap (the run settles as a
    // worker-exit), so a budget above it would admit a config whose honest
    // child frames the host then rejects.
    const admissible = 64 * 1024 * 1024 - 64
    const ctx = new Context()
    await expect(ctx.plugin(PythonCodeRuntime, { maxLogBytes: admissible + 1 }))
      .rejects.toThrow(/maxLogBytes must not exceed 67108800/)
    await expect(ctx.plugin(PythonCodeRuntime, { maxValueBytes: admissible + 1 }))
      .rejects.toThrow(/maxValueBytes must not exceed 67108800/)
    // The boundary value itself loads: the bound is the largest cap a frame can
    // still carry, not one below it. It needs an address space large enough to
    // clear the separate maxValueBytes/addressSpaceMb worst-case gate (the cap
    // times the 12x Unicode expansion must fit), so this pairs it with a 4 GiB
    // addressSpaceMb — the two load-time bounds are independent.
    const boundary = await ctx.plugin(PythonCodeRuntime, { maxValueBytes: admissible, addressSpaceMb: 4096 })
    await boundary.dispose()
  })

  it('rejects a completion budget whose frame a constrained host heap cannot safely parse', async () => {
    // The load gate bounds the CHILD's build-and-encode under RLIMIT_AS; it
    // does not bound the HOST's JSON.parse, which materializes several times a
    // wide frame's raw bytes in property storage. In a child node with a
    // 128 MiB old space the heap-derived frame cap is ~7 MiB, so a 50 MiB
    // budget is rejected at load even though the address-space gate alone
    // would admit it (50 MiB * 12 = 600 MiB < 1 GiB - 64 MiB).
    const script = [
      "import { Context } from '@deepseek-ai/cordis'",
      "import { PythonCodeRuntime } from './packages/experimental/code-runtime-python/src/index.ts'",
      'const ctx = new Context()',
      'try {',
      '  await ctx.plugin(PythonCodeRuntime, { maxValueBytes: 50 * 1024 * 1024, addressSpaceMb: 1024 })',
      "  console.log('LOADED')",
      '  process.exit(1)',
      '} catch (error) {',
      "  console.log('REJECTED:' + (error instanceof Error ? error.message : String(error)))",
      '  process.exit(0)',
      '}',
    ].join('\n')
    const out = execFileSync(process.execPath, ['--max-old-space-size=128', '--import', 'tsx', '-e', script], {
      cwd: resolve(import.meta.dirname, '../../../..'),
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, TSX_TSCONFIG_PATH: resolve(import.meta.dirname, '../../../../tsconfig.json') },
    })
    expect(out).toContain('REJECTED:')
    expect(out).toContain('must not exceed')
  }, 60_000)

  it('parses a worst-shape frame at the derived cap on a constrained heap', async () => {
    // The host-heap frame cap must be measured against the WORST parse shape —
    // a dict of many short unique keys, which forces dictionary-mode property
    // storage plus interned keys (~6.4x at 3M keys, trending up), not the ~3x
    // of a repeated-key dict. A child node with a 128 MiB old space (~176 MiB
    // heap limit) derives a cap of floor((176 - 64) / 16) = 7 MiB; the
    // subprocess builds a unique-key dict whose frame is AT that cap and
    // parses it, which must survive. Verified fail-before: with the multiple
    // at 8 the derived cap doubles to 14 MiB and the same subprocess OOMs
    // during the parse (plain JS, no tsx — the frame and parse are builtins).
    const cap = hostFrameParseCeiling(176 * 1024 * 1024)
    const script = [
      `const cap = ${cap}`,
      // Each entry "k<base36>:1," is ~9-12 raw bytes; a few hundred thousand
      // unique keys put the frame just at the cap.
      'const count = Math.floor(cap / 12)',
      'const obj = {}',
      'for (let i = 0; i < count; i++) obj[`k${i.toString(36)}`] = 1',
      'const frame = JSON.stringify(obj)',
      "if (Buffer.byteLength(frame, 'utf8') > cap) throw new Error('frame over cap: ' + frame.length)",
      'JSON.parse(frame)',
      "console.log('SURVIVED:' + Buffer.byteLength(frame, 'utf8'))",
    ].join('\n')
    const out = execFileSync(process.execPath, ['--max-old-space-size=128', '-e', script], {
      encoding: 'utf8',
      timeout: 60_000,
    })
    expect(out).toContain('SURVIVED:')
  }, 60_000)

  it('rejects a pythonBin that spawn() would throw on, at load', async () => {
    // Both values pass the string schema and both make `spawn` throw
    // SYNCHRONOUSLY from inside run() — ERR_INVALID_ARG_VALUE for the empty
    // path, ERR_INVALID_ARG_TYPE for the NUL — so run() would REJECT instead of
    // resolving the worker-exit the seam promises for a child that cannot
    // start. Both are self-contained configuration errors, so they fail here.
    const ctx = new Context()
    await expect(ctx.plugin(PythonCodeRuntime, { pythonBin: '' }))
      .rejects.toThrow(/pythonBin must be a non-empty path without NUL bytes/)
    await expect(ctx.plugin(PythonCodeRuntime, { pythonBin: 'py\u0000thon3' }))
      .rejects.toThrow(/pythonBin must be a non-empty path without NUL bytes/)
  })

  it('rejects an explicit pythonBin that is not an executable regular file, at load', async () => {
    // An explicit path (absolute, or containing a slash) bypasses PATH lookup,
    // so it must be validated directly: missing, non-executable, or directory
    // paths are self-contained configuration errors that used to slip through
    // load and surface only at the first run() as a misleading worker-exit.
    // The message distinguishes the explicit-path failure from a basename that
    // simply does not resolve on PATH.
    const nodePath = await import('node:path')
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const dir = makeTempDirSync('avn-bad-bin-')
    const notExecutable = nodePath.join(dir, 'not-executable')
    writeFileSync(notExecutable, '#!/bin/sh\nexit 0\n') // Regular file, but no X bit.
    const directory = nodePath.join(dir, 'is-a-directory')
    mkdirSync(directory)
    try {
      const missing = new Context()
      await expect(missing.plugin(PythonCodeRuntime, { pythonBin: nodePath.join(dir, 'missing') }))
        .rejects.toThrow(/is not an executable regular file/)
      const noX = new Context()
      await expect(noX.plugin(PythonCodeRuntime, { pythonBin: notExecutable }))
        .rejects.toThrow(/is not an executable regular file/)
      const isDir = new Context()
      await expect(isDir.plugin(PythonCodeRuntime, { pythonBin: directory }))
        .rejects.toThrow(/is not an executable regular file/)
      // A relative explicit path fails the same way, resolved against the host
      // CWD: `dir` is absolute, so a slash-containing relative form of it is
      // the dirname prefix plus the file, which does not exist as such.
      const rel = new Context()
      await expect(rel.plugin(PythonCodeRuntime, { pythonBin: './definitely-not-there-python' }))
        .rejects.toThrow(/is not an executable regular file/)
    } finally {
      const { rmSync } = await import('node:fs')
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a non-CPython, outdated, or probe-failing interpreter at load', async () => {
    const nonPython = new Context()
    await expect(nonPython.plugin(PythonCodeRuntime, { pythonBin: '/bin/echo' }))
      .rejects.toThrow(/did not report a CPython version/)

    const dir = await mkdtemp(join(tmpdir(), 'avn-python-probe-'))
    const oldMajor = join(dir, 'python-old-major')
    const old = join(dir, 'python-old')
    const future = join(dir, 'python-future')
    const pypy = join(dir, 'pypy')
    const failed = join(dir, 'python-failed')
    await writeFile(oldMajor, '#!/bin/sh\nprintf \'cpython 2 99 0\\n\'\n', { mode: 0o755 })
    await writeFile(old, '#!/bin/sh\nprintf \'cpython 3 9 6\\n\'\n', { mode: 0o755 })
    await writeFile(future, '#!/bin/sh\nprintf \'cpython 4 0 0\\n\'\n', { mode: 0o755 })
    await writeFile(pypy, '#!/bin/sh\nprintf \'pypy 3 10 0\\n\'\n', { mode: 0o755 })
    await writeFile(failed, '#!/bin/sh\nexit 7\n', { mode: 0o755 })
    try {
      expect(resolvePythonBin(relative(process.cwd(), old))).toBe(old)
      const obsolete = new Context()
      await expect(obsolete.plugin(PythonCodeRuntime, { pythonBin: oldMajor }))
        .rejects.toThrow(/must be CPython 3\.10 or newer, got cpython 2\.99\.0/)
      const outdated = new Context()
      await expect(outdated.plugin(PythonCodeRuntime, { pythonBin: old }))
        .rejects.toThrow(/must be CPython 3\.10 or newer, got cpython 3\.9\.6/)
      const forwardCompatible = new Context()
      const fiber = await forwardCompatible.plugin(PythonCodeRuntime, { pythonBin: future })
      await fiber.dispose()
      const alternative = new Context()
      await expect(alternative.plugin(PythonCodeRuntime, { pythonBin: pypy }))
        .rejects.toThrow(/must be CPython, got pypy/)
      const probeFailure = new Context()
      await expect(probeFailure.plugin(PythonCodeRuntime, { pythonBin: failed }))
        .rejects.toThrow(/failed the CPython version probe/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps an explicit executable pythonBin working through load and run', async () => {
    // The same validation that rejects bad explicit paths must admit a good
    // one: an absolute path to the real interpreter (or a wrapper around it)
    // is the deployment form the validation exists to serve.
    const pyAbs = resolvePythonBin('python3') ?? 'python3'
    const { runtime, fiber } = await setup({ pythonBin: pyAbs, maxWallMs: 30_000 })
    const result = await runtime.run({ program: 'return 1', bindings: [] })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(1)
    await fiber.dispose()
  })

  it('rejects a binding member accessor that throws, as seam misuse', async () => {
    // `namespace.functions` is caller-supplied, so its members may come from a
    // getter or Proxy. Reading one of them inside the fd-3 `data` callback used
    // to throw OUTSIDE the dispatcher's try and terminate the host; the
    // validation now snapshots the callables synchronously, so the throw
    // surfaces as the seam-misuse rejection run() reserves for malformed
    // bindings — the child is never spawned.
    const { runtime } = await setup()
    const exploding = {
      get explode(): CodeBindingFunction {
        throw new Error('getter blew up')
      },
    }
    await expect(runtime.run({
      program: 'return 1',
      bindings: [{ global: 'tools', functions: exploding }],
    })).rejects.toThrow(/getter blew up/)
  })

  it('snapshots binding callables once, so a getter is read exactly once', async () => {
    // The snapshot also fixes the key set the boot frame advertises: the child
    // learns the namespace names from the SAME record dispatch reads, so a
    // getter whose keys differ between reads cannot desynchronize the two.
    let reads = 0
    const countReads = {
      get first(): CodeBindingFunction {
        reads += 1
        return async () => 1
      },
    }
    const { runtime, fiber } = await setup()
    const result = await runtime.run({
      program: 'return 1',
      bindings: [{ global: 'tools', functions: countReads }],
    })
    expect(result.error).toBeUndefined()
    // One read for the validation snapshot; the boot frame and every dispatch
    // read the snapshot, not the getter.
    expect(reads).toBe(1)
    await fiber.dispose()
  })

  it('keeps a __proto__ binding member dispatchable', async () => {
    // The seam contract treats member names like `__proto__` or `constructor`
    // as ordinary own properties (null-prototype construction). The binding
    // snapshot must preserve that: a plain `{}` record would hit the prototype
    // setter on assignment and drop the member, so the child would never learn
    // the name and a call to it would fail with KeyError.
    const { runtime, fiber } = await setup()
    const result = await runtime.run({
      program: 'return await tools["__proto__"]({})',
      bindings: [{
        global: 'tools',
        functions: { ['__proto__']: async () => 'proto-callable' },
      }],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('proto-callable')
    await fiber.dispose()
  })

  it('resolves pythonBin once so a later PATH change cannot switch interpreters', async () => {
    const firstDir = await mkdtemp(join(tmpdir(), 'avn-python-first-'))
    const secondDir = await mkdtemp(join(tmpdir(), 'avn-python-second-'))
    const wrapper = (marker: string): string => `#!/bin/sh\nAVN_TEST_PYTHON=${marker}\nexport AVN_TEST_PYTHON\nexec "${PYABS}" "$@"\n`
    await writeFile(join(firstDir, 'python3'), wrapper('first'), { mode: 0o755 })
    await writeFile(join(secondDir, 'python3'), wrapper('second'), { mode: 0o755 })
    vi.stubEnv('PATH', firstDir)
    let fiber: Awaited<ReturnType<typeof setup>>['fiber'] | undefined
    try {
      const mounted = await setup({ pythonBin: 'python3' })
      fiber = mounted.fiber
      vi.stubEnv('PATH', secondDir)
      const result = await mounted.runtime.run({
        program: 'import os\nreturn os.environ.get("AVN_TEST_PYTHON")',
        bindings: [],
      })
      expect(result.error).toBeUndefined()
      expect(result.value).toBe('first')
    } finally {
      await fiber?.dispose()
      vi.unstubAllEnvs()
      rmSync(firstDir, { recursive: true, force: true })
      rmSync(secondDir, { recursive: true, force: true })
    }
  })

  it('skips relative PATH entries when resolving a basename pythonBin', async () => {
    // resolvePythonBin must return an absolute path: a RELATIVE PATH entry
    // ('.' here) would otherwise resolve the basename against the host CWD.
    // This run's CWD holds no executable named python3, so both the relative
    // skip and the accessSync-miss fall through to the absolute entry — the
    // case pins the contract (absolute candidate wins over a relative PATH
    // prefix), not a worker-exit distinction, which would need an executable
    // named python3 in the test CWD.
    const cp = await import('node:child_process')
    const nodePath = await import('node:path')
    const pythonDir = nodePath.dirname(cp.execFileSync('which', ['python3'], { encoding: 'utf8' }).trim())
    vi.stubEnv('PATH', `.:${pythonDir}`)
    try {
      const { runtime, fiber } = await setup({ pythonBin: 'python3', maxWallMs: 30_000 })
      const result = await runtime.run({ program: 'return 1', bindings: [] })
      expect(result.error).toBeUndefined()
      expect(result.value).toBe(1)
      await fiber.dispose()
    } finally {
      vi.unstubAllEnvs()
    }
  }, 45_000)

  it('ignores a forged second boot-ack without re-sending the run frame', async () => {
    // The run frame is sent once, from the first boot-ack; a program that
    // forges an extra boot-ack frame on fd 3 must not re-enter the gate (a
    // second run frame would confuse the child's frame reader). The honest
    // child sends exactly one ack; the forged one exercises the re-entry
    // guard.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import os',
        // One forged boot-ack after the program starts; the run already went
        // out on the real ack.
        "os.write(3, b'{\"type\":\"boot-ack\"}\\n')",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
  }, 15_000)

  it('skips a PATH entry that is an executable DIRECTORY named like the interpreter', async () => {
    // accessSync(X_OK) succeeds on directories, so without the isFile guard a
    // PATH entry like a `python3` directory would be chosen over a later real
    // interpreter. The stub PATH puts such a directory first and asserts the
    // real interpreter is used.
    const cp = await import('node:child_process')
    const nodePath = await import('node:path')
    const { mkdirSync } = await import('node:fs')
    const realPythonDir = nodePath.dirname(cp.execFileSync('which', ['python3'], { encoding: 'utf8' }).trim())
    const fakeDir = makeTempDirSync('avn-fake-bin-')
    mkdirSync(nodePath.join(fakeDir, 'python3')) // A directory named python3, executable by default.
    vi.stubEnv('PATH', `${fakeDir}:${realPythonDir}`)
    try {
      const { runtime, fiber } = await setup({ pythonBin: 'python3', maxWallMs: 30_000 })
      const result = await runtime.run({ program: 'return 1', bindings: [] })
      expect(result.error).toBeUndefined()
      expect(result.value).toBe(1)
      await fiber.dispose()
    } finally {
      vi.unstubAllEnvs()
    }
  }, 45_000)

  it('rejects a timer budget setTimeout would silently clamp to 1 ms', async () => {
    // Node stores a setTimeout delay as a signed 32-bit value and substitutes
    // 1 ms for anything larger, inverting the knob's meaning: a huge maxWallMs
    // would time every run out at once, and a huge graceMs would SIGKILL one
    // millisecond after SIGTERM. Both must fail at load instead.
    const ctx = new Context()
    await expect(ctx.plugin(PythonCodeRuntime, { maxWallMs: 2_147_483_648 }))
      .rejects.toThrow(/maxWallMs must not exceed 2147483647/)
    // graceMs is bounded by the close deadline's added margin, not by the raw
    // timer maximum, because that sum is what gets armed.
    await expect(ctx.plugin(PythonCodeRuntime, { graceMs: 2_147_481_648 }))
      .rejects.toThrow(/graceMs must not exceed 2147481647/)
    // The exact maxima still load.
    await expect(ctx.plugin(PythonCodeRuntime, { maxWallMs: 2_147_483_647, graceMs: 2_147_481_647 }))
      .resolves.toBeDefined()
  })

  it('rejects loading this Unix-only backend on Windows', async () => {
    // The bootstrap needs the POSIX `resource` module, a positional fd 3, and
    // negative-PID process-group signals — none on Windows. The constructor
    // must throw at load rather than register ctx.codeRuntime and defer the
    // failure to the first run.
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      const ctx = new Context()
      await expect(ctx.plugin(PythonCodeRuntime, {})).rejects.toThrow(/requires a Unix platform/)
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
    }
  })

  it('rejects a binding global that is not a Python identifier or is reserved', async () => {
    const { runtime } = await setup()
    await expect(runtime.run({
      program: 'return 1',
      bindings: [{ global: '1bad', functions: {} }],
    })).rejects.toThrow(/is not a usable Python identifier/)
    await expect(runtime.run({
      program: 'return 1',
      bindings: [{ global: 'class', functions: {} }],
    })).rejects.toThrow(/is not a usable Python identifier/)
  })

  it('rejects duplicate binding namespaces', async () => {
    const { runtime } = await setup()
    await expect(runtime.run({
      program: 'return 1',
      bindings: [
        { global: 'tools', functions: {} },
        { global: 'tools', functions: {} },
      ],
    })).rejects.toThrow(/duplicate binding global/)
  })

  it('rejects run() after disposal, and unregisters ctx.codeRuntime', async () => {
    const { ctx, fiber, runtime } = await setup()
    await fiber.dispose()
    await expect(runtime.run({ program: 'return 1', bindings: [] }))
      .rejects.toThrow(/after disposal/)
    expect(ctx.get('codeRuntime')).toBeUndefined()
  })

  it('short-circuits when the request signal is already aborted', async () => {
    const { runtime } = await setup()
    const signal = AbortSignal.abort('already-cancelled')
    const result = await runtime.run({ program: 'return 1', bindings: [], signal })
    expect(result.error?.kind).toBe('abort')
    expect(result.error?.message).toContain('already-cancelled')
    expect(result.logs).toEqual([])
  })

  it('short-circuits on an already-aborted signal whose reason cannot be converted', async () => {
    // The pre-flight arm converted the reason with a bare `String()`, so a
    // hostile reason threw out of `run()` — the seam promises to reject only for
    // misuse, and a caller's cancellation token is not misuse.
    const { runtime } = await setup()
    const signal = AbortSignal.abort({
      [Symbol.toPrimitive]() { throw new Error('reason blew up') },
    })
    const result = await runtime.run({ program: 'return 1', bindings: [], signal })
    expect(result.error?.kind).toBe('abort')
    expect(result.error?.message).toBe('<unrenderable rejection value>')
    expect(result.logs).toEqual([])
  })

  it('runs the interpreter from materialized scripts outside the package, and removes them per run', async () => {
    // The interpreter is an EXTERNAL process, so it can only open paths the OS
    // resolves. Inside the single-file Python-SDK executable the packaged `py/`
    // directory lives in pkg's virtual filesystem, which Node reads through its
    // patched `fs` but `python3` cannot see, so spawning from that path fails
    // with ENOENT. The scripts are therefore copied to a real directory first.
    //
    // The path is read from the child's own `__main__` module, so it proves
    // where the interpreter actually loaded the entry script — asserting on a
    // host-side constant would only restate the source. The program namespace
    // seeds `__name__` but no `__file__`, hence the module lookup.
    // `protocol.py` must land in the SAME directory, since `bootstrap.py` puts
    // its own directory on `sys.path` to import it; the run completing at all
    // already exercises that import.
    const { runtime } = await setup()
    const entryOf = async (): Promise<string> => {
      const result = await runtime.run({ program: 'import sys\nreturn sys.modules["__main__"].__file__', bindings: [] })
      expect(result.error).toBeUndefined()
      return result.value as string
    }
    const entry = await entryOf()
    expect(entry.endsWith('/bootstrap.py')).toBe(true)
    const dir = dirname(entry)
    expect(realpathSync(dirname(dir))).toBe(realpathSync(tmpdir()))
    expect(basename(dir)).toMatch(/^avn-code-runtime-python-/)
    expect(dir).not.toContain('/packages/')
    // Staging is per RUN and removed at settlement, so by the time `run()`
    // resolved the directory is already gone — nothing survives to be rewritten
    // by a later run. `protocol.py` had to be beside the entry script for the run
    // to complete at all, since `bootstrap.py` imports it off `sys.path`.
    expect(existsSync(dir)).toBe(false)
    // A second run stages its own copy rather than reusing the first.
    expect(dirname(await entryOf())).not.toBe(dir)
  })

  it('contains a program that rewrites its own bootstrap to the run that did it', async () => {
    // The child runs as the same UID as the host, so `0o700` does not stop model
    // code from rewriting the scripts it was started from —
    // `sys.modules['__main__'].__file__` names them. While all runs shared one
    // staged copy, a program that overwrote `bootstrap.py` broke the NEXT run
    // (measured: it settled as `worker-exit`), and substituted code would have
    // run before the resource limits were applied.
    const { runtime } = await setup({ maxWallMs: 10_000 })
    const sabotage = await runtime.run({
      program: [
        'import sys',
        'path = sys.modules["__main__"].__file__',
        'open(path, "w").write("raise SystemExit(1)\\n")',
        'return path',
      ].join('\n'),
      bindings: [],
    })
    expect(sabotage.error).toBeUndefined()
    // The damage stayed inside the run that caused it.
    const after = await runtime.run({ program: 'return 1 + 1', bindings: [] })
    expect(after.error).toBeUndefined()
    expect(after.value).toBe(2)
  }, 20_000)

  it('leaves no subprocess or scripts behind when disposal races the first run', async () => {
    // Staging runs SYNCHRONOUSLY so no async boundary opens between `run()` and
    // the point where `execute` registers the run in `live` and installs the
    // abort listener. With an `await` there, a disposal landing in that window
    // saw an empty `live`, returned, removed the script directory, and let the
    // continuation spawn a subprocess after the fiber was gone.
    //
    // `dispose()` is called in the same synchronous turn as `run()`, with no
    // `await` between them, so it lands exactly in that window.
    //
    // The leak assertion checks the EXACT paths this test file staged (recorded
    // by the mocked mkdtempSync) rather than diffing a global tmpdir: a
    // parallel vitest worker can create or remove same-prefix directories
    // inside the sampling window, which a readdir diff would misattribute to
    // this test (boot-write-failure.spec.ts records the same race).
    const stagedBefore = stagedDirs.length
    const { fiber, runtime } = await setup({ maxWallMs: 8_000 })
    const pending = runtime.run({ program: 'import time\nwhile True: time.sleep(0.1)', bindings: [] })
    const disposed = fiber.dispose()
    const result = await pending
    await disposed
    // Whatever the run reports, it must be terminal and must not be a success.
    expect(result.value).toBeUndefined()
    expect(['abort', 'worker-exit', 'timeout']).toContain(result.error?.kind)
    // Disposal is to quiescence, so every directory this run staged is gone.
    const created = stagedDirs.slice(stagedBefore)
    for (const dir of created) expect(existsSync(dir)).toBe(false)
  }, 15_000)

  it('settles as abort when the signal fires in the same turn as the first run', async () => {
    // Same window, the other listener. `addEventListener('abort')` does not
    // replay an event that already fired, so an abort landing before the
    // listener was installed used to be missed entirely and the program ran to
    // success or the wall ceiling instead of resolving as `abort`. Synchronous
    // staging keeps the pre-flight check and the listener in one turn, leaving
    // no gap for the signal to slip through.
    const { runtime } = await setup({ maxWallMs: 4_000, graceMs: 200 })
    const controller = new AbortController()
    const pending = runtime.run({
      program: 'import time\nwhile True: time.sleep(0.1)',
      bindings: [],
      signal: controller.signal,
    })
    controller.abort('same-turn-abort')
    const result = await pending
    expect(result.error?.kind).toBe('abort')
    expect(result.error?.message).toContain('same-turn-abort')
  }, 15_000)

  it('reports a staging failure as worker-exit instead of rejecting run()', async () => {
    // Staging touches the filesystem, so it can fail for reasons that are not
    // the caller's doing: a full or read-only temp filesystem, or a deployment
    // that failed to ship the packaged scripts. Those are SUBSTRATE failures,
    // the same class as a child that cannot start, and the seam reserves
    // rejection for misuse — so `run()` must resolve, not throw.
    //
    // `TMPDIR` is the honest lever: `mkdtempSync` builds its path from
    // `os.tmpdir()`, so pointing it at a path that is not a directory makes the
    // real call fail without stubbing the module under test.
    const previous = process.env.TMPDIR
    const notADirectory = join(await makeTempDir('avn-staging-'), 'file')
    await writeFile(notADirectory, '')
    process.env.TMPDIR = notADirectory
    try {
      const { runtime } = await setup()
      const result = await runtime.run({ program: 'return 1', bindings: [] })
      expect(result.error?.kind).toBe('worker-exit')
      expect(result.error?.message).toContain('failed to stage the python bootstrap')
      expect(result.logs).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = previous
    }
  })

  it('leaves no staging directory behind when a script copy fails', async () => {
    // `mkdtempSync` succeeding and a later `copyFileSync` failing is its own
    // case: the directory exists but is only partially populated. Recording it
    // before the copies would leak it, because `run` retries staging on the next
    // call and overwrites the single recorded path — teardown could then remove
    // only the newest attempt. Staging must clean up its own partial directory.
    //
    // Only `copyFileSync` is stubbed, and only for the second script, so
    // `mkdtempSync` really runs and the directory under assertion is real.
    // The assertion checks the exact paths this test staged (see the sibling
    // disposal-race test for why a global tmpdir diff races parallel workers).
    const stagedBefore = stagedDirs.length
    failNextCopyOf.value = 'protocol.py'
    try {
      const { runtime } = await setup()
      const result = await runtime.run({ program: 'return 1', bindings: [] })
      expect(result.error?.kind).toBe('worker-exit')
      expect(result.error?.message).toContain('failed to stage the python bootstrap')
      // The partial directory is gone, so nothing accumulates across retries.
      for (const dir of stagedDirs.slice(stagedBefore)) expect(existsSync(dir)).toBe(false)
    } finally {
      failNextCopyOf.value = undefined
    }
  }, 15_000)
})
