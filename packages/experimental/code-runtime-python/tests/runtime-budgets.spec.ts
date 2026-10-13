import { existsSync, rmSync, statSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readProcessStart } from '../src/index.ts'
import type { CodeJsonValue, CodeRunResult } from '@aeven/code-runtime'
import { PYABS, cleanupTempFixtures, makeTempDir, setup, tools } from './harness.ts'

// Remove every fixture this file created, so repeated runs do not accumulate
// `avn-*` directories and wrappers in the shared tmpdir.
afterEach(cleanupTempFixtures)

describe('PythonCodeRuntime — process identity', () => {
  it('reads a live process start time and distinguishes it from an absent pid', () => {
    // The teardown guard signals `-child.pid` with a RAW `process.kill`, which
    // (unlike `child.kill()`) has no handle check, so it would reach a recycled
    // pgid during the window between the leader being reaped and `close` firing.
    // A pid alone cannot separate the original from its replacement -- both
    // answer `kill(pid, 0)` -- so the guard compares START TIME, and this pins
    // that the reading is stable for one process and absent for a pid that
    // cannot be read.
    const own = readProcessStart(process.pid)
    if (process.platform === 'linux') {
      // Same process, two reads: the identity must be stable, or the guard would
      // refuse to signal its own live group.
      expect(own).toBeDefined()
      expect(readProcessStart(process.pid)).toBe(own)
      // Pid 0 is never a readable /proc entry, so the guard degrades to
      // undefined rather than throwing on a teardown path. This is also the
      // reading a REAPED leader produces -- its /proc entry is gone while the
      // group it led can still hold survivors -- so `undefined` must NOT be
      // treated as an identity mismatch. Reading it as one refused the SIGKILL
      // that the same-group survivor tests depend on, which is why they went red
      // on Linux while passing on Darwin (where the reader always returns
      // undefined and the guard is inert).
      expect(readProcessStart(0)).toBeUndefined()
    } else {
      // Darwin has no /proc: the reader reports undefined, and `killGroup`
      // signals the pgid without the identity re-check instead of paying a `ps`
      // fork per signal.
      expect(own).toBeUndefined()
    }
  })
})

