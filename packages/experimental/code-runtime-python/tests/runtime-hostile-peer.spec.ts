import { afterEach, describe, expect, it } from 'vitest'
import { logTruncationMarker } from '../src/protocol.ts'
import type { CodeJsonValue, CodeRunResult } from '@aeven/code-runtime'
import { cleanupTempFixtures, setup, tools } from './harness.ts'

// Remove every fixture this file created, so repeated runs do not accumulate
// `avn-*` directories and wrappers in the shared tmpdir.
afterEach(cleanupTempFixtures)

describe('PythonCodeRuntime — hostile peer', () => {
  it('drops garbage bytes and unknown-shape frames posted directly to fd 3', async () => {
    // The model program can reach fd 3 and write anything. We inject a
    // non-JSON line, a valid JSON but unknown-shape frame, and a broken done
    // frame; the host must not crash, and the real `done` still settles the run.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import os',
        'os.write(3, b"not-json\\n")',
        'os.write(3, b\'{"type":"unknown"}\\n\')',
        'os.write(3, b\'{"type":"done","error":{"message":42}}\\n\')',
        'return "survived"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('survived')
  })

  it('answers a forged call frame for an unknown binding and never crashes', async () => {
    // The unknown-binding reply path, driven through the id the host expects:
    // the program lets its own first call claim id 0 and forges id 1, which the
    // host answers with the `unknown binding` rejection the honest call would
    // have received. A forged id out of sequence is dropped instead — that is
    // the id-bound test below, not this one.
    const { runtime } = await setup({ maxWallMs: 8_000 })
    let seenLegitCall = false
    const result = await runtime.run({
      program: [
        'import os, json',
        'x = await tools.echo({"ping": True})',
        'os.write(3, json.dumps({"type":"call","id":1,"global":"tools","name":"forged","args":{}}).encode() + b"\\n")',
        // The forged frame is answered, but nothing in the child awaits id 1, so
        // the reply is ignored and the run completes on its own value.
        'return x',
      ].join('\n'),
      bindings: tools({
        echo: async (args) => { seenLegitCall = true; return args as CodeJsonValue },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({ ping: true })
    expect(seenLegitCall).toBe(true)
  }, 15_000)

  it('caps the unknown-binding preview for a huge forged name', async () => {
    // The unknown-binding reply's JSON.stringify ran on the WHOLE capped
    // target, allocating the escaped form — up to ~6x under control-heavy
    // input. The preview is now built from a 1 KiB prefix, so a forged call
    // with a huge global/name cannot spike host memory near the value ceiling;
    // the reply still identifies the binding.
    const { runtime } = await setup({ maxWallMs: 8_000, maxValueBytes: 1024 * 1024 })
    const result = await runtime.run({
      program: [
        'import os, json',
        'x = await tools.echo({"ping": True})',
        'name = "n" * 100000',
        'os.write(3, json.dumps({"type":"call","id":1,"global":"tools","name":name,"args":{}}).encode() + b"\\n")',
        'return x',
      ].join('\n'),
      bindings: tools({
        echo: async args => args as CodeJsonValue,
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({ ping: true })
  }, 15_000)

  it('drops forged call frames whose ids are not the next in sequence, retaining no per-id state', async () => {
    // The host used to remember every answered id in a Set, so a program could
    // write an unbounded run of unique forged ids — each frame far below the
    // 64 MiB cap, so nothing rejected them — and grow host memory for the
    // whole run. Ids are consecutive from 0, so one counter replaces the set.
    //
    // The discriminator is that the forgeries must not be answered. Each names a
    // binding that does exist, so a host answering them would run `echo` once
    // per forgery; the count proves only the legitimate call was dispatched.
    // Ids also run DESCENDING, so a high-water-mark test would drop the honest
    // call that follows rather than the forgeries.
    const { runtime } = await setup()
    let echoCalls = 0
    const result = await runtime.run({
      program: [
        'import os, json',
        'for i in range(2000, 0, -1):',
        '    os.write(3, json.dumps({"type":"call","id":i,"global":"tools","name":"echo","args":{"forged":i}}).encode() + b"\\n")',
        'x = await tools.echo({"ping": True})',
        'return x',
      ].join('\n'),
      bindings: tools({
        echo: async (args) => { echoCalls += 1; return args as CodeJsonValue },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({ ping: true })
    expect(echoCalls).toBe(1)
  }, 15_000)

  it('keeps answering calls a program makes after one with unserializable arguments', async () => {
    // The child claims an id only once its write succeeds, so a call rejected
    // child-side for non-lossless arguments leaves no gap. Were a gap possible,
    // the host's exact-successor test would drop every later call and the run
    // would hang to the wall ceiling instead of completing.
    const { runtime } = await setup({ maxWallMs: 8_000 })
    const seen: unknown[] = []
    const result = await runtime.run({
      program: [
        'caught = ""',
        'try:',
        '    await tools.echo({"bad": float("inf")})',
        'except RuntimeError as e:',
        '    caught = str(e)',
        'after = await tools.echo({"ok": True})',
        'return {"caught": caught, "after": after}',
      ].join('\n'),
      bindings: tools({
        echo: async (args) => { seen.push(args); return args as CodeJsonValue },
      }),
    })
    expect(result.error).toBeUndefined()
    const value = result.value as { caught: string; after: unknown }
    expect(value.caught).toContain('lossless JSON')
    expect(value.after).toEqual({ ok: true })
    // The rejected call never reached the host; the one after it did.
    expect(seen).toEqual([{ ok: true }])
  }, 15_000)

  it('drops a forged frame carrying an integer outside JavaScript safe range', async () => {
    // JSON.parse would silently round 9007199254740993 to ...992 BEFORE any
    // validation, corrupting a dispatched argument or completion. The host
    // scans the raw line and drops such frames as hostile traffic; the honest
    // child cannot produce one (its validator rejects unsafe ints).
    const { runtime } = await setup()
    let dispatched: unknown
    const result = await runtime.run({
      program: [
        'import os',
        // Forged call frame with an unsafe int argument, then a forged done
        // frame with an unsafe int value — both must be dropped whole.
        'os.write(3, b\'{"type":"call","id":7,"global":"tools","name":"echo","args":9007199254740993}\\n\')',
        'os.write(3, b\'{"type":"done","value":9007199254740993}\\n\')',
        'x = await tools.echo({"ok": True})',
        'return x',
      ].join('\n'),
      bindings: tools({
        echo: async (args) => { dispatched = args; return args as CodeJsonValue },
      }),
    })
    expect(result.error).toBeUndefined()
    // The forged done did not settle the run; the legit call and completion did.
    expect(result.value).toEqual({ ok: true })
    expect(dispatched).toEqual({ ok: true })
  })

  it('truncates host-side logs once the budget is exhausted and emits the marker', async () => {
    // Set a tiny host-side budget; the Python side has a much larger one, so
    // its LogBuffer will not truncate — the host ledger fires first.
    const { runtime } = await setup({ maxLogBytes: 128 })
    const result = await runtime.run({
      program: [
        'for _ in range(50):',
        '    print("aaaaaaaaaa")',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    const markers = result.logs.filter(line => line.includes('log capture truncated at 128 bytes'))
    expect(markers.length).toBeGreaterThanOrEqual(1)
  })

  it('reports an exception whose message holds an unpaired surrogate instead of stranding to the wall clock', async () => {
    // A strict UTF-8 encode of "\ud800" throws while BUILDING the failure
    // frame; the run would then hang to maxWallMs and misreport as timeout.
    const { runtime } = await setup({ maxWallMs: 8_000 })
    const result = await runtime.run({
      program: String.raw`raise Exception("bad \ud800 surrogate")`,
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.message).toContain('bad')
    expect(result.error?.message).toContain('surrogate')
  })

  it('carries a lone-surrogate completion string across the wire as its JSON escape', async () => {
    // UTF-8 has no encoding for a lone surrogate, but JSON does: the ASCII
    // `\ud800` escape, which JSON.parse reads back as the same UTF-16 code
    // unit. `CodeJsonValue`, `snapshotJsonValue`, and the worker backend all
    // accept such a string, so this backend must not narrow the shared seam.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: String.raw`return {"lone": "a\ud800b", "spelled": "😀"}`,
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    // The lone half survives as the code unit itself; a spelled-out high-low
    // PAIR folds into the astral character the host would hold for it.
    expect(result.value).toEqual({ lone: 'a\ud800b', spelled: '\u{1f600}' })
  })

  it('meters a lone surrogate at its six escaped bytes, matching the host', async () => {
    // The child and the host share maxValueBytes, so the child must charge the
    // escape's six ASCII bytes (plus two quotes): eight fits, nine does not.
    const { runtime } = await setup({ maxValueBytes: 8 })
    const ok = await runtime.run({ program: String.raw`return "\ud800"`, bindings: [] })
    expect(ok.error).toBeUndefined()
    expect(ok.value).toBe('\ud800')
    const over = await setup({ maxValueBytes: 7 })
    const result = await over.runtime.run({ program: String.raw`return "\ud800"`, bindings: [] })
    expect(result.error?.kind).toBe('output-limit')
  })

  it('meters a surrogate-dense completion by counting, not by materializing a match list', async () => {
    // `_json_str_cost` counted lone surrogates with `_SURROGATE.findall`,
    // which materializes one single-character string PER surrogate: a
    // surrogate-dense value near the budget (each surrogate serializes to six
    // bytes, so a budget-sized value holds millions of them) would allocate
    // millions of objects before the meter returned — an O(N)-objects spike
    // that defeats the meter's documented contract of counting without
    // building. The count is now a length difference over the removal `sub`
    // already performs. Three million lone surrogates pin the boundary at
    // scale: 18,000,002 serialized bytes succeed at an 18,000,002 budget and
    // report output-limit one byte under, proving the meter counts every
    // surrogate exactly rather than dropping or over-charging any.
    const { runtime } = await setup({ maxValueBytes: 18_000_002 })
    const ok = await runtime.run({ program: 'return "\\ud800" * 3000000', bindings: [] })
    expect(ok.error).toBeUndefined()
    expect(ok.value).toBe('\ud800'.repeat(3_000_000))
    const over = await setup({ maxValueBytes: 18_000_001 })
    const result = await over.runtime.run({ program: 'return "\\ud800" * 3000000', bindings: [] })
    expect(result.error?.kind).toBe('output-limit')
  }, 60_000)

  it('passes a lone-surrogate binding argument through instead of failing the call', async () => {
    // The argument validator shared the same over-narrow rejection; a host
    // binding must receive the code unit the program passed.
    const seen: unknown[] = []
    const { runtime } = await setup()
    const result = await runtime.run({
      program: String.raw`return await tools.echo({"text": "x\udfff"})`,
      bindings: tools({ echo: async (args: unknown) => { seen.push(args); return args as CodeJsonValue } }),
    })
    expect(result.error).toBeUndefined()
    expect(seen).toEqual([{ text: 'x\udfff' }])
    expect(result.value).toEqual({ text: 'x\udfff' })
  })

  it('meters a non-ASCII completion in UTF-8 JSON bytes, matching the host', async () => {
    // json.dumps' default \uXXXX escaping would count "é" as 8 bytes while
    // the host meter counts its UTF-8 JSON form (4); the shared budget must
    // agree, so a 4-byte-fitting value passes a maxValueBytes of 4.
    const { runtime } = await setup({ maxValueBytes: 4 })
    const ok = await runtime.run({ program: 'return "é"', bindings: [] })
    expect(ok.error).toBeUndefined()
    expect(ok.value).toBe('é')
    const over = await runtime.run({ program: 'return "éx"', bindings: [] })
    expect(over.error?.kind).toBe('output-limit')
  })

  it('filters bootstrap frames from exception-group members (TaskGroup)', async () => {
    // Python 3.11+ stores member stacks under TracebackException.exceptions;
    // the <model>-frame filter must recurse into them too.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import asyncio, sys',
        'if sys.version_info < (3, 11):',
        '    raise ValueError("skip-old <model>")',
        'async def boom():',
        '    raise ValueError("group-member")',
        'async with asyncio.TaskGroup() as tg:',
        '    tg.create_task(boom())',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.message).toContain('<model>')
    expect(result.error?.message).not.toContain('bootstrap.py')
  })

  it('keeps frames intact when a model thread floods logs while a large frame drains', async () => {
    // os.write releases the GIL and a frame beyond PIPE_BUF is not atomic:
    // without the writer lock + full-write loop, the printing thread could
    // interleave bytes mid-frame and the host would drop the malformed JSON,
    // hanging the run to the wall clock (or losing the completion).
    const { runtime } = await setup({ maxValueBytes: 1024 * 1024, maxLogBytes: 4 * 1024 * 1024, maxWallMs: 15_000 })
    const result = await runtime.run({
      program: [
        'import threading',
        'stop = False',
        'def spam():',
        '    while not stop:',
        '        print("spam-line-" + "y" * 100)',
        't = threading.Thread(target=spam)',
        't.start()',
        // A ~300 KiB completion — several PIPE_BUF units — while spam runs.
        'big = "x" * (300 * 1024)',
        'stop = True',
        't.join()',
        'return big',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('x'.repeat(300 * 1024))
  }, 20_000)

  it('settles cleanly while a daemon thread keeps writing unterminated log text', async () => {
    // WARNING regression: the settlement `flush_out()/flush_err()` on the main
    // coroutine read and clear `_LogStream._pending` and the shared LogBuffer
    // ledger with NO lock, while a model daemon thread's `print`/`write` mutate
    // the same state. Capturing the bound method (`out_stream.flush_line`) only
    // fixes WHICH callable runs, not what it reads mid-flight: the flush could
    // interleave with a concurrent write and join a `_pending` list being
    // mutated under it, corrupting the ledger and costing the `done` frame — the
    // run would then strand to the wall clock instead of completing. The shared
    // re-entrant lock serializes them.
    //
    // A pure data race has no single bad input to reject deterministically, so
    // this maximizes overlap: daemon threads emit UNTERMINATED writes (which
    // pile into `_pending` rather than flushing per line) right up to the moment
    // the body returns and settlement flushes. Repeated so the interleave lands.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { runtime, fiber } = await setup({ maxLogBytes: 4 * 1024 * 1024, maxWallMs: 15_000 })
      const result = await runtime.run({
        program: [
          'import sys, threading',
          'stop = False',
          'def spam():',
          '    while not stop:',
          // No newline: the text accumulates in the stream's `_pending`, which is
          // exactly the state the settlement flush also touches.
          '        sys.stdout.write("tail-fragment-" + "z" * 64)',
          'workers = [threading.Thread(target=spam, daemon=True) for _ in range(4)]',
          'for t in workers: t.start()',
          // Let the daemons build up pending writes, then return so settlement
          // flushes while they are still mid-write.
          'import time; time.sleep(0.05)',
          'return "settled"',
        ].join('\n'),
        bindings: [],
      })
      expect(result.error).toBeUndefined()
      expect(result.value).toBe('settled')
      await fiber.dispose()
    }
  }, 30_000)

  it('completes a binding called from a worker thread on its own event loop', async () => {
    // A binding reply Future is created on the loop that ran `dispatch`. When the
    // model calls a binding from a worker THREAD via `asyncio.run(tools.x(...))`,
    // that Future belongs to the thread's loop, not the main loop where
    // `_pump_replies` reads the reply. `asyncio.Future` is not thread-safe:
    // completing it from another thread does not wake its own loop, so a direct
    // `set_result` would strand the awaiting thread and the run would degrade to a
    // wall-clock timeout. The pump must schedule completion on the Future's own
    // loop via `call_soon_threadsafe`. The tight maxWallMs makes the pre-fix
    // failure a fast timeout rather than a hang.
    //
    // The main coroutine yields with `await asyncio.sleep` while the worker runs,
    // rather than a synchronous `t.join()`: joining would block the main thread,
    // so the main loop could not run `_pump_replies` and the call would deadlock
    // regardless of the fix — that blocks the pump, not the cross-loop delivery
    // this test pins.
    const { runtime } = await setup({ maxWallMs: 8_000 })
    const seen: unknown[] = []
    const result = await runtime.run({
      program: [
        'import asyncio, threading',
        'result = {}',
        'def worker():',
        // A fresh loop in this thread; the binding Future is created here.
        '    result["value"] = asyncio.run(tools.echo({"from": "thread"}))',
        't = threading.Thread(target=worker)',
        't.start()',
        'while t.is_alive():',
        '    await asyncio.sleep(0.02)',
        'return result["value"]',
      ].join('\n'),
      bindings: tools({
        echo: async (args) => { seen.push(args); return args as CodeJsonValue },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({ from: 'thread' })
    // The host binding actually ran (the reply round-tripped), not a timeout.
    expect(seen).toEqual([{ from: 'thread' }])
  }, 15_000)

  it('keeps the reply pump alive when a late reply targets a closed thread loop', async () => {
    // A binding called from a worker thread that ABANDONS the call (its
    // `asyncio.run` is cancelled) leaves the pending entry holding that thread's
    // loop, which `asyncio.run` closes on return. When the host later answers
    // that call, `_pump_replies` schedules the completion onto the closed loop —
    // `call_soon_threadsafe` raises `RuntimeError('Event loop is closed')`.
    // Unguarded, that RuntimeError ends the pump task and strands every later
    // reply; the guard drops the moot reply and keeps the pump serving.
    //
    // The ordering is a STRUCTURAL guarantee, not a timing window: the worker
    // closes its loop before the main coroutine signals `closed`; the host
    // answers the abandoned `slow` call (hitting the closed loop) before it
    // answers `release`, because `release`'s handler only resolves `slow` first
    // and then yields a microtask. So the pump provably meets the closed loop on
    // `slow`'s reply before it must deliver `release`'s. Fail-before: the pump
    // dies on `slow`, `release`'s reply is never read, and `await tools.release`
    // hangs to the (small) maxWallMs as a timeout.
    let releaseSlow!: () => void
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve })
    const { runtime } = await setup({ maxWallMs: 6_000 })
    const result = await runtime.run({
      program: [
        'import asyncio, threading',
        'closed = threading.Event()',
        'def worker():',
        '    async def body():',
        // Abandon the call: wait_for cancels it, but the pending host-side entry
        // survives (dispatch does not pop on cancellation), holding this loop.
        '        try:',
        '            await asyncio.wait_for(tools.slow({}), timeout=0.1)',
        '        except asyncio.TimeoutError:',
        '            pass',
        '    asyncio.run(body())',  // closes the thread's loop on return
        '    closed.set()',
        't = threading.Thread(target=worker)',
        't.start()',
        'while not closed.is_set():',
        '    await asyncio.sleep(0.02)',
        // The loop is closed. Now the host answers slow (dead-loop reply) then
        // release; the pump must survive the first to deliver the second.
        'after = await tools.release({})',
        'return after',
      ].join('\n'),
      bindings: tools({
        slow: async () => {
          // Answer only once the worker has closed its loop AND the main
          // coroutine is awaiting release, so this reply reaches the pump against
          // the closed loop.
          await slowGate
          return 'late'
        },
        release: async () => {
          // Let slow's reply be written first, then yield a microtask so the
          // pump processes the dead-loop reply before release's own reply lands.
          releaseSlow()
          await new Promise(resolve => setImmediate(resolve))
          return 'released'
        },
      }),
    })
    expect(result.error).toBeUndefined()
    // The pump survived the closed-loop reply and delivered the later binding.
    expect(result.value).toBe('released')
  }, 15_000)

  it('keeps the reply pump alive when RuntimeError is rebound before the program runs', async () => {
    // `_pump_replies` catches a closed-loop scheduling failure with `except
    // _RuntimeError`. If that name were bound as a pump BODY local, it would be
    // captured at pump-start — but `_run` reaches the model's top-level
    // statements (which run before the pump's first step, since there is no
    // suspension point between `create_task` and `await __avn_main__`) with the
    // rebind already applied, so `_RuntimeError` would capture the REBOUND class
    // and the closed-loop `RuntimeError` would escape, killing the pump. Binding
    // it as a DEF-TIME default argument captures the original before any model
    // code runs. This rebinds `__main__.RuntimeError` as the very first program
    // statement and drives the closed-loop worker pattern: the pump must survive
    // the dead-loop reply and deliver the later binding.
    let releaseSlow!: () => void
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve })
    const { runtime } = await setup({ maxWallMs: 6_000 })
    const result = await runtime.run({
      program: [
        'import __main__',
        '__main__.RuntimeError = ValueError',
        'import asyncio, threading',
        'closed = threading.Event()',
        'def worker():',
        '    async def body():',
        '        try:',
        '            await asyncio.wait_for(tools.slow({}), timeout=0.1)',
        '        except asyncio.TimeoutError:',
        '            pass',
        '    asyncio.run(body())',
        '    closed.set()',
        't = threading.Thread(target=worker)',
        't.start()',
        'while not closed.is_set():',
        '    await asyncio.sleep(0.02)',
        'after = await tools.release({})',
        'return after',
      ].join('\n'),
      bindings: tools({
        slow: async () => { await slowGate; return 'late' },
        release: async () => { releaseSlow(); await new Promise(resolve => setImmediate(resolve)); return 'released' },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('released')
  }, 15_000)

  it('keeps a successful completion when _done_with_value is rebound', async () => {
    // `_run` calls `_done_with_value(value, max_value_bytes)` after the program
    // returns. The name is a module global, and this bootstrap IS `__main__`, so
    // `__main__._done_with_value = boom` as a program statement would otherwise
    // be resolved at call time and a legitimate success would be rewritten into
    // an `exception`. `_run` now binds `done_with_value_bound = _done_with_value`
    // before the program runs, so the entry name is immune; the run must still
    // report the success value.
    const { runtime } = await setup({ maxWallMs: 10_000 })
    const result = await runtime.run({
      program: [
        'import __main__',
        'def boom(*a, **k):',
        '    raise RuntimeError("hijacked")',
        '__main__._done_with_value = boom',
        'return 1',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(1)
  }, 15_000)

  it('round-trips an exactly representable large integer through a binding echo', async () => {
    // The reply serializer must print BigInt digits for a beyond-safe
    // integral double: String(2**60) emits a rounded form, and the child
    // would receive a DIFFERENT integer than the binding resolved.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'v = await tools.echo(2**60)',
        'return v == 2**60',
      ].join('\n'),
      bindings: tools({ echo: async args => args as never }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(true)
  })

  it('preserves an exactly representable large integer and rejects a rounding one', async () => {
    // The canonical boundary accepts every JS-double-exact value: 2**53 and
    // 2**60 round-trip exactly and must cross (matching the worker backend);
    // 2**53+1 rounds and must fail as invalid-output.
    const { runtime } = await setup()
    const exact = await runtime.run({ program: 'return [2**53, 2**60]', bindings: [] })
    expect(exact.error).toBeUndefined()
    expect(exact.value).toEqual([2 ** 53, 2 ** 60])
    const lossy = await runtime.run({ program: 'return 2**53 + 1', bindings: [] })
    expect(lossy.error?.kind).toBe('invalid-output')
    expect(lossy.error?.message).toContain('not exactly representable')
  })

  it('rejects a container subclass whose overridden methods hide its contents', async () => {
    // A dict subclass returning [] from items() passes an isinstance check but
    // serializes as {}, so the host would receive a value the program did not
    // compute. Exact-type matching fails it as invalid-output instead. The
    // worker backend rejects the prototype-equivalent shapes the same way.
    const { runtime } = await setup()
    const hidden = await runtime.run({
      program: [
        'class Sneaky(dict):',
        '    def items(self): return []',
        '    def keys(self): return []',
        '    def __iter__(self): return iter([])',
        '    def __len__(self): return 0',
        'return Sneaky(secret="kept")',
      ].join('\n'),
      bindings: [],
    })
    expect(hidden.error?.kind).toBe('invalid-output')
    expect(hidden.error?.message).toContain('unsupported type (Sneaky)')
    // A list subclass is refused on the same rule.
    const listish = await runtime.run({
      program: ['class L(list):', '    def __iter__(self): return iter([])', 'return L([1, 2, 3])'].join('\n'),
      bindings: [],
    })
    expect(listish.error?.kind).toBe('invalid-output')
    expect(listish.error?.message).toContain('unsupported type (L)')
    // The exact built-in containers still cross unchanged.
    const plain = await runtime.run({ program: 'return {"secret": [1, 2]}', bindings: [] })
    expect(plain.error).toBeUndefined()
    expect(plain.value).toEqual({ secret: [1, 2] })
  })

  it('rejects a scalar subclass whose overrides disagree with what gets serialized', async () => {
    // The validators checked scalars with isinstance, so a subclass passed
    // every check by its real value while the ENCODER read an override — the
    // host then received a value the walk never approved. Each case below is a
    // distinct override reaching a distinct reader.
    const { runtime } = await setup()
    // _dump_float spells a float from repr(value), so an overridden __repr__
    // decides the digits: F(2.5) serialized as 1.
    const floated = await runtime.run({
      program: [
        'class F(float):',
        '    def __repr__(self): return "1.0"',
        'return F(2.5)',
      ].join('\n'),
      bindings: [],
    })
    expect(floated.error?.kind).toBe('invalid-output')
    expect(floated.error?.message).toContain('unsupported type (F)')
    // The JS-safe-range bound is two comparisons, so overriding them admits an
    // int whose true digits (json.dumps reads the C-level value) the host's
    // JSON.parse rounds: 9007199254740993 arrives as ...992.
    const inted = await runtime.run({
      program: [
        'class I(int):',
        '    def __gt__(self, other): return False',
        '    def __lt__(self, other): return False',
        'return I(2 ** 53 + 1)',
      ].join('\n'),
      bindings: [],
    })
    expect(inted.error?.kind).toBe('invalid-output')
    expect(inted.error?.message).toContain('unsupported type (I)')
    // The pre-encode size bound reads len(), so overriding it to 0 admits a
    // string of any length past maxValueBytes.
    const stringed = await runtime.run({
      program: [
        'class S(str):',
        '    def __len__(self): return 0',
        'return S("Q" * 100000)',
      ].join('\n'),
      bindings: [],
    })
    expect(stringed.error?.kind).toBe('invalid-output')
    expect(stringed.error?.message).toContain('unsupported type (S)')
    // A str-subclass dict KEY reaches the same len() bound.
    const keyed = await runtime.run({
      program: [
        'class S(str):',
        '    def __len__(self): return 0',
        'return {S("Q" * 100000): 1}',
      ].join('\n'),
      bindings: [],
    })
    expect(keyed.error?.kind).toBe('invalid-output')
    expect(keyed.error?.message).toContain('non-string dict key (S)')
    // bool is an int subclass that IS lossless JSON, and the exact scalars all
    // still cross unchanged.
    const plain = await runtime.run({
      program: 'return {"t": True, "f": False, "n": None, "i": 7, "d": 2.5, "s": "ok"}',
      bindings: [],
    })
    expect(plain.error).toBeUndefined()
    expect(plain.value).toEqual({ t: true, f: false, n: null, i: 7, d: 2.5, s: 'ok' })
  })

  it('rejects a scalar subclass passed as a binding argument', async () => {
    // The uncapped binding-argument validator shares the exact-type rule, so
    // the call fails through its rejection contract instead of dispatching a
    // float whose digits come from an override.
    const { runtime } = await setup()
    const seen: CodeJsonValue[] = []
    const result = await runtime.run({
      program: [
        'class F(float):',
        '    def __repr__(self): return "1.0"',
        'try:',
        '    await tools.echo({"v": F(2.5)})',
        'except Exception as exc:',
        '    return str(exc)',
      ].join('\n'),
      bindings: tools({ echo: async (args) => {
        seen.push(args as CodeJsonValue)
        return null
      } }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toContain('unsupported type (F)')
    expect(seen).toEqual([])
  })

  it('rejects a container subclass passed as a binding argument', async () => {
    // Binding arguments run the uncapped validator, which must apply the same
    // exact-type rule: the call fails descriptively instead of dispatching a
    // value whose serialization disagrees with what was validated.
    const { runtime } = await setup()
    const seen: CodeJsonValue[] = []
    const result = await runtime.run({
      program: [
        'class Sneaky(dict):',
        '    def items(self): return []',
        'try:',
        '    await tools.echo(Sneaky(secret="kept"))',
        'except Exception as exc:',
        '    return str(exc)',
      ].join('\n'),
      bindings: tools({ echo: async (args) => {
        seen.push(args as CodeJsonValue)
        return null
      } }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toContain('unsupported type (Sneaky)')
    expect(seen).toEqual([])
  })

  it('fails an oversized completion as output-limit without materializing its encoding', async () => {
    // A 100 MiB string under maxValueBytes: 1024 must fail as output-limit.
    // The address-space cap leaves room for the program to BUILD the string
    // (one copy + interpreter) but not for the old full pre-check encode,
    // which materialized chunk fragments plus the joined copy (~2 more
    // copies) and died on RLIMIT_AS as MemoryError/worker-exit.
    const { runtime } = await setup({ maxValueBytes: 1024, addressSpaceMb: 384, maxWallMs: 15_000 })
    const result = await runtime.run({
      program: 'return "x" * (100 * 1024 * 1024)',
      bindings: [],
    })
    expect(result.error?.kind).toBe('output-limit')
    expect(result.error?.message).toContain('exceeded 1024 bytes')
  }, 20_000)

  it('rejects a control-heavy oversized completion on its length, not its escaped copy', async () => {
    // Every "\x00" escapes to the six bytes "\u0000", so the escaped form of a
    // 40 MB string is ~240 MB. The walk must refuse on the cheap
    // `len(current) + 2` lower bound; the 384 MiB address space holds the raw
    // string but not its escaped expansion, so a pre-escape check dies on
    // RLIMIT_AS instead of returning output-limit.
    const { runtime } = await setup({ maxValueBytes: 1024, addressSpaceMb: 384, maxWallMs: 15_000 })
    const result = await runtime.run({
      program: 'return "\\x00" * (40 * 1024 * 1024)',
      bindings: [],
    })
    expect(result.error?.kind).toBe('output-limit')
    expect(result.error?.message).toContain('exceeded 1024 bytes')
  }, 20_000)

  it('truncates a single print far above maxLogBytes instead of dying on the encode', async () => {
    // LogBuffer must reject via the cheap char-count lower bound BEFORE
    // UTF-8-encoding the whole string: the full encode of a ~100 MB line
    // would double the allocation and can breach RLIMIT_AS. 256 MiB
    // address space comfortably holds one copy of the 100 MB string but
    // not the pre-fix double allocation plus interpreter overhead spikes.
    const { runtime } = await setup({ maxLogBytes: 1024, addressSpaceMb: 256, maxWallMs: 15_000 })
    const result = await runtime.run({
      program: [
        'print("x" * (100 * 1024 * 1024))',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    expect(result.logs.some(line => line.includes('log capture truncated'))).toBe(true)
  }, 20_000)

  it('stops host capture at the child ledger truncation, keeping exactly one marker', async () => {
    // The two ledgers exhaust independently. One child entry larger than
    // `maxLogBytes` sends ONLY the marker, so the host budget is still nearly
    // untouched — and the marker used to arrive as an ordinary `log` frame the
    // host could not tell from program output. Text written afterwards was
    // therefore retained AFTER the marker, contradicting the stop-after-
    // truncation contract, and a later host-side exhaustion could append a
    // second marker. The frame now carries `truncated: true`.
    //
    // `os.write(1, ...)` bypasses the child's own stream, so those bytes reach
    // the host as stray stdout and take the host ledger path rather than the
    // child's — which is exactly the route that leaked past the marker.
    const { runtime } = await setup({ maxLogBytes: 64, maxWallMs: 10_000 })
    const result = await runtime.run({
      program: [
        'import os',
        'print("y" * 70000)',
        'os.write(1, b"AFTER")',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    const markers = result.logs.filter(line => line.includes('log capture truncated'))
    expect(markers).toHaveLength(1)
    // The marker is the LAST entry: nothing was retained after truncation.
    expect(result.logs.at(-1)).toBe(markers[0])
    expect(result.logs.join('\n')).not.toContain('AFTER')
  }, 20_000)

  it('keeps one marker when a program forges repeated truncation frames', async () => {
    // `truncated` is attacker-reachable: the program owns fd 3 and can write the
    // flag itself, so the field is a hostile input rather than a trusted signal.
    // Repeats must collapse to the single marker the contract promises, and only
    // the literal `true` counts — a forged `"yes"` is rebuilt away by
    // validateChildFrame, so that frame stays ordinary text.
    const { runtime } = await setup({ maxLogBytes: 4096, maxWallMs: 10_000 })
    const result = await runtime.run({
      program: [
        'import os, json',
        'os.write(3, json.dumps({"type":"log","text":"first","truncated":"yes"}).encode() + b"\\n")',
        'os.write(3, json.dumps({"type":"log","text":"MARK-A","truncated":True}).encode() + b"\\n")',
        'os.write(3, json.dumps({"type":"log","text":"MARK-B","truncated":True}).encode() + b"\\n")',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    // The non-boolean flag did not truncate, so its text was captured normally.
    expect(result.logs).toContain('first')
    // The first genuine flag stopped capture and emitted the HOST's own marker;
    // the frame's own text is discarded, so neither payload appears.
    expect(result.logs).not.toContain('MARK-A')
    expect(result.logs).not.toContain('MARK-B')
    expect(result.logs.at(-1)).toBe(logTruncationMarker(4096))
    expect(result.logs.filter(line => line.includes('log capture truncated'))).toHaveLength(1)
  }, 20_000)

  it('discards the text of a forged truncation frame instead of retaining it', async () => {
    // The marker branch bypasses `admit`, so retaining the frame's own text put
    // attacker-controlled bytes into `logs` with no cap at all: measured, a 1 MiB
    // forged text was retained whole under `maxLogBytes: 64`, and the only bound
    // left was the 64 MiB frame parse cap. The host emits its own marker instead,
    // so the retained size is fixed regardless of what the program sent.
    const forgedBytes = 1024 * 1024
    const { runtime } = await setup({ maxLogBytes: 64, maxWallMs: 20_000 })
    const result = await runtime.run({
      program: [
        'import os, json',
        `big = "A" * ${forgedBytes}`,
        'os.write(3, json.dumps({"type":"log","truncated":True,"text":big}).encode() + b"\\n")',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    // Only the host marker is kept, so the total stays orders of magnitude below
    // what the forgery carried — and below the cap it was trying to escape.
    expect(result.logs).toEqual([logTruncationMarker(64)])
    expect(result.logs.join('').length).toBeLessThan(forgedBytes / 1000)
  }, 30_000)

  it('coalesces unframed fd-3 fragments without recopying the sealed prefix', async () => {
    // The frame ceiling meters payload BYTES, but each retained chunk is its own
    // Buffer with object and backing-store overhead the byte count cannot see:
    // 5000 single-byte newline-free writes produced 5000 chunks holding 5031
    // bytes, so a program pacing such writes could accumulate millions of objects
    // inside the wall budget and exhaust the host heap far below 256 MiB.
    //
    // The observable behavior is that the run still completes normally: the
    // fragments are coalesced rather than rejected, since a slow trickle of bytes
    // is not itself a protocol violation.
    //
    // `Buffer.concat` is wrapped for the duration so the cumulative copy volume
    // is measured rather than inferred: that total is what separates sealing into
    // blocks from re-merging the whole buffer, and both shapes pass every
    // behavioral assertion below.
    //
    // The trickle is terminated with its own newline before the real frame is
    // written. Without that, those 5000 bytes prefix the frame on the SAME line,
    // which then parses as junk and is dropped — correct framing behavior, but it
    // would leave this test asserting the wrong thing.
    // Bound at capture: `Buffer.concat` is a static method, and taking a bare
    // reference to one trips no-unbound-method.
    const realConcat = Buffer.concat.bind(Buffer)
    let copied = 0
    Buffer.concat = (list: readonly Uint8Array[], total?: number): Buffer<ArrayBuffer> => {
      for (const part of list) copied += part.length
      return realConcat(list, total)
    }
    const program = [
      'import os',
      // Newline-free single-byte writes, spaced so each lands as its own read.
      // 60000 rather than 5000: the trickle has to cross the seal threshold
      // enough times for the two shapes to separate. At 5000 writes there are
      // only four seals, so even the quadratic form copies well under a
      // megabyte and the budget below could not tell them apart.
      'for _ in range(60000):',
      '    os.write(3, b"x")',
      '    os.sched_yield()',
      'os.write(3, b"\\n")',
      // A real frame after the trickle proves framing still works on the
      // coalesced residual.
      'print("after-trickle")',
      'return "done"',
    ].join('\n')
    let result: CodeRunResult
    try {
      const { runtime } = await setup({ maxWallMs: 30_000 })
      result = await runtime.run({ program, bindings: [] })
    } finally {
      Buffer.concat = realConcat
    }
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    expect(result.logs).toContain('after-trickle')
    // Sealing appends a finished block rather than re-merging everything held, so
    // each byte is copied once. Re-concatenating the whole buffer at every
    // threshold made the cumulative copy volume quadratic — 10 MiB trickled a
    // byte at a time copies 53.7 GB that way. A per-byte-copied budget is the
    // discriminator, and it is measured rather than reasoned about: this shape
    // copies about 119 KB for 60000 trickled bytes, the re-merging shape about
    // 540 KB. 256 KiB sits between them with margin on both sides — most writes
    // are coalesced by the pipe before they reach us, so the observed ratio is
    // smaller than the asymptotic one, and the threshold has to sit where a real
    // measurement lands rather than where the asymptote suggests.
    expect(copied).toBeLessThan(256 * 1024)
  }, 40_000)

  it('seals trickled stray fragments into blocks without recopying the sealed prefix', async () => {
    // The stray-capture buffer has the same object-overhead exposure as the fd-3
    // reader above: each newline-free `data` chunk is its own Buffer, so a
    // program pacing single-byte `os.write(1, ...)` accumulates one object per
    // write, which the serialized-cost counter cannot see. Past MAX_PENDING_CHUNKS
    // the fragments seal into a finished block; re-merging the whole residual at
    // each threshold instead would copy the sealed prefix again and again, making
    // the cumulative copy volume quadratic. `Buffer.concat` is wrapped to measure
    // that volume — both shapes admit the same final log entry, so the copy total
    // is the discriminator. maxLogBytes is raised so the trickle is retained,
    // not truncated, which is what forces the fragments to accumulate and seal.
    const realConcat = Buffer.concat.bind(Buffer)
    let copied = 0
    Buffer.concat = (list: readonly Uint8Array[], total?: number): Buffer<ArrayBuffer> => {
      for (const part of list) copied += part.length
      return realConcat(list, total)
    }
    let result: CodeRunResult
    try {
      const { runtime } = await setup({ maxLogBytes: 200_000, maxWallMs: 30_000 })
      result = await runtime.run({
        program: [
          'import os',
          'for _ in range(60000):',
          '    os.write(1, b"x")',
          '    os.sched_yield()',
          'os.write(1, b"\\n")',
          'return "done"',
        ].join('\n'),
        bindings: [],
      })
    } finally {
      Buffer.concat = realConcat
    }
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    // The trickle coalesces into one log line (no interior newlines). Its exact
    // length depends on pipe coalescing, but it is one entry and non-empty.
    expect(result.logs.length).toBe(1)
    expect((result.logs[0] as string).length).toBeGreaterThan(0)
    // Sealing appends a finished block rather than re-merging everything held, so
    // each byte is copied a bounded number of times. Re-merging the whole
    // residual at every seal threshold instead makes the cumulative copy volume
    // quadratic. Measured like the fd-3 sibling above rather than reasoned about:
    // this sealed shape copies about 120 KB for 60000 trickled bytes, the
    // re-merging shape about 538 KB (the stray path adds one whole-residual
    // concat at the terminating newline over the fd-3 sibling's 119/540, landing
    // at the same order). 256 KiB sits between them with margin on both sides, so
    // reverting the seal to a re-merge turns this assertion red.
    expect(copied).toBeLessThan(256 * 1024)
  }, 40_000)

  it('caps a huge exception diagnostic child-side before it crosses the wire', async () => {
    // A program can raise with a multi-megabyte message; the child must cap
    // it at maxValueBytes before formatting/sending, not ship the whole
    // payload for the host to truncate after parsing.
    const { runtime } = await setup({ maxValueBytes: 1024 })
    const result = await runtime.run({
      program: 'raise ValueError("boom-" + "x" * (8 * 1024 * 1024))',
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.message).toContain('boom-')
    expect(result.error?.message.endsWith('… [truncated]')).toBe(true)
    expect(Buffer.byteLength(result.error?.message ?? '', 'utf8')).toBeLessThan(2048)
  })

  it('caps a control-heavy exception diagnostic by its serialized cost, not raw bytes', async () => {
    // The diagnostic crosses fd 3 inside a JSON frame where a control character
    // escapes sixfold (a NUL is one raw byte, six as `\u0000`). Capping by raw
    // UTF-8 length would let a NUL-heavy message near maxValueBytes serialize to
    // ~6x that and breach the frame ceiling — the silent worker-exit inversion
    // the load-time cap check exists to prevent. The child meters the diagnostic
    // by its serialized cost, so a NUL flood is truncated to fit the frame and
    // the run still reports the exception rather than a worker-exit.
    const { runtime } = await setup({ maxValueBytes: 4096 })
    const result = await runtime.run({
      // 512 KiB of NUL: ~3 MiB once escaped, far past the 4 KiB cap.
      program: 'raise ValueError("\\x00" * (512 * 1024))',
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.message.endsWith('… [truncated]')).toBe(true)
    // The SERIALIZED form (what the frame carried) fits the budget, so its raw
    // length is well under it too — a raw-byte cap would have admitted ~4 KiB of
    // NULs that serialize to ~24 KiB.
    const serialized = JSON.stringify(result.error?.message ?? '')
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(4096 + 8)
  })

  it('bounds a newline-free partial-line flood while the program is still running', async () => {
    // print("x", end="") never completes a line, so nothing reaches the
    // Python LogBuffer until settlement — the buffered tail must still hit
    // the budget mid-run instead of growing without bound to RLIMIT/timeout.
    const { runtime } = await setup({ maxLogBytes: 1024, maxWallMs: 15_000 })
    const result = await runtime.run({
      program: [
        'for _ in range(100000):',
        '    print("xxxxxxxxxx", end="")',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    expect(result.logs.some(line => line.includes('log capture truncated'))).toBe(true)
    // The retained text is bounded by the budget, not the 1 MB the program wrote.
    expect(result.logs.join('\n').length).toBeLessThan(4096)
  }, 20_000)

  it('discards empty writes instead of buffering one list slot each', async () => {
    // An empty chunk adds no character, so the mid-run budget check (which
    // compares buffered CHARS against the remaining ledger) can never fire on
    // it. Buffering empty strings therefore grew `_pending` without bound —
    // millions of slots per CPU second — until RLIMIT_AS turned an append into
    // a MemoryError, long after the log ledger was exhausted. Two million
    // empty writes must instead settle normally and contribute NO log entry,
    // proving the chunk was dropped rather than joined at flush_line.
    const { runtime } = await setup({ maxLogBytes: 256, addressSpaceMb: 256, maxWallMs: 20_000 })
    const result = await runtime.run({
      program: [
        'import sys',
        'for _ in range(2000000):',
        '    sys.stdout.write("")',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    expect(result.logs).toEqual([])
  }, 30_000)

  it('stops scanning a single-write newline flood once the log ledger truncates', async () => {
    // One write carrying half a million newlines: the offset scan must exit the
    // instant LogBuffer truncates rather than re-slicing and pushing every
    // remaining line. If it kept scanning it would exhaust the CPU/wall budget;
    // the run instead settles quickly with exactly one truncation marker.
    const { runtime } = await setup({ maxLogBytes: 256, maxWallMs: 10_000 })
    const start = Date.now()
    const result = await runtime.run({
      program: ['print("x\\n" * 500000, end="")', 'return "done"'].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    expect(result.logs.filter(line => line.includes('log capture truncated'))).toHaveLength(1)
    expect(Date.now() - start).toBeLessThan(8_000)
  }, 15_000)

  it('bounds an oversized newline-terminated write before joining and slicing it', async () => {
    // The newline branch slices the first line out of the write before
    // `LogBuffer.push` can apply its cheap budget rejection, so a single
    // over-budget write cost a full extra copy of itself in peak address space —
    // the amplification that bound exists to avoid, applied one layer too late.
    // Measured under a 400 MiB addressSpaceMb with the slice unbounded: writes
    // of 200 MiB and up died on MemoryError inside `sys.stdout.write`, reported
    // as the PROGRAM's own exception rather than the promised truncation marker.
    // `"\\n".rjust(n, "A")` is a single allocation ending in the newline, so the
    // payload itself fits and the only remaining allocation is the stream's own
    // slice; 340 MiB of a 400 MiB cap cannot survive one more copy of it.
    const { runtime } = await setup({ maxLogBytes: 256, addressSpaceMb: 400, maxWallMs: 30_000 })
    const result = await runtime.run({
      program: [
        'import sys',
        'payload = "\\n".rjust(340 * 1024 * 1024, "A")',
        'sys.stdout.write(payload)',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    expect(result.logs).toEqual([logTruncationMarker(256)])
  }, 40_000)

  it('bounds a newline-free write against the already-buffered chunks before joining them', async () => {
    // The newline-free arm buffers the write and then compared the buffered
    // CHARACTER COUNT against the ledger — correct — but paid for the comparison
    // with `"".join(self._pending)`, a second full copy of everything held. One
    // buffered character is enough to make that join a copy of the whole
    // following write. Measured under a 400 MiB addressSpaceMb with a 340 MiB
    // second write: the join raised MemoryError inside `sys.stdout.write`, and
    // because the oversized chunks stayed in `_pending` the settlement
    // `flush_line` raised it again — that throw sits after the `except
    // BaseException` block, so it costs the `done` frame and the run came back
    // `timeout: wall-clock ceiling reached (30000ms)` with no logs at all. The
    // bound must be applied BEFORE the join and the chunks dropped on that path,
    // so the run settles with the truncation marker it promises.
    const { runtime } = await setup({ maxLogBytes: 256, addressSpaceMb: 400, maxWallMs: 30_000 })
    const result = await runtime.run({
      program: [
        'import sys',
        // One unterminated character first, so `_pending` is non-empty and the
        // large write cannot take the "buffered text IS the write" shortcut.
        'sys.stdout.write("x")',
        'payload = "A" * (340 * 1024 * 1024)',
        'sys.stdout.write(payload)',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    expect(result.logs).toEqual([logTruncationMarker(256)])
  }, 40_000)

  it('bounds a newline-terminated write against the already-buffered chunks before joining them', async () => {
    // Same allocation, reached through the newline arm: with chunks pending, the
    // whole write used to be appended and joined so the offset scan could run
    // over one string. Only the FIRST line needs those chunks, so a pending
    // chunk plus a 340 MiB newline-terminated write under a 400 MiB
    // addressSpaceMb died on MemoryError in the join before the per-line bound
    // could reject anything, and the retained chunks made the settlement flush
    // die the same way: measured, `timeout: wall-clock ceiling reached
    // (30000ms)`. The reconstructed first line is now checked against the ledger
    // and only a budget-sized prefix of it is copied; the rest of the write is
    // scanned in place.
    const { runtime } = await setup({ maxLogBytes: 256, addressSpaceMb: 400, maxWallMs: 30_000 })
    const result = await runtime.run({
      program: [
        'import sys',
        'sys.stdout.write("x")',
        'payload = "\\n".rjust(340 * 1024 * 1024, "A")',
        'sys.stdout.write(payload)',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    expect(result.logs).toEqual([logTruncationMarker(256)])
  }, 40_000)

  it('emits pending text on an explicit flush, before the run can be killed', async () => {
    // `_LogStream` inherits TextIOBase's no-op `flush()`, so an explicit
    // `print(..., flush=True)` or `sys.stdout.flush()` left the text in
    // `_pending` with nothing to drain it but `flush_line` after settlement — a
    // call a hanging or killed run never reaches. Measured: printing
    // "before hang" with flush=True ahead of an infinite loop returned
    // `logs: []`, losing the one diagnostic the program deliberately committed.
    //
    // `maxWallMs` is this case's entire cost: the run must be killed to prove the
    // flushed text outlived it, and the child reaches the hang in milliseconds, so
    // the old 4 s ceiling bought nothing a 2 s one does not.
    const { runtime } = await setup({ maxWallMs: 2_000 })
    const result = await runtime.run({
      program: [
        'import sys',
        'print("before hang", end="", flush=True)',
        'while True: pass',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('timeout')
    expect(result.logs).toContain('before hang')
  }, 15_000)

  it('marks a dropped tail when the ledger lands on exactly zero remaining', async () => {
    // One 100-character line costs 103 serialized bytes (quotes + separator),
    // consuming a 104-byte budget minus the 1-byte array-envelope reservation
    // (104 - 1 = 103) EXACTLY. Landing on zero never trips
    // LogBuffer's "cost > remaining" branch, so `_truncated` stays unset and the
    // stream's own `remaining > 0` guard silently discarded the unscanned tail —
    // the run reported a complete log while dropping text. The tail must be
    // pushed so the marker is emitted. (This surfaced only after empty writes
    // stopped being buffered: `print` issues a trailing `write("")` whose
    // buffered-empty path used to force the marker out incidentally.) A single
    // wide line is used rather than many narrow ones so the CHILD ledger is the
    // one that lands on zero: the host's identical ledger truncates first when
    // many small entries precede the long marker text. `["y"*100]` serializes to
    // exactly 104 bytes (103 payload + 1 envelope), so 104 is the smallest
    // budget that admits the entry.
    const { runtime } = await setup({ maxLogBytes: 104, maxWallMs: 10_000 })
    const result = await runtime.run({
      program: ['print("y" * 100 + "\\n" + "z" * 10, end="")', 'return "done"'].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    expect(result.logs).toContain('y'.repeat(100))
    expect(result.logs.filter(line => line.includes('log capture truncated'))).toHaveLength(1)
    // The dropped tail is not retained, but its loss is now reported.
    expect(result.logs.some(line => line.includes('z'))).toBe(false)
  }, 15_000)

  it('keeps an admitted log within the serialized array envelope at the exact limit', async () => {
    // Each entry is charged its JSON-string cost plus one separator byte, and
    // the serialized outer logs array adds one more byte of envelope (two
    // brackets and n-1 commas). The ledgers reserve that byte, so a result that
    // exactly exhausts the ledger still serializes within the configured cap.
    // At the 64-byte floor (the smallest admissible maxLogBytes): ledger 63,
    // a 60-character line serializes as `"aaa...a"` (62 bytes) + 1 separator
    // = 63, exactly exhausting the ledger and serializing as `["aaa...a"]`
    // = 64 = the cap; a 61-character line costs 64 > 63 and truncates. The
    // marker rides envelope, so the serialized logs run to cap + marker.
    const { runtime } = await setup({ maxLogBytes: 64, maxWallMs: 10_000 })
    const result = await runtime.run({
      program: ['print("a" * 60 + "\\n" + "b" * 61, end="")', 'return "done"'].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    // The 60-character line was admitted; the 61-character line was not (a
    // single 'b' would also match the marker's "bytes", so check for the line).
    expect(result.logs).toContain('a'.repeat(60))
    expect(result.logs.some(line => line.includes('b'.repeat(61)))).toBe(false)
    expect(result.logs.some(line => line.includes('log capture truncated'))).toBe(true)
  }, 15_000)

  it('rejects a log budget too small to serialize the truncation marker', async () => {
    // A maxLogBytes below 64 cannot serialize the truncation marker itself;
    // it is rejected at construction so a marker-only truncated run cannot
    // report more than the public cap. maxValueBytes keeps no floor beyond the
    // positive-integer requirement (a completion can be 1 byte).
    await expect(setup({ maxLogBytes: 63, maxWallMs: 10_000 })).rejects.toThrow(/must be at least 64/)
  }, 15_000)

  it('charges the JSON-escaped cost of control characters against the log ledger', async () => {
    // A NUL renders as \u0000 (6 bytes) in the serialized outer logs; the
    // ledger must charge that expansion, or a control-character flood admits
    // 6x the configured cap.
    const { runtime } = await setup({ maxLogBytes: 256 })
    const result = await runtime.run({
      program: [
        'for _ in range(500):',
        '    print("\\x00" * 10)',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs.some(line => line.includes('log capture truncated'))).toBe(true)
    // Serialized (escaped) size of retained entries stays in the budget's
    // neighborhood: well under the ~30 kB an uncharged flood would retain.
    const serialized = Buffer.byteLength(JSON.stringify(result.logs), 'utf8')
    expect(serialized).toBeLessThan(1024)
  })

  it('charges the serialized cost child-side, so a control-heavy line truncates instead of being admitted whole', async () => {
    // The child's ledger must charge what the entry costs on the wire, not its
    // raw UTF-8 length: a NUL is one raw byte but six as its escape. A 24 MiB NUL
    // line clears the cheap char-count lower bound (24 MiB < 32 MiB budget), so
    // charging raw bytes would ADMIT it and emit a ~144 MiB escaped entry;
    // charging the serialized cost (~144 MiB > the 32 MiB budget) rejects it
    // before any encode and emits the marker instead. The address space (512 MiB,
    // clearing the 12x load gate for a 32 MiB budget) is sized so the run loads;
    // the gate separately guarantees a correctly-charged near-budget entry fits.
    const { runtime } = await setup({ maxLogBytes: 32 * 1024 * 1024, addressSpaceMb: 512, maxWallMs: 20_000 })
    const result = await runtime.run({
      program: [
        'print("\\x00" * (24 * 1024 * 1024))',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    expect(result.logs.filter(line => line.includes('log capture truncated'))).toHaveLength(1)
    // Nothing of the line itself was retained: the ledger refused the whole entry.
    expect(result.logs.every(line => !line.includes(String.fromCharCode(0)))).toBe(true)
  }, 30_000)

  it('bounds a huge unterminated tail after an early newline without copying it whole', async () => {
    // The newline branch of _LogStream.write buffered the whole unterminated
    // tail after the last newline into `_pending` before the flush trigger could
    // bound it, so an early newline followed by a huge tail made a second full
    // copy of the model's own string — a MemoryError the config gate cannot
    // catch (the tail far exceeds maxLogBytes). The tail is now sliced to a
    // budget-sized prefix, so the run truncates and completes. Linux-only RLIMIT_AS
    // repro (Darwin skips the limit); on macOS this asserts the happy path.
    //
    // Sizing: the model builds `tail` (N) then the `"\n" + tail` write argument
    // (another ~N), so construction peaks at ~2N — kept under the 384 MiB address
    // space at N = 150 MiB (~300 MiB). The pre-fix code then buffered the whole
    // ~150 MiB tail again, pushing past 384 MiB; the sliced prefix does not.
    const { runtime } = await setup({ maxLogBytes: 256, addressSpaceMb: 384, maxWallMs: 20_000 })
    const result = await runtime.run({
      program: [
        'import sys',
        'tail = "A" * (150 * 1024 * 1024)',
        'sys.stdout.write("\\n" + tail)',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    expect(result.logs.some(line => line.includes('log capture truncated'))).toBe(true)
  }, 30_000)

  // Skipped on Darwin by name: the OOM this reorder prevents is the Linux-only
  // failure the comment below states, so on Darwin the case re-asserts the
  // over-budget `output-limit` outcome the child-side output-limit cases already
  // pin — for ~3.3 s of real Python string building per run. Same class as the
  // two wide-value cases: RLIMIT_AS is the discriminator and Darwin has none.
  it.skipIf(process.platform === 'darwin')('flushes logs before framing the value so their peaks do not add against RLIMIT_AS', async () => {
    // The load gate bounds maxLogBytes and maxValueBytes INDEPENDENTLY against the
    // address space, each at the 12x worst case. But the child framed the
    // completion value (materializing its escaped form to meter it, then encoding
    // the frame) while a newline-free log tail still sat unflushed in _pending.
    // Those two peaks added: two budgets each admitted alone could together breach
    // RLIMIT_AS, dying as worker-exit instead of settling. The flush now runs
    // before the value is framed, so the log pending is freed first.
    //
    // Config: 32 MiB each against 512 MiB (each 32*12 = 384 MiB < 448 MiB
    // budgetable, so both load). The program writes ~33M astral chars with no
    // newline (buffered ~132 MB, under the char-count flush trigger) then returns
    // ~33M astral chars — a ~132 MB serialized value that is itself OVER the 32 MiB
    // maxValueBytes, so the correct outcome is `output-limit`. Pre-fix the
    // unflushed 132 MB plus the value's build-and-encode (~396 MB) exceeded 512 MiB
    // and OOM'd (reported as exception/worker-exit); flushing first lets the value
    // check complete (~460 MB alone) and report output-limit. On Darwin (no
    // RLIMIT_AS) the value is over budget too, so output-limit holds either way;
    // the OOM the reorder prevents is the Linux-only failure.
    const { runtime } = await setup({
      maxLogBytes: 32 * 1024 * 1024,
      maxValueBytes: 32 * 1024 * 1024,
      addressSpaceMb: 512,
      maxWallMs: 20_000,
    })
    const result = await runtime.run({
      program: [
        'import sys',
        'sys.stdout.write("\\U0001F600" * 33_000_000)',
        'return "\\U0001F600" * 33_000_000',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('output-limit')
  }, 30_000)

  // Skipped on Darwin by name: RLIMIT_AS is the only thing that makes this case
  // discriminate, and Darwin ignores it, so the pre-fix `stack.extend` walk
  // round-trips the value there too — the case passes either way. Paying ~21s of
  // real interpreter time to re-assert the happy path is what makes it the
  // suite's single most expensive case on this host. CI's Linux lane enforces it.
  it.skipIf(process.platform === 'darwin')('checks and encodes a wide completion value in O(depth), not O(width)', async () => {
    // A wide flat list serializes to ~2 bytes per element but the pre-fix walk
    // enqueued one traversal tuple per element (_check_done_value) and one stack
    // entry plus a separator marker per element (_encode_json_plain) — ~56 bytes
    // per element, ~28x the serialized size. A value the byte meter admits could
    // therefore OOM on the checker's or encoder's own bookkeeping, the inversion
    // the load gate exists to prevent (the gate reserves 12x, not 28x). Both now
    // walk with an O(depth) cursor that pulls one child at a time, so the only
    // width-proportional allocation is the output string the meter bounded.
    //
    // Config: maxValueBytes 20 MiB against 384 MiB (20*12 = 240 MiB < 320 MiB
    // budgetable, so it loads). `[0] * 6_000_000` is ~12 MB of JSON, under the
    // 20 MiB budget, so it must round-trip. Pre-fix the ~400 MB of per-element
    // frames plus the interpreter exceeded 384 MiB and returned MemoryError as an
    // exception. Linux-only RLIMIT_AS repro; on macOS the value round-trips
    // either way, but the fixture stays within the address space so it is honest.
    //
    // `maxWallMs` is 150s, not the 20s the memory assertion alone needs: the O(depth)
    // cursor pulls 6M elements one at a time through Python-level frames, which costs
    // ~11s on an idle machine and more under the coverage lane's V8 instrumentation
    // with several workers sharing a box. This budget bounds the run without letting a
    // loaded runner's scheduling latency read as a `timeout` — what this test asserts
    // is the O(depth) memory shape, not a speed claim. 60s proved too tight for that
    // second reading: `check:ci:coverage` breached it on both of this host's runs, and
    // because a failing test suppresses the coverage report the whole lane died before
    // it could check a single threshold. The vitest timeout above it is a backstop for
    // the case hanging outright, so it only has to outlast the ceiling.
    const { runtime } = await setup({ maxValueBytes: 20 * 1024 * 1024, addressSpaceMb: 384, maxWallMs: 150_000 })
    const result = await runtime.run({ program: 'return [0] * 6_000_000', bindings: [] })
    expect(result.error).toBeUndefined()
    expect(Array.isArray(result.value)).toBe(true)
    expect((result.value as number[]).length).toBe(6_000_000)
  }, 240_000)

  // Skipped on Darwin for the same reason as the completion-value case above:
  // the pre-fix per-member tuples only breach the 384 MiB address space where
  // RLIMIT_AS is enforced. Darwin re-asserts the happy path it never stopped
  // taking, at ~12s a run.
  it.skipIf(process.platform === 'darwin')('validates wide binding arguments in O(depth), not O(width)', async () => {
    // The completion-value walks are budgeted; this one is not. `dispatch` runs
    // `_lossless_json_violation` on the arguments the MODEL built, and no
    // child-side byte budget bounds them first: the frame ceiling is the host's
    // and applies only after this validation returns. A per-member traversal
    // frame therefore turned a legitimate call into the program's own
    // MemoryError. Measured with tracemalloc on the two walk shapes over this
    // exact argument (JSON ~17 MB): the cursor peaks at 0.0 MiB of auxiliary
    // state, the pre-fix `stack.extend` at 459.1 MiB -- past the 384 MiB
    // configured below, so the discriminating failure is real. It is Linux-only:
    // Darwin skips RLIMIT_AS, so this case round-trips there either way.
    //
    // The binding echoes its argument's length back, so the assertion proves the
    // call actually round-tripped rather than merely avoiding a crash.
    const { runtime } = await setup({ addressSpaceMb: 384, maxWallMs: 60_000 })
    const result = await runtime.run({
      program: 'return await tools.width([0] * 6_000_000)',
      bindings: [{
        global: 'tools',
        functions: { width: async (items: unknown) => (items as number[]).length },
      }],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(6_000_000)
  }, 90_000)

  it('decodes a multi-megabyte binding reply without regex backtracking state', async () => {
    // The child parses every host reply with `_decode_json_plain`. Its scalar
    // regex matched strings with a `(?:[^"\\]|\\.)*` repetition, which makes
    // CPython's backtracking engine retain state proportional to the string's
    // WIDTH -- measured at ~146 MiB of engine state for a 1 MiB string and
    // ~558 MiB for 4 MiB. A legitimate multi-megabyte reply therefore raised
    // MemoryError inside `_pump_replies`; because that pump is the only settler
    // of the call's future, the run stranded until the wall clock reported a
    // `timeout` instead of returning the value the binding produced.
    //
    // Strings now scan chunk-to-chunk over a character class (no backtracking
    // state). Measured on this exact 4 MiB reply: the pre-fix regex peaks at
    // 557.8 MiB, past the default 512 MiB address space, while the scanner peaks
    // at the 4.0 MiB result itself. Linux-only, like the other RLIMIT_AS repros:
    // Darwin does not apply the limit, so the spike is merely allocated there.
    const reply = 'A'.repeat(4 * 1024 * 1024)
    const { runtime } = await setup({ maxWallMs: 60_000 })
    const result = await runtime.run({
      program: 'value = await tools.big({})\nreturn len(value)',
      bindings: [{ global: 'tools', functions: { big: async () => reply } }],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(reply.length)
  }, 90_000)

  it('drops a late binding resolution before snapshotting it', async () => {
    // `sendReply` checks `settled`, but only after the resolution has been walked
    // and copied by `snapshotJsonValue`. Binding resolution carries no seam-level
    // byte cap, so a binding that resolves a wide value AFTER the run already
    // settled (here on `maxWallMs`) spent host heap building a frame that is then
    // discarded. The check now runs before the snapshot.
    //
    // The binding resolves after the 1s wall clock with a 2M-element array; the
    // run must still report `timeout`, and the late value must not appear.
    let resolvedLate = false
    const lateRan = Promise.withResolvers<undefined>()
    const { runtime } = await setup({ maxWallMs: 1_000 })
    const result = await runtime.run({
      program: 'return await tools.slow({})',
      bindings: [{
        global: 'tools',
        functions: {
          slow: async () => {
            await new Promise(resolve => setTimeout(resolve, 1_500))
            resolvedLate = true
            lateRan.resolve(undefined)
            return Array.from({ length: 2_000_000 }, () => 0)
          },
        },
      }],
    })
    expect(result.error?.kind).toBe('timeout')
    expect(result.value).toBeUndefined()
    // Pin that the late path actually ran, so the assertion above is not vacuous.
    // The binding now signals that itself instead of the old fixed 2 s sleep; the
    // race only bounds the wait, so a regression that never calls the binding
    // still fails here rather than at the file's timeout.
    await Promise.race([lateRan.promise, new Promise(resolve => setTimeout(resolve, 5_000))])
    expect(resolvedLate).toBe(true)
  }, 90_000)

  it('paces concurrent binding replies instead of queueing every frame at once', async () => {
    // Binding resolution carries no seam-level byte cap. Before pacing, a program
    // resolving several large values in one `asyncio.gather` round encoded them
    // all in the same turn and queued every frame in fd 3's writable buffer,
    // which exhausted the host heap and killed the whole process rather than
    // failing the run. Replies are now encoded one at a time, waiting for
    // `drain` when the pipe is full.
    //
    // Eight concurrent 4 MiB replies (32 MiB of frames) must all round-trip. The
    // program sums the lengths, so the assertion proves every reply arrived and
    // was matched to its own call -- pacing must not drop or misroute any. What
    // this case cannot show is the peak itself, which lives in the stream's
    // buffer: measured directly on a 64 KiB-highWaterMark pipe with this same
    // 8x4 MiB shape, the unpaced writes buffered 32.0 MiB while the paced ones
    // peaked at 0.0 MiB.
    const chunk = 'A'.repeat(4 * 1024 * 1024)
    const { runtime } = await setup({ maxWallMs: 60_000 })
    const result = await runtime.run({
      program: [
        'import asyncio',
        'parts = await asyncio.gather(*[tools.chunk({}) for _ in range(8)])',
        'return sum(len(p) for p in parts)',
      ].join('\n'),
      bindings: [{ global: 'tools', functions: { chunk: async () => chunk } }],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(8 * chunk.length)
  }, 90_000)

  it('drops queued binding replies when the child dies mid-drain, without hanging', async () => {
    // drainReplies waits for `drain` when fd 3's buffer is full. If the child
    // exits while a reply is queued, the pipe never emits `drain` again — the
    // wait must also settle on `close`/`error`/destroyed, or `draining` stays
    // true and the queue is pinned with the closure forever. The program fills
    // the pipe with a wide binding reply and then exits without reading it, so
    // the host is blocked mid-drain when the child dies; the run must still
    // settle promptly (worker-exit from the close) rather than hanging on the
    // drain wait.
    const chunk = 'A'.repeat(4 * 1024 * 1024)
    const { runtime } = await setup({ maxWallMs: 10_000 })
    const result = await runtime.run({
      program: [
        'import asyncio',
        // Resolve a reply big enough to backpressure fd 3, then exit without
        // reading it: the child's `close` lands while the host still waits for
        // `drain`, exercising the destroyed-pipe branch of the reply drain.
        'pending = asyncio.create_task(tools.chunk({}))',
        'await asyncio.sleep(0.05)',
        'return "done"',
      ].join('\n'),
      bindings: [{ global: 'tools', functions: { chunk: async () => chunk } }],
    })
    // The program returned, so the completion wins over the mid-flight reply;
    // whatever the result, the run must settle (no hang on the drain wait).
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
  }, 30_000)

  it('caps the pending reply backlog when a child floods calls without reading its replies', async () => {
    // drainReplies writes one reply at a time and waits for `drain` when fd 3's
    // buffer is full. A child that never reads its replies (it only writes
    // call frames, never draining the reply side) leaves the pipe full, so
    // every call frame it keeps sending resolves a binding and adds a reply the
    // drain cannot write: without a bound, the backlog grows until the wall
    // clock, pinning each binding result in host memory. The cap settles the
    // run as worker-exit instead, mirroring the frame cap's treatment of an
    // oversized frame. The child floods 5000 sequential valid calls and never
    // reads fd 3 (its reply pump is starved by the synchronous write loop and
    // the blocking sleep); the pipe buffer absorbs ~1600 tiny replies, so the
    // pending backlog crosses MAX_PENDING_REPLIES long before maxWallMs, and
    // the run must settle worker-exit with the reply-queue message, not a
    // wall-clock timeout.
    const { runtime } = await setup({ maxWallMs: 30_000 })
    const result = await runtime.run({
      program: [
        'import os, time',
        'frame = b\'{"type":"call","id":%d,"global":"tools","name":"echo","args":{}}\\n\'',
        'for i in range(5000):',
        '    view = memoryview(frame % i)',
        '    while view:',
        '        view = view[os.write(3, view):]',
        // Keep the child alive without reading fd 3: the run must settle via
        // the reply-backlog cap, not by the child finishing or exiting.
        'time.sleep(30)',
        'return "unreachable"',
      ].join('\n'),
      bindings: [{ global: 'tools', functions: { echo: async (args: unknown) => args as CodeJsonValue } }],
    })
    expect(result.error?.kind).toBe('worker-exit')
    expect(result.error?.message).toContain('reply queue exceeded')
  }, 30_000)

  it('caps the outstanding binding-call backlog when a child floods calls against a binding that never settles', async () => {
    // The reply backlog cap only counts RESOLVED calls (`pendingReplies` grows
    // after the await), so a child flooding calls against a binding whose
    // promise never settles would accumulate one async closure per frame until
    // the wall clock without tripping it. The outstanding-call counter bounds
    // the in-flight closures to MAX_PENDING_REPLIES and settles the run as
    // worker-exit, mirroring the reply cap. The binding below never resolves,
    // so no reply is ever produced; the flood of 5000 sequential calls must
    // cross the in-flight bound long before maxWallMs.
    const { runtime } = await setup({ maxWallMs: 30_000 })
    const result = await runtime.run({
      program: [
        'import os, time',
        'frame = b\'{"type":"call","id":%d,"global":"tools","name":"hang","args":{}}\\n\'',
        'for i in range(5000):',
        '    view = memoryview(frame % i)',
        '    while view:',
        '        view = view[os.write(3, view):]',
        'time.sleep(30)',
        'return "unreachable"',
      ].join('\n'),
      bindings: [{ global: 'tools', functions: { hang: async () => await new Promise<never>(() => {}) } }],
    })
    expect(result.error?.kind).toBe('worker-exit')
    expect(result.error?.message).toContain('call backlog exceeded')
  }, 30_000)

  it('runs a legitimate gather of more than 1024 concurrent binding calls', async () => {
    // The in-flight call cap must not count a synchronous batch of instant
    // calls: the async bodies' finallys run on the microtask queue, which
    // drains only between 'data' events, so a per-frame check would trip on
    // the 1025th frame of a single event even though every binding settled
    // immediately — killing a valid large concurrent gather as worker-exit.
    // The cap is checked at event boundaries (after the microtask queue
    // drained), so this gather of 1025 instant calls completes.
    const { runtime } = await setup({ maxWallMs: 30_000 })
    const result = await runtime.run({
      program: [
        'import asyncio',
        'return len(await asyncio.gather(*[tools.echo(i) for i in range(1025)]))',
      ].join('\n'),
      bindings: [{ global: 'tools', functions: { echo: async (args: unknown) => args as CodeJsonValue } }],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(1025)
  }, 30_000)

  it('completes normally when a program returns with binding calls still outstanding', async () => {
    // The in-flight call cap refuses to admit NEW calls past the bound; it must
    // not reclassify a `done` frame as worker-exit just because the program
    // returned with calls it started but never awaited. The child schedules
    // exactly 1024 slow bindings (still pending when the program returns), so
    // the done frame arrives with the outstanding count AT the cap — the event
    // must complete with its value, not settle as `call backlog exceeded`.
    const { runtime } = await setup({ maxWallMs: 30_000 })
    const result = await runtime.run({
      program: [
        'import asyncio',
        'for i in range(1024):',
        '    asyncio.create_task(tools.slow(i))',
        'await asyncio.sleep(0.2)',
        'return "done"',
      ].join('\n'),
      bindings: [{
        global: 'tools',
        functions: { slow: async () => { await new Promise((resolve) => { setTimeout(resolve, 5_000) }); return 1 } },
      }],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
  }, 30_000)

  it('settles a single-batch never-settling flood as worker-exit without further frames', async () => {
    // The outstanding-call cap must take effect even when the whole flood fits
    // in ONE data event: a per-event admission snapshot never re-checks once no
    // further frames arrive, so a single 62 KiB write of 1025 compact calls
    // against a never-settling binding would otherwise wait out the full wall
    // clock instead of tripping the cap. The post-macrotask check runs after
    // the batch's finallys (which never run for this binding) and settles the
    // run as worker-exit long before maxWallMs.
    const { runtime } = await setup({ maxWallMs: 30_000 })
    const result = await runtime.run({
      program: [
        'import os, time',
        'frame = b\'{"type":"call","id":%d,"global":"tools","name":"hang","args":{}}\\n\'',
        'payload = b"".join(frame % i for i in range(1025))',
        'view = memoryview(payload)',
        'while view:',
        '    view = view[os.write(3, view):]',
        'time.sleep(30)',
        'return "unreachable"',
      ].join('\n'),
      bindings: [{ global: 'tools', functions: { hang: async () => await new Promise<never>(() => {}) } }],
    })
    expect(result.error?.kind).toBe('worker-exit')
    expect(result.error?.message).toContain('call backlog exceeded')
  }, 30_000)

  it('runs a burst of 1300 instant calls whose frames split across pipe reads', async () => {
    // Flowing mode can fire several 'data' events within one macrotask, before
    // any microtask drains, so a per-event snapshot of the outstanding count
    // could see the first chunk's in-flight calls in the second chunk's check
    // and false-positive on a legitimate burst. The post-macrotask check always
    // sees the true count (all finallys have run), so this burst of compact
    // frames — sized so the pipe read splits it — completes with all results.
    const { runtime } = await setup({ maxWallMs: 30_000 })
    const result = await runtime.run({
      program: [
        'import asyncio',
        'return len(await asyncio.gather(*[t.e(i) for i in range(1300)]))',
      ].join('\n'),
      bindings: [{ global: 't', functions: { e: async (args: unknown) => args as CodeJsonValue } }],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(1300)
  }, 30_000)

  it('settles as worker-exit when a done frame lands in the same batch as a call flood', async () => {
    // A done frame processed in the SAME data event as more than 1024 call
    // frames settles the run before the post-macrotask check runs (which no-ops
    // once settled), so a child could finish "successfully" while leaving the
    // outstanding closures behind — one sub-64 KiB write carries 1025 compact
    // calls plus a done. The done handler re-checks the count before accepting
    // the frame, so the run settles as worker-exit with the call-backlog
    // message instead.
    const { runtime } = await setup({ maxWallMs: 30_000 })
    const result = await runtime.run({
      program: [
        'import os, time',
        'frame = b\'{"type":"call","id":%d,"global":"tools","name":"hang","args":{}}\\n\'',
        'payload = b"".join(frame % i for i in range(1025)) + b\'{"type":"done","value":1}\\n\'',
        'view = memoryview(payload)',
        'while view:',
        '    view = view[os.write(3, view):]',
        'time.sleep(30)',
        'return "unreachable"',
      ].join('\n'),
      bindings: [{ global: 'tools', functions: { hang: async () => await new Promise<never>(() => {}) } }],
    })
    expect(result.error?.kind).toBe('worker-exit')
    expect(result.error?.message).toContain('call backlog exceeded')
  }, 30_000)

  it('rejects a completion whose dict keys fold to one JSON member', async () => {
    // `_dump_string` folds a spelled-out surrogate pair into its astral code
    // point, so `"\ud83d\ude00"` and `"\U0001f600"` are DIFFERENT Python keys
    // that encode to the SAME JSON member — the host's JSON.parse would
    // silently drop one of them, violating the lossless-JSON completion
    // contract. The child's meter rejects the collision before encoding.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: 'return {"\\ud83d\\ude00": 1, "\\U0001f600": 2}',
      bindings: [],
    })
    expect(result.error?.kind).toBe('invalid-output')
    expect(result.error?.message).toContain('duplicate dict key')
  }, 30_000)

  it('rejects binding arguments whose dict keys fold to one JSON member', async () => {
    // The same collision on the binding-argument path: the call is rejected as
    // not lossless JSON, so the program's `await` raises and the program
    // surfaces the rejection message.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'try:',
        '    await tools.echo({"\\ud83d\\ude00": 1, "\\U0001f600": 2})',
        '    return "no-error"',
        'except Exception as e:',
        '    return str(e)',
      ].join('\n'),
      bindings: [{ global: 'tools', functions: { echo: async (args: unknown) => args as CodeJsonValue } }],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toContain('duplicate dict key')
  }, 30_000)

  it('compacts the reply queue mid-drain without dropping pending frames', async () => {
    // A reply larger than the writable high-water mark makes the FIRST write
    // return false, suspending the drain loop; the frames queued behind it
    // push the drain's consumed head past MAX_PENDING_REPLIES, so the resumed
    // drain compacts the queue mid-run. The child reads fd 3 itself (blocking
    // the asyncio pump, so its reads cannot race the host's pushes) and sends
    // a second wave of calls AFTER reading part of the first wave's replies —
    // those replies are still pending when the drain's head crosses the
    // compaction bound, so a compaction that dropped pending frames would
    // leave the child's reply count short and the read loop spinning to the
    // wall clock. No fixed sleep: the child's reads pace at the drain's
    // delivery rate (each write blocks until the child reads), and the host
    // finishes pushing all of a wave within milliseconds — orders of magnitude
    // before the head crosses the bound — so the queue is always full at the
    // splice. Newlines are counted per chunk (each reply carries exactly one),
    // never by re-scanning the accumulated total, which would be O(n²).
    const { runtime } = await setup({ maxWallMs: 60_000 })
    const result = await runtime.run({
      program: [
        'import os',
        'frame = b\'{"type":"call","id":%d,"global":"tools","name":"big","args":{}}\\n\'',
        'for i in range(1024):',
        '    view = memoryview(frame % i)',
        '    while view:',
        '        view = view[os.write(3, view):]',
        'seen = 0',
        'while seen < 500:',
        '    chunk = os.read(3, 65536)',
        '    if not chunk:',
        '        break',
        '    seen += chunk.count(b"\\n")',
        'for i in range(500):',
        '    view = memoryview(frame % (1024 + i))',
        '    while view:',
        '        view = view[os.write(3, view):]',
        'while seen < 1524:',
        '    chunk = os.read(3, 65536)',
        '    if not chunk:',
        '        break',
        '    seen += chunk.count(b"\\n")',
        'return "done"',
      ].join('\n'),
      bindings: [{ global: 'tools', functions: { big: async () => 'x'.repeat(65 * 1024) } }],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
  }, 60_000)

  it('bounds a flood of zero-byte log lines through the per-entry separator charge', async () => {
    // Blank print() lines carry zero content bytes; without the +1 separator
    // charge they would bypass maxLogBytes entirely and grow the retained
    // array without bound. Each empty entry costs one byte, so a 64-byte
    // budget retains at most 64 entries before the marker.
    const { runtime } = await setup({ maxLogBytes: 64, maxWallMs: 10_000 })
    const result = await runtime.run({
      program: [
        'for _ in range(10000):',
        '    print()',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs.length).toBeLessThanOrEqual(65)
    expect(result.logs.some(line => line.includes('log capture truncated'))).toBe(true)
  })

  it('reassembles multibyte UTF-8 split across stray-output pipe chunks', async () => {
    // A single os.write far past the 64 KiB pipe buffer forces multiple
    // 'data' chunks; when the boundary lands inside a multibyte sequence,
    // per-chunk decoding would corrupt it into replacement characters. Raw bytes
    // are buffered and only decoded once a complete line (or the whole tail at
    // flush) is assembled, so the split sequence is whole by the time it is
    // decoded. The payload spans every valid multibyte lead class so
    // accrueStrayCost's per-lead continuation ranges are all exercised: U+0900
    // (E0 A4 80, the range-restricted E0 lead), U+4F60 and U+597D (E4/E5, plain
    // 3-byte), U+1F600 (F0, the range-restricted F0 lead), and U+10FFFF (F4 8F
    // BF BF, the range-restricted F4 lead).
    const { runtime } = await setup({ maxLogBytes: 1024 * 1024 })
    const result = await runtime.run({
      program: [
        'import os',
        // os.write is one syscall and returns a partial count on a full
        // pipe, so loop until the whole payload (odd prefix -> a chunk
        // boundary lands inside a multibyte sequence) is out.
        String.raw`payload = b"a" * 65535 + "\u0900\u4f60\u597d\U0001f600\U0010ffff".encode("utf-8")`,
        'view = memoryview(payload)',
        'while view:',
        '    view = view[os.write(1, view):]',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    const text = result.logs.join('')
    expect(text).toContain('\u0900\u4f60\u597d\u{1f600}\u{10ffff}')
    expect(text).not.toContain('\ufffd')
  })

  it('flushes a stray-output byte sequence left incomplete when the pipe ends', async () => {
    // The child writes the first two bytes of a 3-byte UTF-8 character to fd 1
    // and exits, so the pipe closes with the sequence unfinished in the raw
    // residual. The 'end' flush decodes the residual with `toString('utf8')`,
    // which renders the stranded bytes as U+FFFD instead of dropping them.
    const { runtime } = await setup({ maxLogBytes: 1024 * 1024 })
    const result = await runtime.run({
      program: [
        'import os',
        // b"\xe4\xbd" is the leading two bytes of U+4F60; no continuation byte
        // follows before exit.
        String.raw`os.write(1, b"\xe4\xbd")`,
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs.join('')).toContain('�')
  })

  it('rejects reserved words of EITHER backend language as binding globals', async () => {
    // The seam's portable contract: `lambda` (Python keyword, legal JS name)
    // and `typeof` (JS keyword, legal Python name) are both refused, so a
    // namespace list valid on one backend is valid on every backend.
    const { runtime } = await setup()
    for (const global of ['lambda', 'typeof']) {
      await expect(runtime.run({
        program: 'return 1',
        bindings: [{ global, functions: {} }],
      })).rejects.toThrow(/is not a usable Python identifier/)
    }
  })

  it('captures stray stdout bytes the child writes bypassing sys.stdout', async () => {
    // Model code that writes to fd 1 via os.write() bypasses the Python-side
    // LogBuffer, so the host's stray-byte capture on child.stdout is what
    // records it.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import os',
        'os.write(1, b"stray stdout\\n")',
        'os.write(2, b"stray stderr\\n")',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs.join('')).toContain('stray stdout')
    expect(result.logs.join('')).toContain('stray stderr')
  })

  it('flushes bytes written through sys.__stdout__/sys.__stderr__ before the done frame', async () => {
    // The bootstrap only replaces sys.stdout/sys.stderr with the _LogStream;
    // sys.__stdout__/sys.__stderr__ are the original block-buffered wrappers
    // over fd 1/2. A program that writes through them without an explicit flush
    // would lose those bytes when the host SIGTERMs the child right after the
    // done frame (the default SIGTERM disposition terminates without
    // interpreter finalization). The settlement flush now drains the original
    // std streams before sending the done frame, so the bytes land in the
    // kernel pipe buffer and the host's stray capture records them.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import sys',
        // `-u` makes the streams write-through; re-enable block buffering so
        // the bytes sit in the wrapper until the SETTLEMENT drain flushes them
        // — the drain path, not the -u immediate write, is what this case pins.
        'if hasattr(sys.__stdout__, "reconfigure"):',
        '    sys.__stdout__.reconfigure(write_through=False)',
        '    sys.__stderr__.reconfigure(write_through=False)',
        'sys.__stdout__.write("orig stdout\\n")',
        'sys.__stderr__.write("orig stderr\\n")',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    expect(result.logs.join('')).toContain('orig stdout')
    expect(result.logs.join('')).toContain('orig stderr')
  }, 15_000)

  it('escalates to SIGKILL when the program traps SIGTERM and ignores the grace period', async () => {
    // A program that traps SIGTERM should still die: the kill() escalation
    // fires SIGKILL after graceMs. The full run reports either timeout (wall)
    // or worker-exit depending on which finish reason wins the race.
    const { runtime } = await setup({ maxWallMs: 400, graceMs: 200 })
    const result = await runtime.run({
      program: [
        'import signal, time',
        'signal.signal(signal.SIGTERM, lambda *a: None)',
        'while True: time.sleep(1)',
      ].join('\n'),
      bindings: [],
    })
    expect(['timeout', 'worker-exit']).toContain(result.error?.kind)
  }, 6000)

  it('bounds the fd-3 receive buffer against a newline-free flood', async () => {
    // A program looping os.write(3, ...) with no newline would grow the host
    // accumulator unbounded (the child's RLIMIT_AS does not cover the host
    // string). The frame cap is a fixed 64 MiB memory-safety invariant —
    // deliberately NOT derived from maxValueBytes, because legitimate binding
    // call frames may be large. We flood slightly past it in 8 MiB writes so
    // the test terminates promptly once the guard trips.
    const ceiling = 64 * 1024 * 1024
    const { runtime } = await setup({ maxWallMs: 60_000, addressSpaceMb: 2048 })
    const start = Date.now()
    const result = await runtime.run({
      program: [
        'import os',
        `for _ in range(${Math.ceil((ceiling * 1.1) / (8 * 1024 * 1024))}):`,
        '    os.write(3, b"A" * (8 * 1024 * 1024))',
        'return "never"',
      ].join('\n'),
      bindings: [],
    })
    const elapsed = Date.now() - start
    expect(result.error?.kind).toBe('worker-exit')
    expect(result.error?.message).toContain(`protocol frame exceeded ${ceiling} bytes`)
    // The breach ends the run before the wall ceiling (the run did not idle
    // out); absolute pipe throughput varies too much under parallel suites
    // for a tight bound.
    expect(elapsed).toBeLessThan(30_000)
  }, 45_000)

  it('fails a forged oversized done value host-side as output-limit', async () => {
    // The Python-side _done_with_value check is bypassable by writing a done
    // frame straight to fd 3. The host re-enforces maxValueBytes; the seam
    // forbids substituting a truncated value, so the run FAILS as output-limit
    // instead of returning a lie.
    const maxValueBytes = 64
    const { runtime } = await setup({ maxValueBytes })
    const result = await runtime.run({
      program: [
        'import os, json',
        'big = "B" * 5000',
        'os.write(3, json.dumps({"type":"done","value":big}).encode() + b"\\n")',
        // The real done never sends; the forged one settles the run.
        'import time',
        'time.sleep(5)',
      ].join('\n'),
      bindings: [],
    })
    expect(result.value).toBeUndefined()
    expect(result.error?.kind).toBe('output-limit')
    expect(result.error?.message).toContain('exceeded 64 bytes')
  }, 8000)

  it('drops a forged oversized log frame on its code-unit lower bound, before escaping it', async () => {
    // A forged `log` frame carrying a control-heavy string: NULs escape
    // several-fold (one NUL -> six bytes `\u0000`). The raw frame stays under
    // the host's 64 MiB parse cap (4 MiB of `\u0000` text = 24 MiB raw) while
    // the escaped form would be ~24 MiB. Charging it required building that
    // escaped copy first, so a 32-byte maxLogBytes could still force a large
    // host allocation. The cheap `length + 3` lower bound truncates it instead.
    // The host's own heap is what is under test, so keep the child's address
    // space generous enough to BUILD the frame.
    const { runtime } = await setup({ maxLogBytes: 128, addressSpaceMb: 1024, maxWallMs: 60_000 })
    const before = process.memoryUsage().heapUsed
    const result = await runtime.run({
      program: [
        'import os',
        // Written as a raw frame so the child's own ledger never sees it.
        'os.write(3, b\'{"type":"log","text":"\' + b"\\\\u0000" * (4 * 1024 * 1024) + b\'"}\\n\')',
        'return "settled"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('settled')
    // The frame was dropped as one truncation marker, not retained.
    expect(result.logs).toEqual([logTruncationMarker(128)])
    // The escaped copy (~144 MiB) was never materialized.
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(256 * 1024 * 1024)
  }, 90_000)

  it('charges a forged log frame its escaped cost once past the code-unit lower bound', async () => {
    // The cheap lower bound only rejects what cannot possibly fit; a SHORT
    // control-heavy frame clears it and must still be charged what it costs on
    // the wire. Eleven NULs are 14 against the 64-byte ledger's cheap bound
    // (six bytes each, two quotes, one separator), so the full charge truncates.
    const { runtime } = await setup({ maxLogBytes: 64 })
    const result = await runtime.run({
      program: [
        'import os',
        'os.write(3, b\'{"type":"log","text":"\' + b"\\\\u0000" * 11 + b\'"}\\n\')',
        'return "settled"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('settled')
    expect(result.logs).toEqual([logTruncationMarker(64)])
  }, 8000)

  it('caps a forged done error.message from its code-unit prefix, never encoding the whole message', async () => {
    // `Buffer.from(message)` on a message near the frame ceiling allocates a
    // full UTF-8 copy before maxValueBytes applies. Only the first
    // maxValueBytes code units can fit the cap, so only that prefix is encoded
    // — at most 3x the cap in bytes. The message here is 48 MiB of ASCII: its
    // full encode would be another 48 MiB in the host.
    const maxValueBytes = 64
    const { runtime } = await setup({ maxValueBytes, addressSpaceMb: 1024, maxWallMs: 60_000 })
    const before = process.memoryUsage().heapUsed
    const result = await runtime.run({
      program: [
        'import os',
        'os.write(3, b\'{"type":"done","error":{"kind":"exception","message":"\' + b"E" * (48 * 1024 * 1024) + b\'"}}\\n\')',
        'import time',
        'time.sleep(30)',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    const message = result.error?.message ?? ''
    // The marker's 15 bytes come OUT of the 64-byte cap, so 49 E's precede it
    // and the whole string is exactly 64 bytes — not 64 plus the marker.
    expect(message).toBe(`${'E'.repeat(maxValueBytes - 15)}… [truncated]`)
    expect(Buffer.byteLength(message, 'utf8')).toBe(maxValueBytes)
    // JSON.parse already holds the 48 MiB string; the cap must not add a
    // second full-length copy on top of it.
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(256 * 1024 * 1024)
  }, 90_000)

  it('keeps a capped diagnostic within maxValueBytes, marker included', async () => {
    // The marker is part of the emitted diagnostic, so its bytes are reserved
    // from the cap rather than appended past it — the host meters this same
    // field downstream. Checked on BOTH producers: the child's own _cap_message
    // (a raised exception) and the host's capMessage (a forged done frame).
    const maxValueBytes = 40
    const { runtime } = await setup({ maxValueBytes })
    const raised = await runtime.run({
      program: 'raise ValueError("R" * 100000)',
      bindings: [],
    })
    expect(raised.error?.kind).toBe('exception')
    const raisedMessage = raised.error?.message ?? ''
    expect(raisedMessage.endsWith('… [truncated]')).toBe(true)
    expect(Buffer.byteLength(raisedMessage, 'utf8')).toBeLessThanOrEqual(maxValueBytes)
    const forged = await runtime.run({
      program: [
        'import os, json',
        'msg = "F" * 100000',
        'os.write(3, json.dumps({"type":"done","error":{"kind":"exception","message":msg}}).encode() + b"\\n")',
        'import time',
        'time.sleep(5)',
      ].join('\n'),
      bindings: [],
    })
    expect(forged.error?.kind).toBe('exception')
    const forgedMessage = forged.error?.message ?? ''
    expect(forgedMessage.endsWith('… [truncated]')).toBe(true)
    expect(Buffer.byteLength(forgedMessage, 'utf8')).toBe(maxValueBytes)
  }, 15_000)

  it('emits the marker alone when the cap is smaller than the marker itself', async () => {
    // With maxValueBytes below the marker's own 15 bytes there is no room for
    // message text; the marker still goes out, so the truncation stays reported
    // instead of the diagnostic silently becoming empty. Both producers agree.
    const { runtime } = await setup({ maxValueBytes: 4 })
    const raised = await runtime.run({ program: 'raise ValueError("R" * 500)', bindings: [] })
    expect(raised.error?.kind).toBe('exception')
    expect(raised.error?.message).toBe('… [truncated]')
    const forged = await runtime.run({
      program: [
        'import os, json',
        'os.write(3, json.dumps({"type":"done","error":{"kind":"exception","message":"F" * 500}}).encode() + b"\\n")',
        'import time',
        'time.sleep(5)',
      ].join('\n'),
      bindings: [],
    })
    expect(forged.error?.kind).toBe('exception')
    expect(forged.error?.message).toBe('… [truncated]')
  }, 15_000)

  it('caps a forged done error.message without splitting a surrogate pair', async () => {
    // At exactly maxValueBytes code units the prefix can end on a high
    // surrogate whose low half sits just outside it. `Buffer.from` encodes that
    // orphan as U+FFFD — the same corruption a mid-sequence byte cut causes —
    // and those three replacement bytes sit past the marker-reserved budget, so
    // the byte trim-back drops them.
    const maxValueBytes = 32
    const { runtime } = await setup({ maxValueBytes })
    const result = await runtime.run({
      program: [
        'import os, json',
        // 32 ASCII chars then astral characters: code unit 32 is the first
        // character's high surrogate (Python spells it as one code point, so
        // json.dumps emits the raw 4 bytes the host reads back as a pair).
        'msg = "A" * 32 + "\\U0001f600" * 4',
        'os.write(3, json.dumps({"type":"done","error":{"kind":"exception","message":msg}}).encode() + b"\\n")',
        'import time',
        'time.sleep(5)',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    // 17 A's fill the marker-reserved budget; no orphaned half, no U+FFFD.
    expect(result.error?.message).toBe(`${'A'.repeat(17)}… [truncated]`)
    expect(Buffer.byteLength(result.error?.message ?? '', 'utf8')).toBe(maxValueBytes)
  }, 8000)

  it('returns a diagnostic under a third of the cap untouched, skipping the encode', async () => {
    // Under maxValueBytes/3 code units a message cannot overflow the cap
    // whatever it holds (3 bytes is the per-code-unit maximum), so the fast
    // path returns it without encoding anything. Non-ASCII proves the bound is
    // the code-unit count, not a byte assumption: 6 characters at 3 bytes each
    // is 18 bytes, inside the 64-byte cap.
    const { runtime } = await setup({ maxValueBytes: 64 })
    const result = await runtime.run({
      program: [
        'import os, json',
        'os.write(3, json.dumps({"type":"done","error":{"kind":"exception","message":"中文中文中文"}}).encode() + b"\\n")',
        'import time',
        'time.sleep(5)',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.message).toBe('中文中文中文')
  }, 8000)

  it('re-caps a forged done error.message host-side on a UTF-8 boundary', async () => {
    // A forged done frame can carry an arbitrarily long error message; the
    // host caps it to maxValueBytes and appends the shared marker. The
    // message is emoji-dense and the cap is chosen so the marker-reserved
    // 51-byte cut lands INSIDE a 4-byte sequence (one ASCII byte then 4-byte
    // runs, so only a cut at 1 + 4k is aligned) — the cap must trim back to a
    // code-point boundary rather than decode a replacement character, which
    // would also exceed the cap.
    const maxValueBytes = 66
    const { runtime } = await setup({ maxValueBytes })
    const result = await runtime.run({
      program: [
        'import os, json',
        'msg = "E" + "\\U0001f600" * 2000',
        'os.write(3, json.dumps({"type":"done","error":{"kind":"exception","message":msg}}).encode() + b"\\n")',
        'import time',
        'time.sleep(5)',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    const message = result.error?.message ?? ''
    expect(message.endsWith('… [truncated]')).toBe(true)
    const marker = '… [truncated]'
    const body = message.slice(0, message.length - marker.length)
    // The WHOLE message, marker included, honors the cap.
    expect(Buffer.byteLength(message, 'utf8')).toBeLessThanOrEqual(maxValueBytes)
    // 'E' plus 12 emoji is 49 bytes: the trim-back walked the 51-byte budget
    // down past two continuation bytes rather than splitting the 13th.
    expect(body).toBe(`E${'\u{1f600}'.repeat(12)}`)
    // The cut landed on a code-point boundary — no replacement character.
    expect(body).not.toContain('\ufffd')
  }, 8000)

  it('bounds a single oversized newline-terminated line on fd 3', async () => {
    // The same cap applies to one giant framed line. Write EXACTLY the
    // cap with no newline — at the limit, not past it, so nothing trips —
    // then a small newline tail, which is the chunk that crosses.
    const ceiling = 64 * 1024 * 1024
    const { runtime } = await setup({ maxWallMs: 60_000, addressSpaceMb: 2048 })
    const result = await runtime.run({
      program: [
        'import os',
        'chunk = b"A" * (8 * 1024 * 1024)',
        `for _ in range(${ceiling / (8 * 1024 * 1024)}):`,
        '    os.write(3, chunk)',
        'os.write(3, b"AAAA\\n")',
        'return "never"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('worker-exit')
    expect(result.error?.message).toContain(`protocol frame exceeded ${ceiling} bytes`)
  }, 90_000)

  it('rejects an over-cap newline-free fd-3 buffer without first joining it into one line', async () => {
    // The cap has to be enforced on the byte COUNTER before Buffer.concat,
    // not on the joined line afterwards: the join is a second copy of
    // everything held, so a program could force roughly twice the advertised
    // 64 MiB of host memory before anything rejected it.
    //
    // This program writes past the cap with no newline: the counter crosses on
    // the 9th 8 MiB write (72 MiB) while the buffer is still a single unframed
    // line, so the pre-join check rejects it without concat-ing a second copy.
    // Checking the joined line instead would have produced a 72 MiB FIRST LINE
    // that the per-line bound then dropped only after the doubling had happened.
    const ceiling = 64 * 1024 * 1024
    const { runtime } = await setup({ maxWallMs: 60_000, addressSpaceMb: 2048 })
    const result = await runtime.run({
      program: [
        'import os',
        'chunk = b"A" * (8 * 1024 * 1024)',
        `for _ in range(${ceiling / (8 * 1024 * 1024) + 1}):`,
        '    os.write(3, chunk)',
        'return "never"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.value).toBeUndefined()
    expect(result.error?.kind).toBe('worker-exit')
    expect(result.error?.message).toContain(`protocol frame exceeded ${ceiling} bytes`)
  }, 120_000)

  it('keeps two within-cap frames whose combined buffer crosses the cap', async () => {
    // The unframed byte counter charges the WHOLE buffer, which legitimately
    // holds several frames each within FRAME_PARSE_CAP_BYTES. A first frame of
    // exactly the cap followed by a second frame crosses the counter without
    // either frame exceeding the cap; the first-frame check (not the counter)
    // must let them through, or a legitimate near-cap frame plus a trailing
    // frame would be misreported as a worker-exit.
    const { runtime } = await setup({ maxWallMs: 60_000, addressSpaceMb: 2048 })
    const result = await runtime.run({
      program: [
        'import os',
        'chunk = b"A" * (8 * 1024 * 1024)',
        // Exactly the cap, no newline — at the limit, so nothing trips.
        'for _ in range(8):',
        '    os.write(3, chunk)',
        // A newline, then a small legitimate log frame.
        'os.write(3, b"\\n{\\"type\\":\\"log\\",\\"text\\":\\"after-cap-frames\\"}\\n")',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('done')
    expect(result.logs).toContain('after-cap-frames')
  }, 120_000)

  it('rejects an oversized first frame that lands on the sealing threshold with a newline', async () => {
    // The fragment-count seal runs only on newline-free chunks (the ELSE half
    // of the newline branch), so a chunk that carries the first newline always
    // reaches the join and its first-frame check; sealing it into a block
    // would empty pendingChunks, leave sawNewline false, and skip that check.
    // Whether the pipe delivers exactly 1024 chunks is timing-dependent, but
    // the oversized first frame (63.9 MiB of A's + 12289 more before the
    // newline) exceeds FRAME_PARSE_CAP_BYTES no matter how it arrives — the
    // case pins the worker-exit settlement, not a pre/post copy-count
    // distinction (both orders reject an over-cap frame).
    const { runtime } = await setup({ maxWallMs: 60_000, addressSpaceMb: 2048 })
    const result = await runtime.run({
      program: [
        'import os',
        // 4 KiB writes are <= PIPE_BUF, so each os.write is atomic and the
        // host sees one chunk per write; 16384 of them accumulate 64 MiB of
        // newline-free bytes (16 fragment-count seals of 1024 chunks).
        'chunk = b"A" * 4096',
        'for _ in range(16384):',
        '    os.write(3, chunk)',
        // 12289 more A's push the first frame past 64 MiB; drain-loop so the
        // write cannot truncate, then a newline and a small legitimate frame.
        "data = b'A' * 12289 + b'\\n' + b'{\"type\":\"log\",\"text\":\"after-seal\"}\\n'",
        'view = memoryview(data)',
        'while view:',
        '    view = view[os.write(3, view):]',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('worker-exit')
    expect(result.error?.message).toContain('protocol frame exceeded')
  }, 120_000)

})
