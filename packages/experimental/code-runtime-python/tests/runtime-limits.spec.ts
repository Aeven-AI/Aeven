import { rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PYABS, cleanupTempFixtures, makeTempDir, setup, tempFiles } from './harness.ts'

// Remove every fixture this file created, so repeated runs do not accumulate
// `avn-*` directories and wrappers in the shared tmpdir.
afterEach(cleanupTempFixtures)

describe('PythonCodeRuntime — inherited resource limits', () => {
  // Darwin deliberately does not apply RLIMIT_AS, and its shell rejects `ulimit -v`.
  it.skipIf(process.platform === 'darwin')('runs under an inherited hard limit tighter than addressSpaceMb', async () => {
    // An unprivileged process may lower a hard rlimit but never raise it. Under
    // a harness started with `ulimit -v` below `addressSpaceBytes`, requesting
    // the configured cap made `setrlimit` raise `ValueError` and every run
    // returned a bootstrap exception — even though the inherited limit is
    // STRONGER than the one asked for. The bootstrap clamps to the inherited
    // hard limit instead, so the run proceeds under the stricter bound.
    //
    // `pythonBin` is the honest lever: a wrapper that lowers RLIMIT_AS and then
    // execs the real interpreter reproduces the inherited-limit condition
    // without touching this test process's own limits.
    const dir = await makeTempDir('avn-rlimit-')
    const wrapper = join(dir, 'python3-capped')
    // 256 MiB, half the 512 MiB addressSpaceMb default, so the requested cap is
    // unambiguously above the inherited ceiling.
    await writeFile(wrapper, `#!/bin/sh\nulimit -v 262144\nexec "${PYABS}" "$@"\n`, { mode: 0o755 })
    const { runtime } = await setup({ pythonBin: wrapper })
    const result = await runtime.run({
      program: 'import resource\nreturn resource.getrlimit(resource.RLIMIT_AS)[1]',
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    // The applied hard limit is the inherited one, not the configured 512 MiB.
    expect(result.value).toBe(256 * 1024 * 1024)
  }, 15_000)

  it('rejects at boot when an inherited RLIMIT_AS is too tight for the output budgets', async () => {
    // The host gate validates the output budgets against the CONFIGURED
    // addressSpaceMb, but a launch environment can inherit a STRICTER RLIMIT_AS
    // (a `ulimit -v` wrapper below addressSpaceMb), which the bootstrap clamps the
    // effective limit down to — leaving the budgets sized for a ceiling the child
    // never gets, so a near-budget output would OOM mid-run as an opaque
    // worker-exit. The bootstrap re-checks both budgets against the EFFECTIVE
    // clamped limit and fails loud at boot instead. A 128 MiB inherited limit
    // leaves 64 MiB budgetable (~5 MiB admissible under the 12x multiple), under
    // which a 32 MiB maxLogBytes — admitted by the 512 MiB configured default — is
    // rejected. The rejection surfaces as an 'exception' (bootstrap's
    // setrlimit-phase failure class), not a mid-run OOM. The repro is Linux-only
    // (macOS ignores `ulimit -v`); there the run proceeds.
    const dir = await makeTempDir('avn-rlimit-')
    const wrapper = join(dir, 'python3-tight')
    await writeFile(wrapper, `#!/bin/sh\nulimit -v 131072\nexec "${PYABS}" "$@"\n`, { mode: 0o755 })
    const { runtime } = await setup({ pythonBin: wrapper, maxLogBytes: 32 * 1024 * 1024, addressSpaceMb: 512 })
    const result = await runtime.run({ program: 'return 1', bindings: [] })
    if (process.platform === 'darwin') {
      expect(result.error).toBeUndefined()
    } else {
      // The re-check raises inside bootstrap's resource-limit block, which
      // reports every setrlimit-phase failure as kind 'exception'; the message
      // discriminates this config rejection from a generic setrlimit error.
      expect(result.error?.kind).toBe('exception')
      expect(result.error?.message).toContain('too large for the inherited RLIMIT_AS')
    }
  }, 15_000)

  // The expected tuple includes RLIMIT_AS, which the backend deliberately skips on Darwin.
  it.skipIf(process.platform === 'darwin')('applies the configured limits when nothing tighter is inherited', async () => {
    // The clamp must not weaken the normal path: with an infinite inherited hard
    // limit there is nothing to clamp against, and RLIM_INFINITY compares as -1,
    // so treating it as a numeric bound would collapse every limit to -1.
    const { runtime } = await setup({ cpuSeconds: 42, addressSpaceMb: 400 })
    const result = await runtime.run({
      // `getrlimit` returns a tuple, which the lossless-JSON completion check
      // rejects; the pair is listed explicitly rather than converted.
      program: [
        'import resource, sys',
        'cpu = resource.getrlimit(resource.RLIMIT_CPU)',
        'address_space = None if sys.platform == "darwin" else resource.getrlimit(resource.RLIMIT_AS)[1]',
        'return {"cpu": [cpu[0], cpu[1]], "addressSpace": address_space}',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    // Darwin deliberately skips RLIMIT_AS; every other Unix host applies the
    // configured bytes alongside the CPU soft/hard pair.
    expect(result.value).toEqual({
      cpu: [42, 43],
      addressSpace: process.platform === 'darwin' ? null : 400 * 1024 * 1024,
    })
  }, 15_000)

  it('preserves an inherited soft limit stricter than the configured cap', async () => {
    // Clamping reads BOTH inherited bounds, not just the hard one. A deployment
    // that inherited a soft rlimit below the configured cap must keep that
    // stricter soft: returning the configured value would RAISE the effective
    // soft limit, loosening containment. The wrapper lowers only the SOFT CPU
    // limit (`ulimit -S -t`) and leaves the hard limit unlimited, so the
    // requested soft (`cpuSeconds`) sits above the inherited soft — the case that
    // exposed the bug. RLIMIT_CPU is used because macOS ignores `ulimit -v`
    // (RLIMIT_AS), which is exactly why the backend skips address space there.
    const dir = await makeTempDir('avn-rlimit-soft-')
    const wrapper = join(dir, 'python3-soft-capped')
    // Soft CPU 5 s, well below the configured 30 s, hard left unlimited.
    await writeFile(wrapper, `#!/bin/sh\nulimit -S -t 5\nexec "${PYABS}" "$@"\n`, { mode: 0o755 })
    const { runtime } = await setup({ pythonBin: wrapper, cpuSeconds: 30 })
    const result = await runtime.run({
      program: 'import resource\nreturn resource.getrlimit(resource.RLIMIT_CPU)[0]',
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    // The applied SOFT limit is the inherited 5 s, not the configured 30 s.
    expect(result.value).toBe(5)
  }, 15_000)

  it('reports a CPU overrun under a dual-limit ulimit as a timeout, not a worker-exit', async () => {
    // `ulimit -t N` sets BOTH the soft and hard CPU limit to N. The kernel
    // checks the hard limit and SIGKILLs a busy loop directly, so with
    // soft == hard the SIGXCPU signal is never delivered — and the host
    // classifies a CPU overrun ONLY on `signal === 'SIGXCPU'`, so the overrun
    // would be misreported as a `worker-exit` instead of a timeout. `_clamped`
    // now lowers a clamped soft==hard result by one unit (when hard >= 2), so
    // the SIGXCPU signal fires at the softer limit and the run reports a
    // timeout. This uses `ulimit -t 2` (hard == 2, so the soft is lowered to 1)
    // and leaves SIGXCPU unhandled, so the kernel terminates the busy loop at
    // 1 s with SIGXCPU and the host classifies it as a timeout.
    const dir = await makeTempDir('avn-rlimit-dual-')
    const wrapper = join(dir, 'python3-dual-capped')
    // Both soft and hard CPU 2 s; configured cpuSeconds 30 s.
    await writeFile(wrapper, `#!/bin/sh\nulimit -t 2\nexec "${PYABS}" "$@"\n`, { mode: 0o755 })
    const { runtime } = await setup({ pythonBin: wrapper, cpuSeconds: 30, maxWallMs: 12_000 })
    const result = await runtime.run({
      program: [
        'while True:',
        '    pass',
        'return "unreachable"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('timeout')
    expect(result.error?.message).toContain('CPU time exhausted')
  }, 15_000)

  it('reports a timeout when a program masks SIGXCPU and returns past the soft limit', async () => {
    // A program can mask SIGXCPU (pthread_sigmask SIG_BLOCK), burn past the
    // soft CPU limit, and return during the soft-to-hard gap. The settlement
    // recheck (`die_if_cpu_exhausted`) must UNBLOCK the signal before
    // re-delivering it, or the SIGXCPU stays pending and the child exits
    // normally with a success result. With the unblock, the re-delivered
    // SIGXCPU (default disposition) terminates the child and the host
    // classifies the run as a timeout. Fail-before: without the unblock the
    // run reports `value: "escaped"` and no error. The masking is guarded by
    // hasattr so the case is a no-op on platforms without pthread_sigmask.
    const { runtime } = await setup({ cpuSeconds: 1, maxWallMs: 12_000 })
    const result = await runtime.run({
      program: [
        'import signal, time',
        'if hasattr(signal, "pthread_sigmask"):',
        '    signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGXCPU})',
        'end = time.process_time() + 1.05',
        'while time.process_time() < end:',
        '    pass',
        'return "escaped"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('timeout')
    expect(result.value).toBeUndefined()
  }, 20_000)

  it('reports a timeout when the interpreter was started with SIGXCPU ignored (inherited state)', async () => {
    // The child inherits the host's SIGXCPU disposition: a wrapper that
    // ignores SIGXCPU before exec'ing python3 hands the child a soft
    // RLIMIT_CPU that cannot stop it. The bootstrap resets SIGXCPU to SIG_DFL
    // before model code runs, so a busy loop still ends as a timeout rather
    // than running to the hard limit and being misclassified as worker-exit.
    const wrapper = join(tmpdir(), `avn-xcpu-ignore-${process.pid}.sh`)
    tempFiles.push(wrapper)
    writeFileSync(wrapper, `#!/bin/sh\ntrap "" XCPU\nexec "${PYABS}" "$@"\n`, { mode: 0o755 })
    try {
      const { runtime } = await setup({ maxWallMs: 30_000, cpuSeconds: 1, pythonBin: wrapper })
      const result = await runtime.run({
        program: ['while True: pass'].join('\n'),
        bindings: [],
      })
      expect(result.error?.kind).toBe('timeout')
    } finally {
      rmSync(wrapper, { force: true })
    }
  }, 20_000)

  it('reports a timeout when a program traps AND masks SIGXCPU and returns past the soft limit', async () => {
    // The mask-only case exercises the unblock; the trap+mask combination is
    // the harder one: a program that installed a custom handler AND masked the
    // signal has that PENDING handler run the moment the signal is unblocked
    // (CPython delivers it at the next eval-breaker checkpoint in model code),
    // and the handler re-masks — so the settlement recheck must restore the
    // default disposition BEFORE unblocking. With SIG_DFL restored first, the
    // pending signal kills the process inside the kernel with no bytecode
    // window; without it, the handler re-blocks and the child exits normally
    // with a success value. Fail-before: the run reports `value: "escaped"`.
    const { runtime } = await setup({ cpuSeconds: 1, maxWallMs: 12_000 })
    const result = await runtime.run({
      program: [
        'import signal, time',
        'if hasattr(signal, "pthread_sigmask"):',
        '    def h(signum, frame):',
        '        signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGXCPU})',
        '    signal.signal(signal.SIGXCPU, h)',
        '    signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGXCPU})',
        '    end = time.process_time() + 1.05',
        '    while time.process_time() < end:',
        '        pass',
        'return "escaped"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('timeout')
    expect(result.value).toBeUndefined()
  }, 20_000)

  it('rechecks CPU at settlement against the effective inherited soft limit', async () => {
    // The settlement-time CPU recheck must compare against the EFFECTIVE soft
    // limit (`_clamped` may have lowered it to a stricter inherited value), not
    // the configured `cpuSeconds`. A program that traps SIGXCPU, burns past the
    // inherited soft, and returns inside the soft-to-hard gap would otherwise be
    // compared to the configured value and falsely reported successful, bypassing
    // the inherited limit. The wrapper sets a 1 s soft CPU limit; the program
    // traps SIGXCPU and busy-loops past it, then returns — the recheck must
    // re-deliver SIGXCPU so the host classifies the run as a timeout.
    const dir = await makeTempDir('avn-cpu-recheck-')
    const wrapper = join(dir, 'python3-cpu-capped')
    await writeFile(wrapper, `#!/bin/sh\nulimit -S -t 1\nexec "${PYABS}" "$@"\n`, { mode: 0o755 })
    const { runtime } = await setup({ pythonBin: wrapper, cpuSeconds: 30, maxWallMs: 12_000 })
    const result = await runtime.run({
      program: [
        'import signal, time',
        // Trap SIGXCPU so the soft limit does not terminate the program; burn
        // CPU past the inherited 1 s soft, then return normally. `process_time`
        // is CPU time, so 1.5 s of it is deterministic under any contention —
        // what the recheck compares is unaffected by how long that took in wall.
        'signal.signal(signal.SIGXCPU, lambda *a: None)',
        'end = time.process_time() + 1.5',
        'while time.process_time() < end:',
        '    pass',
        'return "returned"',
      ].join('\n'),
      bindings: [],
    })
    // The recheck compares spent CPU against the effective 1 s soft, not 30 s, so
    // the run is a timeout rather than a false success.
    expect(result.error?.kind).toBe('timeout')
  }, 20_000)
})