describe('PythonCodeRuntime — budgets, termination, disposal', () => {
  it('kills a wall-clock runaway program via SIGTERM/SIGKILL and reports timeout', async () => {
    const { runtime } = await setup({ maxWallMs: 500, graceMs: 200 })
    const start = Date.now()
    const result = await runtime.run({
      program: 'import time\nwhile True: time.sleep(1)',
      bindings: [],
    })
    const elapsed = Date.now() - start
    // The wall timer may fire first or the exit-after-signal may resolve; both are ok.
    expect(['timeout', 'worker-exit']).toContain(result.error?.kind)
    // We got somewhere in the neighborhood of maxWallMs, not the underlying `sleep(1)`.
    expect(elapsed).toBeLessThan(2000)
  }, 5000)

  it('aborts a run when the outer signal fires mid-flight', async () => {
    const { runtime } = await setup({ maxWallMs: 10_000 })
    const controller = new AbortController()
    const settled: Promise<CodeRunResult> = runtime.run({
      program: 'import time\nwhile True: time.sleep(0.1)',
      bindings: [],
      signal: controller.signal,
    })
    setTimeout(() => { controller.abort('outer-abort') }, 200)
    const result = await settled
    expect(['abort', 'worker-exit']).toContain(result.error?.kind)
  }, 5000)

  it('settles the run when a mid-flight abort reason cannot be converted', async () => {
    // The listener converted the reason before calling `finish()`, so a hostile
    // reason threw from inside an `AbortSignal` listener. Node reports that as an
    // uncaught exception — it can terminate the host — and `finish()` never ran,
    // so the run stayed live until the wall ceiling and misreported as `timeout`
    // (observed) instead of the caller's cancellation. `maxWallMs` is short so
    // that misreport is a fast assertion failure rather than a suite timeout.
    const uncaught: unknown[] = []
    const record = (error: unknown): void => { uncaught.push(error) }
    process.on('uncaughtException', record)
    try {
      const { runtime } = await setup({ maxWallMs: 4_000, graceMs: 200 })
      const controller = new AbortController()
      const settled: Promise<CodeRunResult> = runtime.run({
        program: 'import time\nwhile True: time.sleep(0.1)',
        bindings: [],
        signal: controller.signal,
      })
      setTimeout(() => {
        controller.abort({ [Symbol.toPrimitive]() { throw new Error('reason blew up') } })
      }, 200)
      const result = await settled
      expect(result.error?.kind).toBe('abort')
      expect(result.error?.message).toBe('<unrenderable rejection value>')
      expect(uncaught).toEqual([])
    } finally {
      process.off('uncaughtException', record)
    }
  }, 15_000)

  it('disposes to quiescence: an in-flight run resolves as abort and the child exits', async () => {
    const { fiber, runtime } = await setup({ maxWallMs: 10_000 })
    const pending = runtime.run({
      program: 'import time\nwhile True: time.sleep(0.1)',
      bindings: [],
    })
    // Give the process time to spawn and start running.
    await new Promise(resolve => setTimeout(resolve, 200))
    await fiber.dispose()
    const result = await pending
    expect(['abort', 'worker-exit']).toContain(result.error?.kind)
  }, 5000)

  it('reports an interpreter removed after load as worker-exit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'avn-python-removed-'))
    const pythonBin = join(dir, 'python3')
    await writeFile(pythonBin, `#!/bin/sh\nexec "${PYABS}" "$@"\n`, { mode: 0o755 })
    const { runtime, fiber } = await setup({ pythonBin, maxWallMs: 3000 })
    rmSync(pythonBin)
    try {
      const result = await runtime.run({ program: 'return 1', bindings: [] })
      expect(result.error?.kind).toBe('worker-exit')
    } finally {
      await fiber.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 8000)

  it('applies the strictest of the configured and inherited resource limits', async () => {
    // This case used to drive the bootstrap's `applying resource limits failed`
    // handler with `cpuSeconds: 2 ** 63`, asserting that a cap the child cannot
    // apply fails the run rather than running it uncapped. That premise no longer
    // holds, for two independent reasons, so the test now pins what is actually
    // guaranteed instead of a path no admissible input reaches.
    //
    // First, `2 ** 63` is not a safe integer, so it is now rejected at LOAD as a
    // configuration error — it can never reach the child at all. Second, even the
    // largest admissible values are applied successfully, because `_clamped`
    // bounds every requested pair by the inherited hard limit: an unprivileged
    // process may lower a hard limit but never raise one, so the child keeps the
    // stricter of the two rather than asking for something `setrlimit` refuses.
    // The failure handler remains as a substrate guard (a platform whose kernel
    // refuses the call for its own reasons), but it is no longer reachable from
    // configuration, and a test that pretends otherwise documents a contract the
    // code does not have.
    //
    // What is observable: a very large cap still yields a working run, and the
    // containment it promises is met by the inherited ceiling.
    const { runtime } = await setup({ cpuSeconds: Number.MAX_SAFE_INTEGER - 1, maxWallMs: 10_000 })
    const result = await runtime.run({ program: 'return 1', bindings: [] })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(1)
  }, 20_000)

  it('settles as worker-exit when the child exits before sending done (no hang)', async () => {
    // Regression: settlement must key off `close` (process reaped AND stdio
    // drained), not `exit`. With `exit`, finish() re-armed a second exit
    // listener that never fired — run() hung forever whenever the exit event
    // beat the final fd-3 data (deterministic on macOS, a lost race elsewhere).
    const { runtime } = await setup({ maxWallMs: 10_000 })
    const result = await runtime.run({
      program: 'import os\nos._exit(7)',
      bindings: [],
    })
    expect(result.error?.kind).toBe('worker-exit')
    expect(result.error?.message).toContain('code=7')
  }, 5000)

  it('classifies RLIMIT_CPU soft-limit expiry (SIGXCPU) as a timeout', async () => {
    // A CPU hot loop burns the soft limit; the kernel delivers SIGXCPU, whose
    // close signal the host maps to `timeout`. macOS re-delivers SIGXCPU
    // differently, so we assert only kind/message here — CI's darwin leg
    // validates real delivery. cpuSeconds must be an integer for setrlimit.
    const { runtime } = await setup({ cpuSeconds: 1, maxWallMs: 20_000 })
    const result = await runtime.run({
      program: 'while True: pass',
      bindings: [],
    })
    expect(result.error?.kind).toBe('timeout')
    expect(result.error?.message).toContain('CPU time exhausted')
  }, 8000)

  it('keeps an early self-inflicted SIGKILL a worker-exit, not a CPU timeout', async () => {
    // The unsolicited-SIGKILL-as-timeout classification applies only when the
    // CPU budget could have expired (wall time >= cpuSeconds). A SIGKILL
    // seconds before that (cgroup OOM, an operator, os.kill) is substrate
    // death and stays worker-exit per the orthogonal taxonomy.
    const { runtime } = await setup({ cpuSeconds: 60, maxWallMs: 10_000 })
    const result = await runtime.run({
      program: [
        'import os, signal',
        'os.kill(os.getpid(), signal.SIGKILL)',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('worker-exit')
    expect(result.error?.message).toContain('SIGKILL')
  })

  it('charges a forked descendant against the run CPU budget', async () => {
    // RLIMIT_CPU is per-process and every child inherits a FRESH budget, so a
    // program that shells out multiplies `cpuSeconds` by the number of
    // descendants it starts. Measured before the aggregate meter existed: with
    // cpuSeconds 1, two sequential busy children burned 2.0 CPU-seconds
    // (RUSAGE_CHILDREN) and the run still returned a SUCCESS completion. The
    // settle-time check meters RUSAGE_SELF + RUSAGE_CHILDREN and converts the
    // overrun into the same SIGXCPU the untrapped soft limit sends.
    const { runtime } = await setup({ cpuSeconds: 1, maxWallMs: 30_000 })
    const result = await runtime.run({
      program: [
        'import subprocess, sys',
        'for _ in range(2):',
        // The child spins on the CPU rather than on the clock, and its own
        // inherited soft RLIMIT_CPU is what stops it: a wall-clock loop's
        // contribution depends on how the host schedules it, so a busy host
        // could let a child exit before it had burned the second this case
        // charges.
        '    subprocess.run([sys.executable, "-c", "while True: pass"])',
        'return "escaped the cpu budget"',
      ].join('\n'),
      bindings: [],
    })
    // Darwin's SIGXCPU re-delivery differs, so accept either terminal
    // classification; what must NOT happen is the completion crossing.
    expect(['timeout', 'worker-exit']).toContain(result.error?.kind)
    expect(result.value).toBeUndefined()
  }, 40_000)

  it('does not charge wall time or a cheap descendant against the CPU budget', async () => {
    // The meter is CPU, not wall clock, and it must not fire on a child that
    // burns almost nothing: a sleeping program and a trivial subprocess both
    // have to complete normally, or the check would reject every program that
    // shells out.
    const { runtime } = await setup({ cpuSeconds: 1, maxWallMs: 30_000 })
    const slept = await runtime.run({
      program: 'import time\ntime.sleep(1.5)\nreturn "slept"',
      bindings: [],
    })
    expect(slept.error).toBeUndefined()
    expect(slept.value).toBe('slept')
    const cheap = await runtime.run({
      program: [
        'import subprocess, sys',
        'subprocess.run([sys.executable, "-c", "pass"])',
        'return "cheap child"',
      ].join('\n'),
      bindings: [],
    })
    expect(cheap.error).toBeUndefined()
    expect(cheap.value).toBe('cheap child')
  }, 40_000)

  it('spends no part of addressSpaceMb on bootstrap machinery', async () => {
    // RLIMIT_AS counts RESERVED address space, so anything the bootstrap maps
    // for its own accounting is subtracted from the program's `addressSpaceMb`.
    // A sampling thread for the descendant-CPU meter cost 72 MiB here (an 8 MiB
    // stack plus a 64 MiB glibc per-thread malloc arena reservation) and turned
    // the 2-million-entry dict rejection below into a MemoryError under a
    // 256 MiB cap on a slower runner. Assert the child's own mappings directly
    // rather than inferring the budget from a near-cap allocation, so the bound
    // is read from /proc instead of from how much headroom one machine happens
    // to have; 48 MiB is well above the ~30 MiB a bare interpreter maps and
    // well below the 102 MiB the thread produced. `addressSpaceMb` itself is
    // skipped on darwin (the dyld shared cache makes any practical cap
    // unsettable) and /proc/self/maps does not exist there, so the mapping
    // assertion is Linux-only; the completion path is checked everywhere.
    const { runtime } = await setup({ maxValueBytes: 4096, addressSpaceMb: 256 })
    const mapped = await runtime.run({
      program: [
        'import sys',
        'if sys.platform != "linux":',
        '    return 0',
        'total = 0',
        'with open("/proc/self/maps") as handle:',
        '    for line in handle:',
        '        low, high = (int(part, 16) for part in line.split(" ", 1)[0].split("-"))',
        '        total += high - low',
        'return total // (1024 * 1024)',
      ].join('\n'),
      bindings: [],
    })
    expect(mapped.error).toBeUndefined()
    expect(mapped.value).toBeLessThan(48)
  }, 20_000)

  it('spends no part of addressSpaceMb on the reply pump, across a binding await', async () => {
    // The test above measures BEFORE the program yields, so it could not see the
    // reply pump's cost: `loop.run_in_executor(None, read_frame)` created the
    // default executor's first thread on the first `await tools.*`, and that
    // thread's 8 MiB stack plus a 64 MiB glibc per-thread malloc arena are
    // charged to RLIMIT_AS while the limit is already in force — measured, the
    // child went from 30.34 MiB to 102.39 MiB across one binding call. Under a
    // small `addressSpaceMb` the thread cannot start and a legitimate call hangs
    // to `maxWallMs`; under a larger one an allocation that should have fit dies
    // as MemoryError. `loop.add_reader` watches the fd with no thread at all.
    //
    // Measuring both sides inside one run is what discriminates: a single
    // after-the-fact number cannot separate the pump's cost from the
    // interpreter's own footprint. Linux-only for the same reason as above.
    const { runtime } = await setup({ addressSpaceMb: 256, maxWallMs: 20_000 })
    const result = await runtime.run({
      program: [
        'import sys',
        'def mapped():',
        '    if sys.platform != "linux":',
        '        return 0',
        '    total = 0',
        '    with open("/proc/self/maps") as handle:',
        '        for line in handle:',
        '            low, high = (int(part, 16) for part in line.split(" ", 1)[0].split("-"))',
        '            total += high - low',
        '    return total // (1024 * 1024)',
        'before = mapped()',
        'echoed = await tools.echo({"ping": True})',
        'return {"before": before, "after": mapped(), "echoed": echoed}',
      ].join('\n'),
      bindings: tools({ echo: async args => args as CodeJsonValue }),
    })
    expect(result.error).toBeUndefined()
    const value = result.value as { before: number; after: number; echoed: unknown }
    // The binding call really happened, so the pump really ran.
    expect(value.echoed).toEqual({ ping: true })
    // Awaiting a binding maps nothing extra. The 8 MiB allowance absorbs ordinary
    // heap growth while staying far below the 72 MiB a pump thread cost.
    expect(value.after - value.before).toBeLessThan(8)
  }, 30_000)

  // Skipped on Darwin by name: the kernel hard-limit SIGKILL this case exists to
  // prove never arrives there, so the wall clock is what terminates the program
  // and the assertion below must accept both classifications. That leaves the
  // Darwin run proving only that a runaway dies on the wall — already owned by
  // the wall-clock case above — in exchange for 6 s of real waiting per run.
  // The Linux lane keeps the bar this case is written for.
  it.skipIf(process.platform === 'darwin')('still terminates a program that ignores SIGXCPU (hard-limit backstop)', async () => {
    // A hot loop under SIG_IGN burns through the soft limit; the kernel's
    // hard limit (cpuSeconds + 1) SIGKILLs it. Only a kernel-authoritative
    // SIGXCPU close classifies as the CPU timeout — a bare SIGKILL is
    // indistinguishable from a cgroup OOM kill, so it reports worker-exit.
    // Either way the run TERMINATES within the budget — the backstop holds
    // even when the classification is the opaque one.
    const { runtime } = await setup({ cpuSeconds: 1, maxWallMs: 6_000 })
    const result = await runtime.run({
      program: [
        'import signal',
        'signal.signal(signal.SIGXCPU, signal.SIG_IGN)',
        'while True: pass',
      ].join('\n'),
      bindings: [],
    })
    expect(['timeout', 'worker-exit']).toContain(result.error?.kind)
  }, 12_000)

  it('enforces the CPU budget even when the program monkeypatches the enforcement primitives', async () => {
    // The check uses import-time-captured references, so replacing
    // resource.getrusage / signal.signal / os.kill on the modules cannot
    // defang it: a trapping program that also swaps the callables and burns
    // past the budget still dies by the authoritative SIGXCPU.
    const { runtime } = await setup({ cpuSeconds: 1, maxWallMs: 15_000 })
    const result = await runtime.run({
      program: [
        'import signal, os, resource, time',
        'signal.signal(signal.SIGXCPU, lambda *a: None)',
        'resource.getrusage = lambda *a: (_ for _ in ()).throw(RuntimeError("nope"))',
        'os.kill = lambda *a: None',
        'signal.signal = lambda *a: None',
        'deadline = time.process_time() + 1.05',
        'while time.process_time() < deadline: pass',
        'return "escaped"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('timeout')
    expect(result.value).toBeUndefined()
  }, 15_000)

  it('re-delivers SIGXCPU when a trapping program returns inside the soft-to-hard gap', async () => {
    // A program can trap SIGXCPU and settle during the one-second gap; the
    // bootstrap re-checks the kernel CPU meter (getrusage) after settlement
    // and dies by SIGXCPU with the default disposition restored, so the host
    // still classifies the exhausted budget as a timeout instead of success.
    const { runtime } = await setup({ cpuSeconds: 1, maxWallMs: 15_000 })
    const result = await runtime.run({
      program: [
        'import signal, time',
        'fired = []',
        'signal.signal(signal.SIGXCPU, lambda *a: fired.append(1))',
        'deadline = time.process_time() + 1.05',
        'while time.process_time() < deadline: pass',
        'return "escaped"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('timeout')
    expect(result.error?.message).toContain('CPU time exhausted')
    expect(result.value).toBeUndefined()
  }, 15_000)

  it('enforces the CPU budget when the program rebinds the enforcer on __main__', async () => {
    // The bootstrap IS `__main__`, so `import __main__` reaches its globals.
    // The enforcement callable holds its primitives in closure cells (not
    // module attributes) and `_run` reads the callable into a frame local
    // before the program starts, so neither replacing the global nor swapping
    // the module's captured names changes what runs after settlement.
    const { runtime } = await setup({ cpuSeconds: 1, maxWallMs: 15_000 })
    const result = await runtime.run({
      program: [
        'import signal, time, __main__',
        'signal.signal(signal.SIGXCPU, lambda *a: None)',
        '__main__._DIE_IF_CPU_EXHAUSTED = lambda *_: None',
        'deadline = time.process_time() + 1.05',
        'while time.process_time() < deadline: pass',
        'return "escaped"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('timeout')
    expect(result.value).toBeUndefined()
  }, 15_000)

  it('bounds a program that defeats the post-check by writing its closure cell', async () => {
    // The closure-cell capture raises the cost of defeating the post-check; it
    // does NOT make it unreachable, and nothing in-process could: a cell is
    // writable through `fn.__closure__[i].cell_contents`, and `sys._getframe`
    // reads _run's frame locals. This program does exactly that — walks to
    // _run's frame, takes the enforcement callable, and replaces its captured
    // `getrusage` with one reporting zero CPU used — then burns past cpuSeconds
    // with SIGXCPU trapped. The run must still fail, because the bound that
    // model code cannot forge is outside the interpreter: the RLIMIT_CPU HARD
    // limit at cpuSeconds + 1, whose SIGKILL admits no handler. No success is
    // reportable either way.
    //
    // The ceiling is the subject on Darwin, where the wall clock and not the CPU
    // budget is what stops a tampering program (see the platform branch below),
    // so its value IS this case's cost there: 20 s spent to observe a `timeout`
    // that 5 s observes identically. Linux keeps the 20 s because RLIMIT_CPU is
    // charged in CPU time, which a loaded runner stretches into several seconds
    // of wall — the Linux assertion below allows up to 15 s.
    const maxWallMs = process.platform === 'linux' ? 20_000 : 5_000
    const { runtime } = await setup({ cpuSeconds: 1, maxWallMs })
    const start = Date.now()
    const result = await runtime.run({
      program: [
        'import signal, sys, time',
        'signal.signal(signal.SIGXCPU, lambda *a: None)',
        // Walk out of __avn_main__ to _run's frame and take its local.
        'die = None',
        'depth = 1',
        'while depth < 12:',
        '    frame = sys._getframe(depth)',
        '    if "die_if_cpu_exhausted" in frame.f_locals:',
        '        die = frame.f_locals["die_if_cpu_exhausted"]',
        '        break',
        '    depth += 1',
        'assert die is not None, "enforcer not reachable from the frame chain"',
        'class Zero:',
        '    ru_utime = 0.0',
        '    ru_stime = 0.0',
        'names = die.__code__.co_freevars',
        'die.__closure__[names.index("getrusage")].cell_contents = lambda *a: Zero()',
        // Burn well past the soft limit into the hard limit's SIGKILL.
        'while True: pass',
      ].join('\n'),
      bindings: [],
    })
    // What holds on EVERY platform: the tampering bought no success. The run
    // failed, carried no value, and the reported kind is one of the two
    // kernel-level outcomes — never a completion.
    expect(result.value).toBeUndefined()
    expect(result.error?.kind === 'worker-exit' || result.error?.kind === 'timeout').toBe(true)
    if (process.platform === 'linux') {
      // Linux enforces the RLIMIT_CPU HARD limit at cpuSeconds + 1 promptly, so
      // the CPU bound — not the 20 s wall ceiling — is what stops the program.
      // Its SIGKILL is not SIGXCPU, so the orthogonal-failure taxonomy reports
      // `worker-exit`: a bare SIGKILL is not evidence of CPU burn.
      expect(result.error?.kind).toBe('worker-exit')
      expect(Date.now() - start).toBeLessThan(15_000)
    } else {
      // Darwin does not deliver the hard limit's SIGKILL on the same schedule;
      // observed on the macOS lane, a program that patches the post-check runs
      // to the WALL ceiling instead. The CPU budget is therefore not the
      // binding constraint against a tampering program there — the wall clock
      // is. Asserted rather than skipped so the difference stays visible, and
      // the ceiling it runs to is shortened to the 5 s above: nothing in the
      // 2-20 s window changes this kind, because the SIGKILL that would report
      // `worker-exit` is what never arrives.
      expect(result.error?.kind).toBe('timeout')
    }
  }, 30_000)

  it('keeps a finished-but-not-closed run live so dispose awaits the child\'s death', async () => {
    // finish() no longer drops the run from `live`; settle() (at close) does.
    // A SIGTERM-trapping program with a small graceMs sits in the grace window
    // after finish() fires — dispose() must not resolve until the SIGKILL
    // backstop actually reaps the child. The program prints its pid (captured
    // as a log even on abort); once dispose() resolves, that pid must be dead
    // (process.kill(pid, 0) throws ESRCH).
    const { fiber, runtime } = await setup({ maxWallMs: 10_000, graceMs: 400 })
    // Deterministic readiness: the program reports its pid through a binding
    // AFTER installing the trap, so dispose cannot race the spawn (a fixed
    // sleep lost that race on slow CI runners — SIGTERM landed pre-trap).
    let reportedPid!: (pid: number) => void
    const trapReady = new Promise<number>((resolve) => { reportedPid = resolve })
    const pending = runtime.run({
      program: [
        'import signal, time, os',
        'signal.signal(signal.SIGTERM, lambda *a: None)',
        'await tools.ready({"pid": os.getpid()})',
        'while True: time.sleep(0.05)',
      ].join('\n'),
      bindings: tools({
        ready: async (args) => {
          reportedPid((args as { pid: number }).pid)
          return 'ok'
        },
      }),
    })
    const pid = await trapReady
    const start = Date.now()
    await fiber.dispose()
    const elapsed = Date.now() - start
    const result = await pending
    expect(['abort', 'worker-exit', 'timeout']).toContain(result.error?.kind)
    // dispose() returned only after the grace window elapsed (the SIGTERM trap
    // forces the SIGKILL backstop path), proving the run stayed live past finish().
    expect(elapsed).toBeGreaterThanOrEqual(300)
    expect(Number.isInteger(pid) && pid > 0).toBe(true)
    // The child is fully reaped by the time dispose() resolved.
    expect(() => process.kill(pid, 0)).toThrow(/ESRCH/)
  }, 8000)

  it('settles on the decided result even when a setsid-escaped orphan holds stdio open past close', async () => {
    // `close` only fires once every inherited stdio stream drains. A descendant
    // started with start_new_session=True escapes the child's process group, so
    // the SIGTERM/SIGKILL aimed at that group never reaches it; if it inherited
    // our stdout/stderr/fd 3 and outlives the run, `close` would never fire and
    // run() would hang forever. The close-deadline backstop (graceMs + margin)
    // must force settlement on the value the `done` frame already decided.
    const { runtime } = await setup({ graceMs: 100 })
    const start = Date.now()
    const result = await runtime.run({
      program: [
        'import subprocess, sys',
        // Orphan in a fresh session, inheriting our stdout/stderr/fd 3, alive
        // past the close-deadline so `close` cannot fire on its own. Its own
        // 5 s self-exit is the leak ceiling AND the discriminator: it must stay
        // ABOVE the < 4000 ms upper-bound assertion below, so if the deadline
        // backstop failed to settle, settlement could only come from this
        // self-exit at ~5 s and blow the bound — a sharper signal than the wall
        // ceiling would give.
        'subprocess.Popen([sys.executable, "-c", "import time; time.sleep(5)"],',
        '                 start_new_session=True)',
        'return "escaped"',
      ].join('\n'),
      bindings: [],
    })
    const elapsed = Date.now() - start
    // The done frame decided the value; the deadline settled it despite the
    // orphan pinning the pipes open.
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('escaped')
    // Settlement waited for the backstop (graceMs + CLOSE_REAP_MARGIN_MS ≈ 2.1s),
    // not the orphan's 5 s self-exit — proving the deadline, not a fallback, fired.
    expect(elapsed).toBeGreaterThanOrEqual(1_500)
    expect(elapsed).toBeLessThan(4_000)
  }, 8000)

  it('flushes a newline-free diagnostic when the closeDeadline forces settlement', async () => {
    // A leader that writes an unterminated diagnostic via `os.write(1, ...)` and
    // then exits, leaving a setsid orphan holding the pipes open, settles through
    // the closeDeadline destroy() path — which fires no `end`. The residual must
    // be flushed before destroy() drops it, or the diagnostic is lost from
    // `logs`. The value is decided by the done frame; the diagnostic must survive.
    const { runtime } = await setup({ graceMs: 100 })
    const result = await runtime.run({
      program: [
        'import os, subprocess, sys',
        'os.write(1, b"leader-diagnostic-no-newline")',
        'subprocess.Popen([sys.executable, "-c", "import time; time.sleep(5)"],',
        '                 start_new_session=True)',
        'return "escaped"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('escaped')
    expect(result.logs).toContain('leader-diagnostic-no-newline')
  }, 8000)

  it('closes the child stdin so a program read sees EOF instead of blocking', async () => {
    // The host closes the child's stdin write handle immediately after spawn
    // (the program is an async body that reads nothing from fd 0; a live pipe
    // would hold a host-side handle open past the run). A program that DOES
    // read fd 0 therefore sees EOF at once. Fail-before: with the handle left
    // open and no data written, `sys.stdin.read()` blocks and the run would
    // hang to maxWallMs as a timeout.
    const { runtime } = await setup({ maxWallMs: 8_000 })
    const result = await runtime.run({
      program: [
        'import sys',
        'data = sys.stdin.read()',
        'return "read: " + repr(data)',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe("read: ''")
  }, 15_000)

  it('keeps runtime type annotations as live classes, not PEP 563 strings, when the program reads them', async () => {
    // bootstrap.py imports `from __future__ import annotations`; without
    // dont_inherit=True on compile(), that PEP 563 flag leaks into the program's
    // compiled code and stringifies its type annotations, changing the semantics
    // of a legal program that reads `f.__annotations__` at runtime.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'def f(x: int) -> int:',
        '    return x',
        'return f.__annotations__["x"].__name__',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('int')
  }, 15_000)

  it('reaps a same-group child that ignores SIGTERM and releases the pipes before close', async () => {
    // The same-group counterpart to the setsid-orphan case above. A descendant
    // left in the child's OWN process group (no setsid, so `kill(-pid)` reaches
    // it) can ignore SIGTERM yet still release the inherited stdout/stderr/fd 3
    // it does not hold — here by giving the Popen child DEVNULL streams and
    // letting close_fds drop fd 3. The leader then writes `done` and exits, its
    // `close` fires because the pipes drained, and settle() runs while that
    // descendant is still alive. settle() then keeps a REF'd poll alive until the
    // grace-window SIGKILL has emptied the whole process group, so the host cannot
    // exit and reparent the survivor to init: no subprocess outlives the fiber.
    //
    // The descendant must have SIG_IGN installed BEFORE the host sends SIGTERM,
    // or it dies from the default SIGTERM whether the fix is present or not — so
    // it writes a readiness marker after trapping and the leader waits for that
    // marker before returning. While alive it bumps a heartbeat file every 50 ms;
    // the test asserts the heartbeat STOPS, which is what "no longer executing"
    // means whether the killed descendant is reaped or lingers as a zombie (a
    // SIGKILL'd process runs no more code either way). It sleeps 30 s as a safety
    // net so a broken fix cannot leak it forever.
    const handoff = await makeTempDir('avn-samegroup-')
    const readyMarker = join(handoff, 'ready')
    const heartbeat = join(handoff, 'heartbeat')
    const { runtime } = await setup({ maxWallMs: 10_000, graceMs: 300 })
    const result = await runtime.run({
      program: [
        'import subprocess, sys, os, time',
        `marker = ${JSON.stringify(readyMarker)}`,
        `heartbeat = ${JSON.stringify(heartbeat)}`,
        // Same group (no start_new_session); ignores SIGTERM; holds none of the
        // leader's pipes (DEVNULL std streams, close_fds drops fd 3). It writes
        // the marker (argv[1]) only AFTER the trap is installed — so the leader
        // cannot return, and the host cannot send SIGTERM, before it is ignored —
        // then rewrites the heartbeat (argv[2]) every 50 ms for up to 30 s.
        'code = ("import signal, sys, time\\n"',
        '        "signal.signal(signal.SIGTERM, signal.SIG_IGN)\\n"',
        '        "open(sys.argv[1], \'w\').close()\\n"',
        '        "end = time.time() + 30\\n"',
        '        "while time.time() < end:\\n"',
        '        "    open(sys.argv[2], \'w\').close()\\n"',
        '        "    time.sleep(0.05)\\n")',
        'child = subprocess.Popen([sys.executable, "-c", code, marker, heartbeat],',
        '                         stdin=subprocess.DEVNULL,',
        '                         stdout=subprocess.DEVNULL,',
        '                         stderr=subprocess.DEVNULL)',
        'deadline = time.time() + 5',
        'while not os.path.exists(marker) and time.time() < deadline:',
        '    time.sleep(0.02)',
        'return "spawned"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('spawned')
    // The trap really installed before the leader returned, so this is the
    // SIGTERM-ignoring descendant, not one that would have died to the default.
    expect(existsSync(readyMarker)).toBe(true)
    // The grace-window SIGKILL (graceMs 300 + reap margin) empties the group. Once
    // it has, the descendant stops bumping the heartbeat. Poll the heartbeat's
    // mtime: two consecutive reads far enough apart with no change means it is no
    // longer executing — true whether it was reaped or lingers as a zombie, so
    // the assertion holds in a container whose init does not wait() orphans. The
    // window (well under the 30 s self-timeout) proves the SIGKILL did the work.
    const mtime = (): number => { try { return statSync(heartbeat).mtimeMs } catch { return 0 } }
    const stopDeadline = Date.now() + 8_000
    let last = mtime()
    let still = false
    while (Date.now() < stopDeadline) {
      await new Promise(resolve => setTimeout(resolve, 400))
      const now = mtime()
      if (now === last && now !== 0) { still = true; break }
      last = now
    }
    expect(still).toBe(true)
  }, 20_000)

  it('dispose awaits reaping of a same-group survivor from a completed run', async () => {
    // The quiescence contract also holds for a run that ALREADY resolved: the run
    // stays tracked in `live` until its process group is reaped, so a `dispose()`
    // that races a just-returned run() still awaits the survivor rather than
    // snapshotting an empty `live` and returning while it lives. Here the run
    // completes (leaving a SIGTERM-ignoring same-group descendant), then dispose()
    // is called; the heartbeat must be stale BY THE TIME dispose() resolves —
    // proving teardown waited for the reap, not merely that the reap eventually
    // happened.
    const handoff = await makeTempDir('avn-dispose-quiesce-')
    const readyMarker = join(handoff, 'ready')
    const heartbeat = join(handoff, 'heartbeat')
    const { runtime, fiber } = await setup({ maxWallMs: 10_000, graceMs: 300 })
    const result = await runtime.run({
      program: [
        'import subprocess, sys, os, time',
        `marker = ${JSON.stringify(readyMarker)}`,
        `heartbeat = ${JSON.stringify(heartbeat)}`,
        'code = ("import signal, sys, time\\n"',
        '        "signal.signal(signal.SIGTERM, signal.SIG_IGN)\\n"',
        '        "open(sys.argv[1], \'w\').close()\\n"',
        '        "end = time.time() + 30\\n"',
        '        "while time.time() < end:\\n"',
        '        "    open(sys.argv[2], \'w\').close()\\n"',
        '        "    time.sleep(0.05)\\n")',
        'child = subprocess.Popen([sys.executable, "-c", code, marker, heartbeat],',
        '                         stdin=subprocess.DEVNULL,',
        '                         stdout=subprocess.DEVNULL,',
        '                         stderr=subprocess.DEVNULL)',
        'deadline = time.time() + 5',
        'while not os.path.exists(marker) and time.time() < deadline:',
        '    time.sleep(0.02)',
        'return "spawned"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(existsSync(readyMarker)).toBe(true)
    // dispose() must not return until the group is reaped. After it resolves, the
    // heartbeat must already be stale: read its mtime, wait past the heartbeat
    // interval, and confirm it did not advance — the descendant is no longer
    // executing (reaped or zombie), so teardown was genuinely quiescent.
    await fiber.dispose()
    const mtime = (): number => { try { return statSync(heartbeat).mtimeMs } catch { return 0 } }
    const afterDispose = mtime()
    // Pin the assertion to a heartbeat that actually ran: mtime() returns 0 when
    // the file never existed, so without this the `toBe` below would pass
    // vacuously (0 === 0) if the survivor never wrote a heartbeat at all.
    expect(afterDispose).toBeGreaterThan(0)
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(mtime()).toBe(afterDispose)
  }, 20_000)

  it('sends SIGKILL at the poll deadline when the event loop was blocked past both timers', async () => {
    // If the host event loop is blocked (a big synchronous computation) from
    // before the group-reap poll was scheduled until after the deadline, both the
    // poll timer and the grace-window SIGKILL timer are overdue when the loop
    // resumes. Node runs the earlier-scheduled poll first, so the SIGKILL timer
    // may not have fired yet. The deadline arm must then send SIGKILL ITSELF
    // rather than cancel the unfired escalation — otherwise a SIGTERM-ignoring
    // same-group survivor is released for good. A synchronous busy-loop after
    // run() resolves reproduces the block deterministically.
    const handoff = await makeTempDir('avn-deadline-')
    const readyMarker = join(handoff, 'ready')
    const heartbeat = join(handoff, 'heartbeat')
    const graceMs = 300
    const { runtime } = await setup({ maxWallMs: 10_000, graceMs })
    const result = await runtime.run({
      program: [
        'import subprocess, sys, os, time',
        `marker = ${JSON.stringify(readyMarker)}`,
        `heartbeat = ${JSON.stringify(heartbeat)}`,
        'code = ("import signal, sys, time\\n"',
        '        "signal.signal(signal.SIGTERM, signal.SIG_IGN)\\n"',
        '        "open(sys.argv[1], \'w\').close()\\n"',
        '        "end = time.time() + 30\\n"',
        '        "while time.time() < end:\\n"',
        '        "    open(sys.argv[2], \'w\').close()\\n"',
        '        "    time.sleep(0.05)\\n")',
        'child = subprocess.Popen([sys.executable, "-c", code, marker, heartbeat],',
        '                         stdin=subprocess.DEVNULL,',
        '                         stdout=subprocess.DEVNULL,',
        '                         stderr=subprocess.DEVNULL)',
        'deadline = time.time() + 5',
        'while not os.path.exists(marker) and time.time() < deadline:',
        '    time.sleep(0.02)',
        'return "spawned"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(existsSync(readyMarker)).toBe(true)
    // Block the event loop synchronously past graceMs + CLOSE_REAP_MARGIN_MS
    // (2000) with margin, so both timers are overdue when the loop resumes.
    const blockUntil = Date.now() + graceMs + 2_000 + 800
    while (Date.now() < blockUntil) { /* busy-wait, no yield */ }
    // Yield: the overdue poll runs (group still non-empty, deadline passed) and
    // must send SIGKILL itself. The survivor then stops bumping the heartbeat.
    const mtime = (): number => { try { return statSync(heartbeat).mtimeMs } catch { return 0 } }
    const stopDeadline = Date.now() + 5_000
    let last = mtime()
    let stopped = false
    while (Date.now() < stopDeadline) {
      await new Promise(resolve => setTimeout(resolve, 400))
      const now = mtime()
      if (now === last && now !== 0) { stopped = true; break }
      last = now
    }
    expect(stopped).toBe(true)
  }, 20_000)
})
