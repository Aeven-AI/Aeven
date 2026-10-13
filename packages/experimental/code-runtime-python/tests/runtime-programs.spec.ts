import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { PythonCodeRuntime } from '../src/index.ts'
import { logTruncationMarker } from '../src/protocol.ts'
import type { CodeJsonValue, CodeRunResult } from '@aeven/code-runtime'
import { cleanupTempFixtures, setup, tools } from './harness.ts'

// Remove every fixture this file created, so repeated runs do not accumulate
// `avn-*` directories and wrappers in the shared tmpdir.
afterEach(cleanupTempFixtures)

describe('PythonCodeRuntime — programs and bindings', () => {
  it('runs a top-level script, captures print output, and returns `result`', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'x = 40',
        'y = 2',
        'print("hello", x + y)',
        'return {"answer": x + y}',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({ answer: 42 })
    // `print` in Python emits: text, ' ', text, '\n'. Concat the captured
    // fragments and assert the model-visible message survives.
    expect(result.logs.join('')).toContain('hello 42')
    // 15s: this is usually the suite's first real subprocess — a cold python3
    // start (interpreter + asyncio import) on a loaded CI runner can exceed
    // the 5s default alone; later tests reuse the warm page cache.
  }, 15_000)

  it('exposes only the platform temp directory from the host environment', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import os',
        'return {',
        '    "tmpdir": os.environ.get("TMPDIR"),',
        '    "path": os.environ.get("PATH"),',
        '    "home": os.environ.get("HOME"),',
        '    "token": os.environ.get("DEEPSEEK_API_KEY"),',
        '}',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({ tmpdir: tmpdir(), path: null, home: null, token: null })
    expect(result.logs).toEqual([])
  })

  it('bridges binding calls both ways and rejects the program-side call on a host rejection', async () => {
    const { runtime } = await setup()
    const calls: unknown[] = []
    const result = await runtime.run({
      program: [
        'first = await tools.echo({"n": 1})',
        'caught = ""',
        'try:',
        '    await tools.fail({})',
        'except RuntimeError as e:',
        '    caught = str(e)',
        'return {"first": first, "caught": caught}',
      ].join('\n'),
      bindings: tools({
        echo: async (args) => { calls.push(args); return { echoed: args as CodeJsonValue } },
        fail: async () => { throw new Error('nope') },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({ first: { echoed: { n: 1 } }, caught: 'nope' })
    expect(calls).toEqual([{ n: 1 }])
  })

  it('keeps decoding binding replies when _decode_json_plain is rebound', async () => {
    // read_frame_async resolves _decode_json_plain at call time; a program that
    // rebinds __main__._decode_json_plain would otherwise kill the reply pump
    // (a broken decode strands every pending Future to the wall clock). The
    // decode primitives are def-time captures on the channel methods, so a
    // rebind cannot break reply delivery.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import __main__',
        '__main__._decode_json_plain = None',
        'first = await tools.echo({"n": 1})',
        'return first',
      ].join('\n'),
      bindings: tools({
        echo: async args => ({ echoed: args as CodeJsonValue }),
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({ echoed: { n: 1 } })
  }, 15_000)

  it('keeps dispatch working when _lossless_json_violation, asyncio, and send_sync are rebound', async () => {
    // dispatch binds _lossless_json_violation, asyncio.get_event_loop, and the
    // channel's send method into _run locals before the program runs, so a
    // rebind of __main__._lossless_json_violation/__main__.asyncio/
    // __main__.ProtocolChannel.send_sync cannot turn a legitimate binding call
    // into an exception or a wall-clock timeout.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import __main__',
        'def boom(*a, **k):',
        '    raise RuntimeError("hijacked")',
        '__main__._lossless_json_violation = boom',
        '__main__.asyncio = boom',
        '__main__.ProtocolChannel.send_sync = boom',
        '__main__._encode_json_plain = boom',
        '__main__.ProtocolChannel.write_encoded = boom',
        'first = await tools.echo({"n": 1})',
        'return first',
      ].join('\n'),
      bindings: tools({
        echo: async args => ({ echoed: args as CodeJsonValue }),
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({ echoed: { n: 1 } })
  }, 15_000)

  it('keeps the reply pump reading when the read_frame_async class attribute is rebound', async () => {
    // _pump_replies' frame reader is a bound method captured by _run before the
    // program runs and passed in as an explicit argument, so a program rebinding
    // `__main__.ProtocolChannel.read_frame_async` cannot redirect the pump (a
    // body-local `channel.read_frame_async` lookup would resolve the rebound
    // class attribute, since the pump starts after the program's top-level
    // statements).
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import __main__',
        'async def boom(*a, **k):',
        '    raise RuntimeError("hijacked reader")',
        '__main__.ProtocolChannel.read_frame_async = boom',
        'first = await tools.echo({"n": 1})',
        'return first',
      ].join('\n'),
      bindings: tools({
        echo: async args => ({ echoed: args as CodeJsonValue }),
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({ echoed: { n: 1 } })
  }, 15_000)

  it('keeps the rejection contract when _BindingRejection is rebound', async () => {
    // `dispatch`'s except clause resolves `_BindingRejection` at call time; a
    // program that rebinds `__main__._BindingRejection = ValueError` would
    // otherwise let the internal marker type leak into model code (the program
    // would catch a `ValueError` for a host rejection). The class is now bound
    // into `_run` locals before the program runs, so a host rejection still
    // surfaces as the declared `RuntimeError`.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import __main__',
        '__main__._BindingRejection = ValueError',
        'caught = ""',
        'try:',
        '    await tools.fail({})',
        'except RuntimeError as e:',
        '    caught = e.args[0] if e.args else ""',
        'except Exception as e:',
        '    caught = "WRONG TYPE: " + type(e).__name__',
        'return caught',
      ].join('\n'),
      bindings: tools({
        fail: async () => { throw new Error('nope') },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('nope')
  }, 15_000)

  it('still answers the call when the rejection value cannot be converted to a string', async () => {
    // `messageOf` calls `String(error)`, which runs the value's own conversion,
    // and this call site is a DETACHED async reply callback. A rejection whose
    // `Symbol.toPrimitive` throws therefore escaped as an unhandled rejection:
    // the reply frame was never written, the program stayed blocked on `await`,
    // and the run degraded to a `maxWallMs` timeout (observed) — a host with no
    // `unhandledRejection` listener would exit instead. The rejection must reach
    // the program as an ordinary error carrying a fixed placeholder.
    const { runtime } = await setup({ maxWallMs: 8_000 })
    const result = await runtime.run({
      program: [
        'try:',
        '    await tools.hostile({})',
        'except RuntimeError as e:',
        '    return "rejected: " + str(e)',
        'return "no rejection"',
      ].join('\n'),
      bindings: tools({
        hostile: async () => {
          throw { [Symbol.toPrimitive]() { throw new Error('toPrimitive blew up') } }
        },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('rejected: <unrenderable rejection value>')
  }, 15_000)

  it('still answers the call when an Error carries a cyclic value in place of its message', async () => {
    // `Error.message` is typed `string` but is a plain writable property, so a
    // rejection can carry any value there. Returning it verbatim handed a
    // non-string to `sendReply`, breaching `encodeJsonPlain`'s JSON-plain
    // precondition: a cyclic object grew the encoder stack until the host threw
    // RangeError from the detached reply callback, so no reply frame was written
    // and the run degraded to a `maxWallMs` timeout (observed). The conversion
    // must contain it — `String()` on a cycle throws inside the guard and lands
    // on the placeholder, so the program sees an ordinary error.
    const { runtime } = await setup({ maxWallMs: 8_000 })
    const result = await runtime.run({
      program: [
        'try:',
        '    await tools.hostile({})',
        'except RuntimeError as e:',
        '    return "rejected: " + str(e)',
        'return "no rejection"',
      ].join('\n'),
      bindings: tools({
        hostile: async () => {
          const cyclic: { self?: unknown; [Symbol.toPrimitive]: () => string } = {
            // A cycle alone is inert for `String()`; the throwing conversion is
            // what proves the guard runs rather than the encoder.
            [Symbol.toPrimitive]: () => { throw new Error('cyclic message') },
          }
          cyclic.self = cyclic
          const error = new Error('placeholder')
          // Writable per spec, so no cast is needed to install a non-string.
          ;(error as unknown as { message: unknown }).message = cyclic
          throw error
        },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('rejected: <unrenderable rejection value>')
  }, 15_000)

  it('renders an Error whose message is a value with no JSON form', async () => {
    // The non-cyclic arm. A number would not discriminate: `scalarJson` renders
    // it as digits and the child `str()`s the field back, so it survives the
    // wire either way. `undefined` is the value that separates the two orders —
    // `scalarJson` emits a bare `undefined` token, so the reply line is not JSON
    // at all, the child's parse drops the frame, and the program stays blocked
    // on `await` until the wall ceiling (observed). Converting first sends the
    // string "undefined", which the program receives as an ordinary rejection.
    const { runtime } = await setup({ maxWallMs: 8_000 })
    const result = await runtime.run({
      program: [
        'try:',
        '    await tools.absent({})',
        'except RuntimeError as e:',
        '    return "rejected: " + str(e)',
        'return "no rejection"',
      ].join('\n'),
      bindings: tools({
        absent: async () => {
          const error = new Error('placeholder')
          ;(error as unknown as { message: unknown }).message = undefined
          throw error
        },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('rejected: undefined')
  }, 15_000)

  it('runs a program with no await', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({
      program: 'return 2 + 2',
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(4)
  })

  it('returns JSON null whether the program returns None or falls off the end', async () => {
    // Python has no `undefined`: an async body that returns None and one that
    // never returns both yield None, so both complete as an exact JSON null.
    // (The worker/TS backend can tell `return undefined` from `return null`;
    // Python cannot, and reporting null for both is the honest rendering.)
    const { runtime } = await setup()
    const explicit = await runtime.run({ program: 'return None', bindings: [] })
    expect(explicit.error).toBeUndefined()
    expect(explicit.value).toBeNull()
    const noReturn = await runtime.run({ program: 'x = 1', bindings: [] })
    expect(noReturn.error).toBeUndefined()
    expect(noReturn.value).toBeNull()
  })

  it('settles with no value on a forged valueless done frame', async () => {
    // The child always sends a value now (return None → JSON null), so a done
    // frame with no value key can only be forged; the host settles it as a
    // value-less completion rather than crashing on the absent field.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import os',
        'os.write(3, b\'{"type":"done"}\\n\')',
        'import time',
        'time.sleep(5)',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBeUndefined()
  })

  it('coalesces print arguments into one log line, not per-write fragments', async () => {
    // print("a","b") calls write() per arg/sep/newline; the stream must emit
    // one logical line "a b" so PTC mode's join(newline) does not insert
    // spurious blank lines. Two prints → exactly two entries, no empties.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: ['print("a", "b")', 'print("c")', 'return None'].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['a b', 'c'])
  })

  it('flushes a print with no trailing newline', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({
      program: ['print("partial", end="")', 'return None'].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['partial'])
  })

  it('aggregates a large newline-free native write into one log entry, not one per pipe chunk', async () => {
    // A single `os.write` larger than one pipe read arrives as several Node
    // `data` chunks. `logs` entries are joined with `\n` downstream, so pushing
    // one entry per transport chunk would insert model-visible newlines at
    // arbitrary pipe boundaries inside one native write. Stray capture holds a
    // per-stream residual and admits only on a real `\n`, so a 200 KiB blast
    // with no newline reads back as exactly one entry with no interior breaks.
    const { runtime } = await setup({ maxLogBytes: 300_000 })
    const size = 200_000
    const result = await runtime.run({
      program: ['import os', `os.write(1, b"A" * ${size})`, 'return None'].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['A'.repeat(size)])
  })

  it('splits native output on its own newlines, one entry per line', async () => {
    // The complement of the aggregation case: real newlines in a native write
    // still delimit entries, matching the child's line-granular `log` frames.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: ['import os', 'os.write(1, b"one\\ntwo\\nthree")', 'return None'].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['one', 'two', 'three'])
  })

  it('preserves each native stream order while allowing backend-dependent interleaving', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import os',
        'os.write(1, b"stdout-one\\n")',
        'os.write(2, b"stderr-one\\n")',
        'os.write(1, b"stdout-two\\n")',
        'os.write(2, b"stderr-two\\n")',
        'return None',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs.indexOf('stdout-one')).toBeLessThan(result.logs.indexOf('stdout-two'))
    expect(result.logs.indexOf('stderr-one')).toBeLessThan(result.logs.indexOf('stderr-two'))
  })

  it('bounds a newline-free native flood by the ledger instead of buffering it whole', async () => {
    // A newline-free write far larger than maxLogBytes must not accumulate in
    // the host-side residual: when the pending residual would cross the budget
    // it is admitted (and truncated) immediately, and once the ledger has
    // truncated, later chunks stop buffering entirely. The run still completes
    // and the captured output ends at the truncation marker rather than
    // retaining the whole flood.
    const { runtime } = await setup({ maxLogBytes: 4096 })
    const result = await runtime.run({
      program: ['import os', 'os.write(1, b"A" * 2_000_000)', 'return None'].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs.at(-1)).toBe(logTruncationMarker(4096))
    // The retained output is bounded by the budget, not the 2 MB flood.
    expect(result.logs.join('').length).toBeLessThan(4096)
  })

  it('bounds a newline-free single-character Python write drip by the fragment cap, not OOM', async () => {
    // The child-side `_LogStream` buffers one fragment per `write` (so
    // `print("x", end="")` does not concatenate quadratically). A newline-free
    // drip of one character per call past a large `maxLogBytes` would otherwise
    // accumulate one list slot (and one str object) per call — 25 M calls =
    // ~25 M slots, which OOMs the host on its own accounting before the byte
    // budget is reached. The stream seals the fragment list past
    // `_PENDING_MAX_CHUNKS` into one joined block (character count unchanged),
    // bounding the live fragment count exactly as the host-side `captureStray`
    // seal does. This drives well past the cap and asserts the run still
    // completes with a truncation marker rather than a MemoryError.
    const { runtime } = await setup({ maxLogBytes: 4096 })
    const result = await runtime.run({
      program: [
        'import sys',
        'for _ in range(200_000):',
        '    sys.stdout.write("x")',
        'return None',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs.at(-1)).toBe(logTruncationMarker(4096))
  })

  it('bounds a control-char-dense native residual by serialized cost, not raw length', async () => {
    // A newline-free NUL flood passes the cheap `length + 3` lower bound at a
    // raw length well under the budget, but each NUL serializes to `\u0000` (6
    // bytes), so the true JSON cost is ~6x. The ledger must charge that
    // serialized cost — and `jsonStringCostUpTo` must measure it WITHOUT
    // allocating the escaped copy, so a near-budget line under a large
    // maxLogBytes cannot momentarily allocate a multi-gigabyte `JSON.stringify`
    // result. Under a small budget the residual is truncated once the serialized
    // cost crosses it.
    const { runtime } = await setup({ maxLogBytes: 4096 })
    const result = await runtime.run({
      program: ['import os', 'os.write(1, b"\\x00" * 4000)', 'return None'].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs.at(-1)).toBe(logTruncationMarker(4096))
  })

  it('rejects an output budget that could breach addressSpaceMb during encode at load', async () => {
    // The child builds, charges, and encodes a `maxLogBytes` log entry or a
    // `maxValueBytes` completion value under RLIMIT_AS, and both trigger on
    // character count against a serialized-byte budget — an astral character is
    // one character but ~4 bytes stored and ~4 encoded, and THREE such copies are
    // live at the peak (the caller's write argument, the slice/join handed to
    // push, and the encode copy), so a budget approaching the address space lets a
    // legitimate near-budget output breach it and die as worker-exit. The
    // incompatible pair is rejected at load: each budget times the worst-case
    // multiple (12) must fit the address space LEFT after the fixed interpreter
    // baseline. Against a 256 MiB address space that leaves 192 MiB budgetable
    // (~16 MiB admissible), so a 50 MB cap is far over; the default caps against
    // 512 MiB are not. Both budgets are gated symmetrically — the value case sets
    // a default-fitting maxLogBytes so the maxValueBytes check is what fires.
    const ctxLog = new Context()
    await expect(ctxLog.plugin(PythonCodeRuntime, { maxLogBytes: 50_000_000, addressSpaceMb: 256 }))
      .rejects.toThrow(/maxLogBytes times the 12x worst-case Unicode expansion must fit/)
    const ctxValue = new Context()
    await expect(ctxValue.plugin(PythonCodeRuntime, { maxValueBytes: 50_000_000, addressSpaceMb: 256 }))
      .rejects.toThrow(/maxValueBytes times the 12x worst-case Unicode expansion must fit/)
    // Discriminates 12 from 8: a 48 MiB maxLogBytes against a 512 MiB address
    // space leaves 448 MiB budgetable. 48*8 = 384 MiB fits (the old 8x multiple
    // wrongly ADMITTED this), but 48*12 = 576 MiB does not. The ~12x peak this
    // guards is the NEWLINE path's single near-budget write — the caller's own
    // string, the line slice, and the encode copy live at once. The settlement
    // flush is no longer the binding case: `flush_line` drops the pending chunks
    // before its push, so it holds two copies, not three.
    const ctxTwelve = new Context()
    await expect(ctxTwelve.plugin(PythonCodeRuntime, { maxLogBytes: 48 * 1024 * 1024, addressSpaceMb: 512 }))
      .rejects.toThrow(/maxLogBytes times the 12x worst-case Unicode expansion must fit/)
    // An addressSpaceMb at or below the interpreter baseline leaves nothing
    // budgetable, so no budget value can pass. It is rejected on its own terms:
    // the budget loop would otherwise report "a limit of -1" (or -2796203 at
    // 32 MiB) while naming maxLogBytes, sending the operator to the wrong knob.
    const ctxBaseline = new Context()
    await expect(ctxBaseline.plugin(PythonCodeRuntime, { addressSpaceMb: 64 }))
      .rejects.toThrow(/addressSpaceMb must exceed the 67108864-byte interpreter baseline/)
    const ctxBelow = new Context()
    await expect(ctxBelow.plugin(PythonCodeRuntime, { addressSpaceMb: 32 }))
      .rejects.toThrow(/addressSpaceMb must exceed the 67108864-byte interpreter baseline/)
    // The default caps against the default 512 MiB address space load.
    const ok = new Context()
    const fiber = await ok.plugin(PythonCodeRuntime, { maxLogBytes: 65536, maxValueBytes: 32768, addressSpaceMb: 512 })
    await fiber.dispose()
  })

  it('bounds an illegal-UTF-8 native residual by its U+FFFD-decoded cost', async () => {
    // Every 0xFF byte is illegal in any UTF-8 sequence, so `toString('utf8')`
    // renders each as U+FFFD (3 serialized bytes). `accrueStrayCost` must charge
    // that 3, not the raw 1: otherwise the newline-free residual grows to a full
    // budget's worth of RAW bytes before flushing — a ~3x undercount that near a
    // large maxLogBytes retains hundreds of MiB then expands toward a ~1 GiB peak
    // in flushStray's concat + toString. Paced single-byte writes (each its own
    // `data` chunk, like the sealing case) expose the sub-chunk accrual: charged
    // at 3 the residual crosses a 3072-byte budget after ~1024 bytes and flushes;
    // charged at 1 it would need ~3072 bytes, so the peak residual triples. The
    // largest merged buffer is the discriminator.
    const realConcat = Buffer.concat.bind(Buffer)
    let maxConcat = 0
    Buffer.concat = (list: readonly Uint8Array[], total?: number): Buffer<ArrayBuffer> => {
      const merged = realConcat(list, total)
      if (merged.length > maxConcat) maxConcat = merged.length
      return merged
    }
    let result: CodeRunResult
    try {
      const { runtime } = await setup({ maxLogBytes: 3072, maxWallMs: 30_000 })
      result = await runtime.run({
        program: [
          'import os',
          'for _ in range(6000):',
          '    os.write(1, b"\\xff")',
          '    os.sched_yield()',
          'return None',
        ].join('\n'),
        bindings: [],
      })
    } finally {
      Buffer.concat = realConcat
    }
    expect(result.error).toBeUndefined()
    expect(result.logs.at(-1)).toBe(logTruncationMarker(3072))
    // Charged at 3, the residual flushes around 1024 raw bytes; the largest
    // merged buffer stays well under 2048. A raw-byte undercount would let it
    // reach ~3072 before flushing, so 2048 discriminates.
    expect(maxConcat).toBeLessThan(2048)
  })

  it('charges a structurally-valid but illegal UTF-8 sequence its U+FFFD-decoded cost', async () => {
    // A CESU-8 lone surrogate `ED A0 80` is structurally well-formed (a 3-byte
    // lead plus two 0x80–0xBF continuations) but ILLEGAL: `toString('utf8')`
    // renders each of the three bytes as its own U+FFFD (serialized cost 9), not
    // one width-3 character. The newline-free flush trigger weighs the residual
    // through `accrueStrayCost`, which must validate each lead's
    // first-continuation range (ED excludes A0–BF) and charge the true 9 — else a
    // CESU flood undercounts 3x and the residual grows toward a full budget's raw
    // bytes before flushing, the same peak-memory vector as the 0xFF case. The
    // bytes are written one at a time (each its own `data` chunk, no pipe
    // coalescing) and `Buffer.concat` is wrapped to measure the peak residual.
    const realConcat = Buffer.concat.bind(Buffer)
    let maxConcat = 0
    Buffer.concat = (list: readonly Uint8Array[], total?: number): Buffer<ArrayBuffer> => {
      const merged = realConcat(list, total)
      if (merged.length > maxConcat) maxConcat = merged.length
      return merged
    }
    let result: CodeRunResult
    try {
      const { runtime } = await setup({ maxLogBytes: 3072, maxWallMs: 30_000 })
      result = await runtime.run({
        program: [
          'import os',
          'seq = (0xed, 0xa0, 0x80)',
          'for _ in range(2000):',
          '    for b in seq:',
          '        os.write(1, bytes((b,)))',
          '        os.sched_yield()',
          'return None',
        ].join('\n'),
        bindings: [],
      })
    } finally {
      Buffer.concat = realConcat
    }
    expect(result.error).toBeUndefined()
    expect(result.logs.at(-1)).toBe(logTruncationMarker(3072))
    // Each 3-byte sequence costs 9 (three U+FFFD), so single-byte-paced the
    // residual crosses the 3072 budget after ~342 raw bytes and flushes; the
    // largest merged buffer stays well under 2048. Charging the structural width
    // 3 would need ~1024 raw bytes, tripling the peak past 2048.
    expect(maxConcat).toBeLessThan(2048)
  })

  it('charges a lone surrogate its full six escaped bytes, not three', async () => {
    // A forged `log` frame carrying `\ud800` escapes materializes lone
    // surrogates after JSON.parse. `Buffer.byteLength` of U+FFFD is 3, but
    // ES2019 well-formed `JSON.stringify` emits `\ud800` at 6 bytes, so charging
    // the raw width would admit ~2x the configured budget of serialized bytes
    // (the same family as the NUL-flood undercount, at 2x rather than 6x). The
    // cost walker charges surrogates the full 6, so a flood truncates at budget.
    // Forged on fd 3 because Python stdout will not emit lone surrogates.
    const { runtime } = await setup({ maxLogBytes: 4096 })
    const result = await runtime.run({
      program: [
        'import os',
        // 1000 \ud800 escapes: charged at the buggy raw width 1000 * 3 = 3000
        // bytes fits under 4096 (wrongly admitted), but the correct serialized
        // width 1000 * 6 = 6000 bytes is over budget — so the ledger must
        // truncate. The count sits in the 683..1365 window where the two
        // chargings disagree, making the test discriminate.
        String.raw`frame = b'{"type":"log","text":"' + b'\\ud800' * 1000 + b'"}\n'`,
        'os.write(3, frame)',
        'return None',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs.at(-1)).toBe(logTruncationMarker(4096))
  })

  it('drops a second stray line in the same chunk once the first truncated the ledger', async () => {
    // One `os.write` carrying two newline-terminated lines where the first
    // exhausts maxLogBytes: the first line's admit truncates and marks the
    // ledger, and the second line's admit — reached in the same `data` callback
    // — must be the post-truncation no-op. Proves that branch is exercised, so
    // it carries no v8-ignore. Kept to 108 bytes (< the smallest PIPE_BUF, 512 on
    // macOS) so the whole payload lands in ONE atomic write and one `data`
    // callback — the two newlines cannot split across callbacks and leave the
    // branch un-exercised, which would be a hard-to-attribute per-file coverage
    // flake. The first line's 100 bytes already exceed the 64-byte budget, so it truncates.
    const { runtime } = await setup({ maxLogBytes: 64 })
    const result = await runtime.run({
      program: ['import os', 'os.write(1, b"A" * 100 + b"\\nSECOND\\n")', 'return None'].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs.at(-1)).toBe(logTruncationMarker(64))
    expect(result.logs.join('\n')).not.toContain('SECOND')
  })

  it('charges a broken multibyte sequence its U+FFFD bytes, split across pipe chunks', async () => {
    // A 3-byte lead (0xE4) whose continuation never arrives — the next byte is a
    // fresh ASCII 'A' — must be costed as U+FFFD (3) for the orphaned lead, not
    // folded into a phantom character. Driven byte-by-byte so the lead and the
    // breaking byte land in separate `data` chunks, exercising accrueStrayCost's
    // cross-chunk broken-sequence branch. The run completes and the bytes are
    // captured (rendered U+FFFD by toString), proving the walk resynchronizes.
    const { runtime } = await setup({ maxLogBytes: 1024 })
    const result = await runtime.run({
      program: [
        'import os',
        'os.write(1, b"\\xe4")',
        'os.sched_yield()',
        'os.write(1, b"A\\n")',
        'return None',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs.join('')).toContain('A')
    expect(result.logs.join('')).toContain('�')
  })

  it('charges the exact serialized cost of short-escape and quote/backslash characters', async () => {
    // Exercises every branch of jsonStringCostUpTo's per-character cost: a tab
    // and other C0 controls with short JSON forms (\t etc., 2 bytes), a quote
    // and backslash (2 bytes each), a `\uXXXX` control (6 bytes), a multibyte
    // BMP character (raw UTF-8 width), and plain ASCII. Under a budget large
    // enough to admit it, the line survives verbatim — proving the cost walker
    // does not over- or under-charge and the string round-trips unescaped.
    const { runtime } = await setup({ maxLogBytes: 4096 })
    const result = await runtime.run({
      program: ['import os', String.raw`os.write(1, "\ta\"b\\c\x01é\n".encode("utf-8"))`, 'return None'].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['\ta"b\\c\x01é'])
  })

  it('fails a completion dict with a non-string key as invalid-output (no key coercion)', async () => {
    // json.dumps would coerce {1: "a", "1": "b"} to a single "1" key, silently
    // dropping data. The shape validator rejects it before encoding.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: 'return {1: "first", "1": "second"}',
      bindings: [],
    })
    expect(result.value).toBeUndefined()
    expect(result.error?.kind).toBe('invalid-output')
    expect(result.error?.message).toContain('non-string dict key')
  })

  it('rejects a binding argument with a non-string dict key before dispatch', async () => {
    const { runtime } = await setup()
    let called = false
    const result = await runtime.run({
      program: [
        'caught = ""',
        'try:',
        '    await tools.sink({1: "x"})',
        'except RuntimeError as e:',
        '    caught = str(e)',
        'return caught',
      ].join('\n'),
      bindings: tools({ sink: async () => { called = true; return null } }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toContain('lossless JSON')
    expect(called).toBe(false)
  })

  it('fails a non-JSON completion value as invalid-output (no repr substitution)', async () => {
    // A set is not lossless JSON. The old draft substituted repr(); the seam
    // now requires refusing the run instead.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: 'return {1, 2, 3}',
      bindings: [],
    })
    expect(result.value).toBeUndefined()
    expect(result.error?.kind).toBe('invalid-output')
    expect(result.error?.message).toContain('lossless JSON')
    expect(result.error?.message).toContain('set')
  })

  it('fails a negative-zero completion value as invalid-output (sign bit is lossy over JSON)', async () => {
    // JSON serialization turns -0.0 into 0 (or JS -0), silently changing the
    // sign bit; the canonical lossless-JSON boundary rejects it, so the
    // Python side must too — as a completion and as a binding argument.
    const { runtime } = await setup()
    const completion = await runtime.run({
      program: 'return -0.0',
      bindings: [],
    })
    expect(completion.error?.kind).toBe('invalid-output')
    expect(completion.error?.message).toContain('negative zero')
    const argument = await runtime.run({
      program: [
        'try:',
        '    await tools.echo(-0.0)',
        '    return "accepted"',
        'except RuntimeError as e:',
        '    return str(e)',
      ].join('\n'),
      bindings: tools({ echo: async args => args as never }),
    })
    expect(argument.error).toBeUndefined()
    expect(argument.value).toContain('negative zero')
  })

  it('fails a NaN completion value as invalid-output (allow_nan=False)', async () => {
    // json.dumps would happily emit NaN by default, but NaN is not JSON; the
    // bootstrap passes allow_nan=False so it fails as invalid-output.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: 'return float("nan")',
      bindings: [],
    })
    expect(result.error?.kind).toBe('invalid-output')
  })

  it('fails an over-budget completion value as output-limit (child-side check)', async () => {
    const { runtime } = await setup({ maxValueBytes: 64 })
    const result = await runtime.run({
      program: 'return "V" * 5000',
      bindings: [],
    })
    expect(result.value).toBeUndefined()
    expect(result.error?.kind).toBe('output-limit')
    expect(result.error?.message).toContain('exceeded 64 bytes')
  })

  it('meters a control-heavy completion value without materializing its escaped form', async () => {
    // The child's lower bound admits a string by CHARACTER count, then the meter
    // charged what `_dump_string(current).encode()` returned -- building the
    // escaped copy plus its encode. Each NUL escapes to six bytes, so metering a
    // value the budget then REJECTS allocated ~6x the original twice over:
    // measured at 228.9 MiB of peak for a 20M-NUL string, against 19.1 MiB for
    // the counting path that returns the identical 120,000,002 bytes. Past
    // RLIMIT_AS the meter died as `exception: MemoryError`, inverting the
    // `output-limit` this seam promises for an over-budget value.
    //
    // 8M NULs is 8,000,002 raw but 48,000,002 escaped: over the 16 MiB budget
    // only when charged the escaped cost, so this also pins that the cheap
    // character bound alone does not decide the verdict.
    const { runtime } = await setup({ maxValueBytes: 16 * 1024 * 1024, maxWallMs: 60_000 })
    const result = await runtime.run({
      program: 'return "\\x00" * 8_000_000',
      bindings: [],
    })
    expect(result.value).toBeUndefined()
    expect(result.error?.kind).toBe('output-limit')
  }, 90_000)

  it('rejects a wide completion as output-limit before materializing its traversal state', async () => {
    // `[0] * 2000000` sits far above maxValueBytes but well below the frame
    // ceiling. The folded checker must reject it via the pre-enqueue bound —
    // BEFORE pushing two million elements onto the walk — so a small
    // addressSpaceMb does not turn the check itself into an RLIMIT_AS death.
    const { runtime } = await setup({ maxValueBytes: 64, addressSpaceMb: 256, maxWallMs: 15_000 })
    const result = await runtime.run({
      program: 'return [0] * 2000000',
      bindings: [],
    })
    expect(result.value).toBeUndefined()
    expect(result.error?.kind).toBe('output-limit')
    expect(result.error?.message).toContain('exceeded 64 bytes')
  }, 20_000)

  it('rejects a wide dict as output-limit without materializing its items list', async () => {
    // Same pre-enqueue bound on the dict branch: `len(current)` replaces
    // `list(current.items())`, which allocated one tuple per member before the
    // bound could reject the value. Two million entries under a 64-byte cap
    // fits the 256 MiB address space as a dict but not as a dict PLUS a
    // two-million-tuple list.
    const { runtime } = await setup({ maxValueBytes: 64, addressSpaceMb: 256, maxWallMs: 15_000 })
    const result = await runtime.run({
      program: 'return {str(i): 0 for i in range(2000000)}',
      bindings: [],
    })
    expect(result.value).toBeUndefined()
    expect(result.error?.kind).toBe('output-limit')
    expect(result.error?.message).toContain('exceeded 64 bytes')
  }, 20_000)

  it('meters a float completion in the host\'s number spelling', async () => {
    // CPython's repr disagrees with the host's String(number): `1.0` is three
    // bytes here and one there, `1e-07` pads the exponent the host writes as
    // `1e-7`. Both sides meter the SAME budget, so the child must count the
    // bytes the host will receive — otherwise a boundary-sized value is
    // falsely reported as output-limit.
    const { runtime } = await setup({ maxValueBytes: 1 })
    const integral = await runtime.run({ program: 'return 1.0', bindings: [] })
    expect(integral.error).toBeUndefined()
    expect(integral.value).toBe(1)

    const exponent = await setup({ maxValueBytes: 4 })
    const small = await exponent.runtime.run({ program: 'return 1e-7', bindings: [] })
    expect(small.error).toBeUndefined()
    expect(small.value).toBe(1e-7)

    // The spelling is a meter input, not a licence to overshoot: `1.5` is three
    // bytes on both sides and still fails a two-byte budget.
    const tight = await setup({ maxValueBytes: 2 })
    const over = await tight.runtime.run({ program: 'return 1.5', bindings: [] })
    expect(over.error?.kind).toBe('output-limit')
  })

  it('carries floats across the wire in the host\'s number spelling', async () => {
    // The child ENCODES with the same speller it meters with, so the frame the
    // host parses must reproduce every double exactly — including the branches
    // where CPython and ECMAScript disagree (integral floats, sub-1e-6
    // exponents, >= 1e21, and beyond-safe-range integral doubles whose exact
    // digits differ from the shortest round-trip form).
    const { runtime } = await setup()
    const result = await runtime.run({
      program: 'return [1.0, 100.0, 1.5, 0.1, 1e-7, 1e-6, 1e-5, 123.456, -2.5e-8, 1e21, float(2**60), 5e-324, 1.7976931348623157e308]',
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual([1, 100, 1.5, 0.1, 1e-7, 1e-6, 1e-5, 123.456, -2.5e-8, 1e21, 2 ** 60, 5e-324, 1.7976931348623157e308])
  })

  it('rejects a forged non-lossless done value host-side as invalid-output', async () => {
    // A forged done frame bypasses the child's _check_done_value. JSON.parse
    // turns 1e400 into Infinity; validateChildFrame no longer scans done.value,
    // so the host's own checkDoneValue must catch the non-lossless number.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import os',
        String.raw`os.write(3, b'{"type":"done","value":1e400}' + b'\n')`,
        'import time',
        'time.sleep(5)',
      ].join('\n'),
      bindings: [],
    })
    expect(result.value).toBeUndefined()
    expect(result.error?.kind).toBe('invalid-output')
    expect(result.error?.message).toContain('non-lossless number')
  })

  it('reports a syntax error as an exception without settling with a value', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({
      program: '$$invalid python$$',
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.message).toContain('SyntaxError')
    // The parse-time diagnostic must carry the same source label as compile and
    // runtime tracebacks (ast.parse passes filename="<model>"); a stale
    // "<unknown>" label would leak an inconsistent origin to the model.
    expect(result.error?.message).toContain('File \"<model>\"')
    expect(result.value).toBeUndefined()
  })

  it('reports a runtime raise as an exception with the traceback', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({
      program: 'raise ValueError("intentional")',
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.message).toContain('ValueError')
    expect(result.error?.message).toContain('intentional')
  })

  it('bounds a deep exception cause chain instead of burning the wall budget formatting it', async () => {
    // A chain thousands of links deep would make the rendering walk and
    // format() linear in its length, consuming maxWallMs. Rendering is capped
    // at 100 links with a marker; the run reports the exception well within
    // budget rather than timing out.
    const { runtime } = await setup({ maxValueBytes: 1024 * 1024, maxWallMs: 20_000 })
    const start = Date.now()
    const result = await runtime.run({
      program: [
        'err = None',
        'for i in range(3000):',
        '    try:',
        '        raise ValueError(i) from err',
        '    except ValueError as e:',
        '        err = e',
        'raise err',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.message).toContain('exception chain truncated at 100 links')
    expect(Date.now() - start).toBeLessThan(15_000)
  }, 25_000)

  it('bounds an over-cap chain without assigning to the live exception', async () => {
    // The cap used to be applied by severing the over-cap link ON the live
    // exception. An exception class overriding __setattr__ to raise turned that
    // assignment into model code running inside the bootstrap's failure
    // handler; the throw skipped the `done` send that sits after the handler,
    // so the host blocked on fd 3 and reported a maxWallMs timeout instead of
    // the model's own exception. Cutting the chain on the TracebackException
    // COPY touches no model hook, so the marker still appears and the run
    // reports `exception`.
    const { runtime } = await setup({ maxValueBytes: 1024 * 1024, maxWallMs: 15_000 })
    const start = Date.now()
    const result = await runtime.run({
      program: [
        'class Sealed(Exception):',
        '    def __setattr__(self, name, value):',
        '        raise RuntimeError("live mutation refused")',
        'err = None',
        'for i in range(150):',
        '    try:',
        '        raise Sealed(i) from err',
        '    except Sealed as e:',
        '        err = e',
        'raise err',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.message).toContain('Sealed')
    expect(result.error?.message).toContain('exception chain truncated at 100 links')
    // The sever attempt is what used to leak: its message must not appear, and
    // the run must settle well inside the wall budget rather than timing out.
    expect(result.error?.message).not.toContain('live mutation refused')
    expect(Date.now() - start).toBeLessThan(10_000)
  }, 20_000)

  it('still sends done when rendering the diagnostic itself raises', async () => {
    // format() reaches the exception's own __str__, so a model class whose
    // __str__ raises can throw from inside the failure handler. CPython's
    // _safe_string absorbs a raising __str__ during formatting, but the
    // fallback must hold for any throw on that path (a raising __repr__ of an
    // argument, a MemoryError under RLIMIT_AS), so the assertion is the
    // invariant that matters: a `done` frame carrying `exception`, never a
    // timeout, and never the failing renderer's own message.
    const { runtime } = await setup({ maxWallMs: 10_000 })
    const result = await runtime.run({
      program: [
        'class Unprintable(Exception):',
        '    def __str__(self):',
        '        raise RuntimeError("str refused")',
        '    def __repr__(self):',
        '        raise RuntimeError("repr refused")',
        'raise Unprintable()',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.message).toContain('Unprintable')
    expect(result.error?.message).not.toContain('str refused')
    expect(result.error?.message).not.toContain('repr refused')
  }, 15_000)

  it('sends done with an inert diagnostic when the whole rendering path raises', async () => {
    // Drive the fallback itself. `TracebackException.format` reads the
    // exception class's `__module__` to decide whether to qualify the name, and
    // a metaclass property can raise there — a throw INSIDE the formatter,
    // reached with no rebinding of anything the bootstrap owns. Without the
    // wrapper it escapes the handler, the `done` send never runs, and the host
    // times out at maxWallMs.
    const { runtime } = await setup({ maxWallMs: 10_000 })
    const result = await runtime.run({
      program: [
        'class Meta(type):',
        '    @property',
        '    def __module__(cls):',
        '        raise RuntimeError("renderer refused")',
        'class Hostile(ValueError, metaclass=Meta):',
        '    pass',
        'raise Hostile("original failure")',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    // The inert fallback names the class and a fixed literal; it must not carry
    // the renderer's message, and must not have become a timeout. `__name__` is
    // still a plain str here, so the class name survives.
    expect(result.error?.message).toBe('Hostile: <diagnostic rendering failed>')
  }, 15_000)

  it('falls back to a placeholder class name when __name__ itself raises', async () => {
    // The fallback reads type(exc).__name__, which a metaclass property can
    // hijack. It must neither run that override's failure into the handler nor
    // format a non-str __name__ into the message. The hostile `__module__` is
    // what drives execution into the fallback in the first place.
    const { runtime } = await setup({ maxWallMs: 10_000 })
    const result = await runtime.run({
      program: [
        'class Meta(type):',
        '    @property',
        '    def __module__(cls):',
        '        raise RuntimeError("renderer refused")',
        '    @property',
        '    def __name__(cls):',
        '        raise RuntimeError("name refused")',
        'class Nameless(Exception, metaclass=Meta):',
        '    pass',
        'raise Nameless()',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.message).toBe('<unknown>: <diagnostic rendering failed>')
  }, 15_000)

  it('reports the real exception when the program rebinds every name the failure path uses', async () => {
    // The bootstrap IS __main__, so `import __main__; __main__._X = ...` reaches
    // any module global a call-time lookup would read. The failure path is the
    // worst place for that: the reporter, the byte cap, the traceback formatter,
    // the settlement flush and the `done` send all run AFTER the `except` block,
    // so a replacement that raises skips the send, leaves the host blocked on
    // fd 3, and the run reports a maxWallMs timeout instead of the model's own
    // exception. Rebind all of them at once; the run must still carry the real
    // ValueError.
    const { runtime } = await setup({ maxWallMs: 10_000 })
    const result = await runtime.run({
      program: [
        'import __main__',
        'def boom(*a, **k):',
        '    raise RuntimeError("hijacked")',
        '__main__._SAFE_MODEL_TRACEBACK = boom',
        '__main__._cap_message = boom',
        '__main__._model_traceback = boom',
        '__main__._UNRENDERABLE_DIAGNOSTIC = boom',
        '__main__._LogStream.flush_line = boom',
        // `send_done` writes via LOCALLY-BOUND `_encode_json_plain` +
        // `ProtocolChannel.write_encoded`; rebinding these at call time must not
        // redirect the done frame (a late lookup would be `boom` -> worker-exit).
        '__main__.ProtocolChannel.send_sync = boom',
        '__main__.ProtocolChannel.write_encoded = boom',
        '__main__._encode_json_plain = boom',
        'raise ValueError("real failure")',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.message).toContain('ValueError: real failure')
    expect(result.error?.message).not.toContain('hijacked')
  }, 15_000)

  it('still delivers a done frame when a transitive encode name is rebound', async () => {
    // `send_done` binds `_encode_json_plain` and `ProtocolChannel.write_encoded`
    // into locals, but those callables' BODIES still resolve transitive module
    // globals at call time: `_encode_json_plain` reaches `_dump_scalar`/`_dump_string`/
    // `json.dumps`, and `write_encoded` reaches `os.write`. This bootstrap is
    // `__main__`, so rebinding `__main__._dump_scalar` to a raising function makes
    // the error-frame encode throw AFTER the `except` block. `send_done` catches
    // that and writes a fixed literal done frame (kind `exception`) with the
    // LOCALLY-BOUND `_os_write`/`_memoryview`/`_FALLBACK_DONE_FRAME` captured
    // before the program runs, so the host still gets a verdict — the run must be an
    // `exception`, never a `worker-exit`. The real message is lost (the literal
    // carries a fixed `<unrenderable>` text), which is acceptable: the verdict
    // outranks the diagnostic detail.
    const { runtime } = await setup({ maxWallMs: 10_000 })
    const result = await runtime.run({
      program: [
        'import __main__',
        'def boom(*a, **k):',
        '    raise RuntimeError("hijacked")',
        '__main__._dump_scalar = boom',
        '__main__.os = boom',
        // The fallback must also survive a rebind of its own primitives.
        '__main__._os_write = boom',
        '__main__._memoryview = boom',
        '__main__._FALLBACK_DONE_FRAME = boom',
        'raise ValueError("real failure")',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.kind).not.toBe('worker-exit')
  }, 15_000)

  it('still reports a model exception when the program rebinds BaseException', async () => {
    // `_run`'s outer try/except catches the program's failure and builds a
    // `done` frame. The clause previously used the module-global `BaseException`,
    // which the program (running as `__main__`) can rebind: `__main__.BaseException
    // = RuntimeError` makes the `except BaseException` resolve to `RuntimeError`,
    // so a subsequent `ValueError` does not match and escapes `_run` with no
    // `done` frame — misreporting the run as a `worker-exit`. The exception class
    // is now bound into a `_run` LOCAL before the program runs, so the rebind
    // cannot change which class the clause catches; the run must still report an
    // `exception`, not a `worker-exit`.
    const { runtime } = await setup({ maxWallMs: 10_000 })
    const result = await runtime.run({
      program: [
        'import __main__',
        '__main__.BaseException = RuntimeError',
        'raise ValueError("real failure")',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.kind).not.toBe('worker-exit')
  }, 15_000)

  it('still reports the exception when BaseException and the traceback reporter are rebound together', async () => {
    // The two rebind families compose: `__main__.BaseException = ValueError`
    // must not change which class the `_run` catch resolves (it is a pre-program
    // local), and a rebound reporter (`_SAFE_MODEL_TRACEBACK`/`_cap_message`/
    // `_model_traceback`/`_UNRENDERABLE_DIAGNOSTIC`) must not break the done
    // frame — `safe_model_traceback` holds its primitives as import-time closure
    // cells. A `KeyError` (not a `ValueError` subclass) escapes a catch that
    // resolves to the rebound class, so without the local binding the run would
    // misreport as `worker-exit`; with it, the run reports the exception and the
    // fallback reporter still produces the fixed literal.
    const { runtime } = await setup({ maxWallMs: 10_000 })
    const result = await runtime.run({
      program: [
        'import __main__',
        'def boom(*a, **k):',
        '    raise RuntimeError("hijacked")',
        '__main__.BaseException = ValueError',
        '__main__._SAFE_MODEL_TRACEBACK = boom',
        '__main__._cap_message = boom',
        '__main__._model_traceback = boom',
        '__main__._UNRENDERABLE_DIAGNOSTIC = boom',
        'raise KeyError("real failure")',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.kind).not.toBe('worker-exit')
  }, 15_000)

  it('rejects an fd-3 frame whose raw length exceeds the parse cap before joining it', async () => {
    // The 64 MiB frame parse cap bounds the RAW frame bytes, not the decoded
    // structure; a compact wide frame near that ceiling could decode to far
    // more host memory. The unframed-buffer counter is checked against
    // FRAME_PARSE_CAP_BYTES BEFORE the Buffer.concat join, so an oversized
    // frame is dropped at one copy of its wire bytes instead of being fully
    // joined (a second copy) and only then discarded in the line loop — the
    // peak-memory doubling the pre-join check exists to prevent. Fail-before:
    // without the check the frame is joined whole and parsed (its log text
    // admitted, truncating the ledger), and the run completes normally.
    const { runtime } = await setup({ maxWallMs: 60_000 })
    const result = await runtime.run({
      program: [
        'import os',
        // One frame just past the 64 MiB parse cap.
        'os.write(3, b"{\\"type\\":\\"log\\",\\"text\\":\\"" + b"a" * (65 * 1024 * 1024) + b"\\"}\\n")',
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('worker-exit')
    expect(result.error?.message).toContain('protocol frame exceeded')
  }, 90_000)

  it('caps an oversized rejection diagnostic so an invalid completion stays invalid-output', async () => {
    // _done_with_value caps its rejection diagnostic through _cap_message: a
    // hostile class name (huge type(value).__name__) would otherwise push the
    // done frame past the host's 64 MiB parse cap, misreporting an
    // invalid-output run as a worker-exit. The diagnostic is capped to the
    // value budget, so the frame always crosses the parser.
    const { runtime } = await setup({ maxWallMs: 60_000 })
    const result = await runtime.run({
      program: [
        'return type("N" * (70 * 1024 * 1024), (), {})()',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('invalid-output')
    expect(result.error?.kind).not.toBe('worker-exit')
  }, 90_000)

  it('appends a flushed unterminated line to the next entry without a fake newline', async () => {
    // An explicit flush of an unterminated line (print(..., end='', flush=True))
    // used to push a full log frame, so the following print() landed in a
    // SECOND entry and logs.join('\n') rendered 'a\nb' for what the program
    // printed as one line. The flush frame now carries `open: true` and the
    // host appends the next frame to the same entry.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        "print('a', end='', flush=True)",
        "print('b')",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['ab'])
  }, 15_000)

  it('keeps a SEALED open hold when the run ends with it still open', async () => {
    // The finish-residual's sealed side: an open hold past MAX_PENDING_CHUNKS
    // lands in openSealed, and the run ends without a closing frame — finish()
    // must commit the SEALED prefix, not only the current fragments.
    const { runtime } = await setup({ maxLogBytes: 65536 })
    const result = await runtime.run({
      program: [
        'import os',
        "os.write(3, b'{\"type\":\"log\",\"text\":\"x\",\"open\":true}\\n')",
        'for _ in range(3000):',
        "    os.write(3, b'{\"type\":\"log\",\"text\":\"a\",\"open\":true}\\n')",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['x' + 'a'.repeat(3000)])
  }, 15_000)

  it('keeps a flushed unterminated line when the run ends with it still open', async () => {
    // The settlement flush pushes the residual with `open: true`; finish()
    // admits it so a program that commits a partial line and returns does not
    // lose it from logs.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        "print('committed', end='', flush=True)",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['committed'])
  }, 15_000)

  it('skips the hold for a zero-content open continuation', async () => {
    // An empty open continuation bills 0 and is NOT pushed into the held
    // fragment array (an empty fragment contributes nothing to the merged
    // entry, and holding it would let a forged empty-open flood grow host
    // memory without touching the ledger).
    const { runtime } = await setup({ maxLogBytes: 64 })
    const result = await runtime.run({
      program: [
        'import os',
        "os.write(3, b'{\"type\":\"log\",\"text\":\"x\",\"open\":true}\\n')",
        "os.write(3, b'{\"type\":\"log\",\"text\":\"\",\"open\":true}\\n')",
        "os.write(3, b'{\"type\":\"log\",\"text\":\"y\"}\\n')",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['xy'])
  }, 15_000)

  it('seals the open hold past MAX_PENDING_CHUNKS without changing the merged entry', async () => {
    // A budget-sized single-character open flood would otherwise accumulate
    // thousands of fragment array slots (each a slot plus string header, ~30x
    // overhead the byte cap cannot see). The hold seals into one block past
    // MAX_PENDING_CHUNKS; the merged entry is byte-identical.
    const { runtime } = await setup({ maxLogBytes: 65536 })
    const result = await runtime.run({
      program: [
        'import os',
        "os.write(3, b'{\"type\":\"log\",\"text\":\"x\",\"open\":true}\\n')",
        // 3000 single-character open continuations (over MAX_PENDING_CHUNKS).
        'for _ in range(3000):',
        "    os.write(3, b'{\"type\":\"log\",\"text\":\"a\",\"open\":true}\\n')",
        "os.write(3, b'{\"type\":\"log\",\"text\":\"y\"}\\n')",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['x' + 'a'.repeat(3000) + 'y'])
  }, 15_000)

  it('bounds a forged open-frame flood against the log budget', async () => {
    // The open hold must be bounded by the ledger: without the exact-cost check
    // a forged open flood would grow the held fragment without touching
    // logBudget — unbounded host retention under a small budget. The flood now
    // truncates to the marker like any over-budget log traffic.
    const { runtime } = await setup({ maxLogBytes: 64 })
    const result = await runtime.run({
      program: [
        'import os',
        // 2000 forged open frames, each under the frame parse cap.
        'for _ in range(2000):',
        "    os.write(3, b'{\"type\":\"log\",\"text\":\"a\",\"open\":true}\\n')",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['a'.repeat(60), logTruncationMarker(64)])
  }, 15_000)

  it('commits a sealed open hold before the truncation marker', async () => {
    // The sealed variant of the prefix-commit case: an open flood past
    // MAX_PENDING_CHUNKS lands in openSealed, then an over-budget line
    // truncates — truncateLogs must commit the SEALED prefix (not only the
    // current fragments) before the marker.
    const { runtime } = await setup({ maxLogBytes: 65536 })
    const result = await runtime.run({
      program: [
        'import os',
        "os.write(3, b'{\"type\":\"log\",\"text\":\"x\",\"open\":true}\\n')",
        // 3000 single-character open continuations seal the hold, then a
        // forged over-budget open frame trips the ledger: truncateLogs must
        // commit the SEALED prefix before the marker.
        'for _ in range(3000):',
        "    os.write(3, b'{\"type\":\"log\",\"text\":\"a\",\"open\":true}\\n')",
        "os.write(3, ('{\"type\":\"log\",\"text\":\"' + 'z' * 70000 + '\",\"open\":true}\\n').encode())",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs[0]).toBe('x' + 'a'.repeat(3000))
    expect(result.logs[result.logs.length - 1]).toBe(logTruncationMarker(65536))
  }, 15_000)

  it('commits a flushed open prefix before the truncation marker', async () => {
    // A flushed unterminated line is billed and committed; when a later
    // over-budget write truncates, the committed prefix must appear BEFORE the
    // marker — the ledger charged for it, so it cannot vanish.
    const { runtime } = await setup({ maxLogBytes: 64 })
    const result = await runtime.run({
      program: [
        "print('committed', end='', flush=True)",
        "print('x' * 100)",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['committed', logTruncationMarker(64)])
  }, 15_000)

  it('drops a forged fd-3 frame with illegal UTF-8 instead of accepting a mangled value', async () => {
    // toString('utf8') would replace the illegal 0xFF with U+FFFD, so a forged
    // done frame could land a corrupted completion value; the fatal decode
    // throws and the frame is dropped. The program's real return still settles
    // the run with the honest value.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import os',
        "os.write(3, b'{\"type\":\"done\",\"value\":\"bad' + bytes([0xFF]) + b'\"}\\n')",
        'return "ok"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('ok')
  }, 15_000)

  it('no-ops a closing frame once an open flood already truncated the ledger', async () => {
    // The closing-frame branch's post-truncation arm: an open flood exhausts
    // the ledger (logsTruncated set, marker pushed), then a closing frame
    // arrives — it must be a no-op, not append content past the marker.
    const { runtime } = await setup({ maxLogBytes: 64 })
    const result = await runtime.run({
      program: [
        'import os',
        'for _ in range(2000):',
        "    os.write(3, b'{\"type\":\"log\",\"text\":\"a\",\"open\":true}\\n')",
        "os.write(3, b'{\"type\":\"log\",\"text\":\"b\"}\\n')",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['a'.repeat(60), logTruncationMarker(64)])
  }, 15_000)

  it('bills a merged open entry once, not per fragment', async () => {
    // A merged entry's wire cost is billed ONCE, split across its fragments
    // (first fragment pays quotes+separator, continuations pay only content).
    // Under maxLogBytes: 64, 16 single-character flushes merge to one 16-char
    // entry (2 quotes + 16 content + 1 separator = 19), which fits; per-
    // fragment billing (each charged quotes+separator, ~4 bytes) would truncate
    // at 16 x 4 = 64.
    const { runtime } = await setup({ maxLogBytes: 64 })
    const result = await runtime.run({
      program: [
        'for _ in range(16):',
        "    print('x', end='', flush=True)",
        "print('')",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['x'.repeat(16)])
  }, 15_000)

  it('admits a compliant merged entry whose closing frame fits the remaining budget', async () => {
    // The review's arithmetic check: print('a'*30, flush); print('b'*25) under
    // maxLogBytes: 64 has a merged wire cost of 2 quotes + 55 content + 1
    // separator = 58 <= 63, so it MUST be admitted as one entry. The earlier
    // cap math (logBudget - openCost) made the closing frame's walk see a
    // negative cap and truncate a compliant entry.
    const { runtime } = await setup({ maxLogBytes: 64 })
    const result = await runtime.run({
      program: [
        "print('a' * 30, end='', flush=True)",
        "print('b' * 25)",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['a'.repeat(30) + 'b'.repeat(25)])
  }, 15_000)

  it('rejects an open frame that would overflow the ledger by one byte', async () => {
    // The review's arithmetic check: an open frame whose full JSON cost is 63
    // (maxLogBytes: 64 -> ledger 63) must be rejected by the first-fragment
    // cap logBudget - 1 (62), not admitted with a bill of 64 that pushes the
    // ledger negative. The frame is FORGED on fd 3 so the child ledger cannot
    // truncate first: a reverted cap of logBudget (63) would admit the frame,
    // hold it, and flush it at settlement, so the marker assertion fails.
    const { runtime } = await setup({ maxLogBytes: 64 })
    const result = await runtime.run({
      program: [
        'import os',
        "os.write(3, ('{\"type\":\"log\",\"text\":\"' + 'x' * 61 + '\",\"open\":true}\\n').encode())",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual([logTruncationMarker(64)])
  }, 15_000)

  it('bills the closing frame as the merged tail under an exact-fit budget', async () => {
    // The child's split billing: a 30-char open + a 30-char closing frame cost
    // 2 + 60 + 1 = 63 = ledger 63 exactly; the closing frame must be billed as
    // the merged tail (content only), not as a fresh entry (which would
    // double-charge the quotes+separator and truncate an exact-fit entry).
    const { runtime } = await setup({ maxLogBytes: 64 })
    const result = await runtime.run({
      program: [
        "print('a' * 30, end='', flush=True)",
        "print('b' * 30)",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['a'.repeat(30) + 'b'.repeat(30)])
  }, 15_000)

  it('does not over-reject an exact-fit closing line while an open entry accumulates', async () => {
    // The write-path pre-check's cheap bound used +3 (quotes + separator) even
    // while an open entry was accumulating, so an exact-fit merged TAIL was
    // truncated. The recipe below goes through the SCAN pre-check (the
    // newline-terminated write arrives with an empty pending buffer, so the
    // buffered-chunks branch is skipped): 'a'*29 flush bills 32 (ledger 31
    // left), then one write of 'b'*30 + newline merges 30 more chars whose
    // cheap bound is 30, not 33 — the +3 form saw 30 + 3 = 33 > 31, sliced to
    // a budget prefix, and pushed past the ledger, emitting the marker for a
    // line that fits (merged cost 2 + 59 + 1 = 62 <= 63).
    const { runtime } = await setup({ maxLogBytes: 64 })
    const result = await runtime.run({
      program: [
        'import sys',
        "sys.stdout.write('a' * 29)",
        'sys.stdout.flush()',
        "sys.stdout.write('b' * 30 + chr(10))",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['a'.repeat(29) + 'b'.repeat(30)])
  }, 15_000)


  it('rejects a new open entry once the ledger has only two bytes left', async () => {
    // The jsonStringCostUpTo sub-2-byte guard: forged open frames drive the
    // host ledger down to 1 byte, then a new open entry's first-fragment cap
    // (logBudget - 1 = 0) trips the guard and truncates.
    const { runtime } = await setup({ maxLogBytes: 64 })
    const result = await runtime.run({
      program: [
        'import os',
        "os.write(3, ('{\"type\":\"log\",\"text\":\"' + 'a' * 28 + '\",\"open\":true}\\n').encode())",
        "os.write(3, ('{\"type\":\"log\",\"text\":\"' + 'a' * 31 + '\"}\\n').encode())",
        "os.write(3, b'{\"type\":\"log\",\"text\":\"x\",\"open\":true}\\n')",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['a'.repeat(59), logTruncationMarker(64)])
  }, 15_000)

  it('truncates when the closing frame of a merged entry overflows the budget', async () => {
    // The merged entry's billed-once cost: an open fragment that nearly
    // exhausts the budget, then a closing frame whose content no longer fits —
    // the closing frame's exact-cost walk trips and the marker replaces the
    // entry, exactly like any other over-budget log traffic.
    const { runtime } = await setup({ maxLogBytes: 64 })
    const result = await runtime.run({
      program: [
        "print('x' * 40, end='', flush=True)",
        "print('y' * 40)",
        'return "done"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['x'.repeat(40), logTruncationMarker(64)])
  }, 15_000)

  it('keeps a float completion exact when the program mutates the decimal context', async () => {
    // The float encoder's Decimal(repr(value)).normalize() used the process
    // GLOBAL decimal context: a legitimate program setting
    // `getcontext().prec = 2` silently rounded the completion value's digits,
    // and `traps[Inexact] = True` made the encode raise, misclassifying a
    // successful run as an exception. A fixed module-level Context(prec=28)
    // makes the spelling decision context-independent.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'from decimal import getcontext',
        'getcontext().prec = 2',
        'getcontext().traps[__import__("decimal").Inexact] = True',
        'return 1.2345678901234567',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(1.2345678901234567)
  }, 15_000)

  it('bounds an over-cap exception-group nesting on the copy', async () => {
    // Exception groups link through `exceptions`, not the cause/context
    // dunders, so the cap has to count that edge too — otherwise a deeply
    // nested group walks past the bound the marker claims to enforce.
    const { runtime } = await setup({ maxValueBytes: 1024 * 1024, maxWallMs: 15_000 })
    const result = await runtime.run({
      program: [
        'import sys',
        // ExceptionGroup is a 3.11+ builtin; on 3.10 the NameError is the
        // failure mode being probed, so skip to keep the assertion meaningful.
        'if sys.version_info < (3, 11):',
        '    raise ValueError("skip-old <model>")',
        'group = ValueError("leaf")',
        'for i in range(150):',
        '    group = ExceptionGroup(f"g{i}", [group])',
        'raise group',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error?.kind).toBe('exception')
    // The version guard skips on Python < 3.11 (ExceptionGroup is a 3.11+
    // builtin) with a distinct message; the truncation assertion applies on
    // 3.11+ where the group nesting is what is being probed.
    expect(result.error?.message).toMatch(/exception chain truncated at 100 links|skip-old/)
  }, 20_000)

  it('filters every bootstrap frame from the traceback of an uncaught binding rejection', async () => {
    // A rejection re-raised by the bootstrap's dispatch adds bootstrap frames
    // AFTER the model's own; only <model> frames may reach model-visible,
    // durable output — a bootstrap.py path would leak host absolutes and make
    // transcripts machine-dependent.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: 'await tools.boom({})',
      bindings: tools({ boom: async () => { throw new Error('exploded') } }),
    })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.message).toContain('exploded')
    expect(result.error?.message).toContain('<model>')
    expect(result.error?.message).not.toContain('bootstrap.py')
  })

  it('renders a non-Error thrown value from a host binding as its String form', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'caught = ""',
        'try:',
        '    await tools.failRaw({})',
        'except RuntimeError as e:',
        '    caught = str(e)',
        'return caught',
      ].join('\n'),
      bindings: tools({
        failRaw: async () => { throw 'raw-nope' },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toContain('raw-nope')
  })

  it('reassembles a frame split across writes behind a completed one', async () => {
    // One os.write carrying "<frame>\n<partial...>" leaves a non-empty
    // residual after the newline loop; the tail must survive until its own
    // newline arrives and then parse as a normal frame.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import os, json',
        'head = json.dumps({"type":"log","text":"first"}).encode()',
        'tail = json.dumps({"type":"log","text":"second"}).encode()',
        'import time',
        'os.write(3, head + b"\\n" + tail[:5])',
        'time.sleep(0.2)',
        'os.write(3, tail[5:] + b"\\n")',
        'return "ok"',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('ok')
    expect(result.logs).toContain('first')
    expect(result.logs).toContain('second')
  })

  it('raises the declared errorClass with the member name on rejection', async () => {
    // PTC mode declares { name: ToolCallError, memberNameProperty: toolName };
    // a host rejection must surface as that class, carrying the failed tool.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'caught = ""',
        'try:',
        '    await tools.fail({})',
        'except ToolCallError as e:',
        '    caught = f"{type(e).__name__}:{e.toolName}:{e}"',
        'return caught',
      ].join('\n'),
      bindings: [{
        global: 'tools',
        functions: { fail: async () => { throw new Error('typed-nope') } },
        errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' },
      }],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('ToolCallError:fail:typed-nope')
  })

  it('keeps the declared error class catching when Exception and setattr are rebound', async () => {
    // _make_error_class's minted __init__ def-time captures Exception and
    // setattr, so a program rebinding __main__.Exception/__main__.setattr
    // cannot break the rejection constructor: `except ToolCallError` must still
    // catch and read the member property.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import __main__',
        'def boom(*a, **k):',
        '    raise RuntimeError("hijacked")',
        '__main__.Exception = boom',
        '__main__.setattr = boom',
        'caught = ""',
        'try:',
        '    await tools.fail({})',
        'except ToolCallError as e:',
        '    caught = f"{type(e).__name__}:{e.toolName}"',
        'return caught',
      ].join('\n'),
      bindings: [{
        global: 'tools',
        functions: { fail: async () => { throw new Error('typed-nope') } },
        errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' },
      }],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('ToolCallError:fail')
  }, 15_000)

  it('runs when errorClass metadata is exposed through one-read getters', async () => {
    // Validation reads errorClass.name and errorClass.memberNameProperty, and
    // the ORIGINAL object used to ride along to the boot frame, whose
    // JSON.stringify re-read it after validation: a getter that throws or
    // changes on a second read turned the seam-misuse rejection into a
    // worker-exit (or injected a different name than validation approved).
    // The snapshot reads each field exactly once into a plain copy, so a
    // getter that only tolerates one read must boot and run cleanly.
    let nameReads = 0
    let memberReads = 0
    const errorClass = {
      get name(): string {
        nameReads += 1
        if (nameReads > 1) throw new Error(`errorClass.name read ${nameReads} times`)
        return 'ToolCallError'
      },
      get memberNameProperty(): string {
        memberReads += 1
        if (memberReads > 1) throw new Error(`errorClass.memberNameProperty read ${memberReads} times`)
        return 'toolName'
      },
    }
    const { runtime } = await setup()
    const result = await runtime.run({
      program: 'return "ok"',
      bindings: [{ global: 'tools', functions: {}, errorClass }],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('ok')
    expect(nameReads).toBe(1)
    expect(memberReads).toBe(1)
  }, 15_000)

  it('runs when the binding global is exposed through a one-read getter', async () => {
    // Validation reads namespace.global several times (identifier check, map
    // key, claim, boot frame), and the map key came from a fresh read each
    // time: a getter returning a different name on a later read injected a
    // global validation never approved, and the program referencing the
    // approved name died with NameError. Snapshotting reads it exactly once,
    // so the child must receive the name the program was written against.
    let globalReads = 0
    const namespace = {
      get global(): string {
        globalReads += 1
        return globalReads === 1 ? 'tools' : 'evil'
      },
      functions: { echo: async (args: unknown) => args as CodeJsonValue },
    }
    const { runtime } = await setup()
    const result = await runtime.run({
      program: 'return await tools.echo(41)',
      bindings: [namespace],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(41)
    expect(globalReads).toBe(1)
  }, 15_000)

  it('rejects an errorClass name colliding with its namespace global at the seam', async () => {
    const { runtime } = await setup()
    await expect(runtime.run({
      program: 'return 1',
      bindings: [{ global: 'tools', functions: {}, errorClass: { name: 'tools', memberNameProperty: 'toolName' } }],
    })).rejects.toThrow(/collides with another injected global/)
  })

  it('rejects a namespace global colliding with a runtime-owned name at the seam', async () => {
    // `__avn_main__` passes the identifier check, but exec()ing the generated
    // wrapper would silently overwrite the binding after injection. `console`
    // is the WORKER backend's slot — refused here too so a namespace list
    // valid on one backend is valid on all.
    const { runtime } = await setup()
    // `__debug__` is refused for a different reason than a collision: CPython
    // compiles a bare `__debug__` reference to the constant True and refuses to
    // assign the name at compile time, so an injected global under it is
    // unreachable from the program — accepted by the seam, unusable here.
    for (const global of ['__avn_main__', 'console', '__debug__']) {
      await expect(runtime.run({
        program: 'x = 1',
        bindings: [{ global, functions: {} }],
      })).rejects.toThrow(/collides with a runtime-owned global/)
    }
  })

  it('accepts a non-identifier memberNameProperty and rejects only an empty one', async () => {
    // The seam permits any non-empty own property except the reserved
    // members; Python setattr/getattr carry exotic names like `tool-name`,
    // and the worker backend accepts them, so this backend must too.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'try:',
        '    await tools.boom({})',
        'except ToolCallError as e:',
        '    return getattr(e, "tool-name")',
      ].join('\n'),
      bindings: [{
        global: 'tools',
        functions: { boom: async () => { throw new Error('nope') } },
        errorClass: { name: 'ToolCallError', memberNameProperty: 'tool-name' },
      }],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('boom')
    await expect(runtime.run({
      program: 'return 1',
      bindings: [{ global: 'tools', functions: {}, errorClass: { name: 'ToolCallError', memberNameProperty: '' } }],
    })).rejects.toThrow(/memberNameProperty must be a non-empty attribute name/)
  })

  it('resolves a basename pythonBin to an absolute path (runs a real program)', async () => {
    // A bare `python3` basename must resolve against PATH and actually launch
    // under the empty-env spawn — exercises the accessSync success branch.
    const { runtime } = await setup({ pythonBin: 'python3' })
    const result = await runtime.run({ program: 'return 7', bindings: [] })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(7)
  })

  it('rejects at load a basename pythonBin with no PATH match', async () => {
    // resolvePythonBin turns a basename into an absolute path before the
    // empty-env spawn; a basename with no PATH match must fail at load (like an
    // empty or NUL pythonBin) rather than silently falling to execvp's
    // platform default PATH and starting a system interpreter the caller never
    // asked for.
    const ctx = new Context()
    await expect(ctx.plugin(PythonCodeRuntime, { pythonBin: 'definitely-no-such-python-xyz' }))
      .rejects.toThrow(/does not resolve on PATH/)
  })

  it('rejects a memberNameProperty naming a constrained BaseException attribute', async () => {
    // `__dict__`/`__class__` are constrained descriptors alongside
    // `__traceback__` — setattr of a string raises TypeError while
    // constructing the rejection — so every dunder is refused at the seam.
    const { runtime } = await setup()
    // name/message/stack are the seam's own exclusions (CodeBindingErrorClass
    // forbids replacing them; the worker backend rejects them identically).
    for (const member of ['__traceback__', '__dict__', '__class__', 'args', 'name', 'message', 'stack']) {
      await expect(runtime.run({
        program: 'return 1',
        bindings: [{ global: 'tools', functions: {}, errorClass: { name: 'ToolCallError', memberNameProperty: member } }],
      })).rejects.toThrow(/reserved error member/)
    }
  })

  it('rejects a lossy binding resolution (NaN) instead of coercing it to null', async () => {
    // JSON.stringify would turn NaN into null and drop undefined fields; the
    // seam requires a descriptive rejection so data cannot silently corrupt.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'caught = ""',
        'try:',
        '    await tools.bad({})',
        'except RuntimeError as e:',
        '    caught = str(e)',
        'return caught',
      ].join('\n'),
      bindings: tools({ bad: async () => Number.NaN }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toContain('lossless JSON')
  })

  it('contains a forged pathological done value without crashing the host', async () => {
    // A ~20k-deep nested array forged onto fd 3 would overflow a recursive
    // JSON.stringify; the host's iterative encoder measures it stack-safely
    // and fails it deterministically on the byte budget (40 kB > 32 KiB).
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'import os, json',
        'depth = 20000',
        'payload = "[" * depth + "]" * depth',
        'os.write(3, b\'{"type":"done","value":\' + payload.encode() + b\'}\\n\')',
        'import time',
        'time.sleep(5)',
      ].join('\n'),
      bindings: [],
    })
    expect(result.value).toBeUndefined()
    expect(result.error?.kind).toBe('output-limit')
  })

  it('preserves a deeply nested completion value below the byte budget', async () => {
    // CodeJsonValue has no depth limit: a 10000-deep nested list is only
    // ~20 kB — under maxValueBytes — and must cross intact. That depth
    // overflows BOTH recursive serializers the pipeline used to rely on
    // (CPython's json.dumps recursion limit ~1000s, V8's JSON.stringify), so
    // it proves the child-side _encode_json_plain and the host-side
    // encodeJsonPlain together. The host JSON.parse of the frame is iterative
    // in V8 for arrays, so only the two encoders were at risk.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'v = None',
        'for _ in range(10000):',
        '    v = [v]',
        'return v',
      ].join('\n'),
      bindings: [],
    })
    expect(result.error).toBeUndefined()
    // Walk down iteratively (a recursive toEqual would itself overflow).
    let depth = 0
    let cursor: unknown = result.value
    while (Array.isArray(cursor)) {
      expect(cursor).toHaveLength(1)
      cursor = cursor[0]
      depth++
    }
    expect(depth).toBe(10000)
    expect(cursor).toBeNull()
  })

  it('bridges a deeply nested binding resolution back into the program stack-safely', async () => {
    // A binding resolution has no seam-level depth or byte cap; neither the
    // host's reply serialization nor the CHILD's reply decode may die on
    // recursion (json.loads raises RecursionError ~10k levels deep; the
    // bootstrap decodes frames iteratively). 12000 levels sits past that
    // limit while staying tiny in bytes.
    const { runtime } = await setup()
    const deep = ((): unknown => {
      let v: unknown = null
      for (let i = 0; i < 12000; i++) v = [v]
      return v
    })()
    const result = await runtime.run({
      program: [
        'v = await tools.deep({})',
        'depth = 0',
        'while isinstance(v, list):',
        '    v = v[0]',
        '    depth += 1',
        'return depth',
      ].join('\n'),
      bindings: tools({ deep: async () => deep as never }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(12000)
  })

  it('rejects a reserved errorClass name at the seam', async () => {
    const { runtime } = await setup()
    await expect(runtime.run({
      program: 'return 1',
      bindings: [{
        global: 'tools',
        functions: {},
        errorClass: { name: 'class', memberNameProperty: 'toolName' },
      }],
    })).rejects.toThrow(/errorClass.name "class" is not a usable Python identifier/)
  })

  it('routes a declared inherited-attribute name through the bridge via subscript', async () => {
    // __class__ resolves on `object` before any fallback hook; the proxy's
    // __getattribute__ intercepts declared names first, and subscript access
    // is the SDK-advertised route for underscore names.
    const { runtime } = await setup()
    const seen: string[] = []
    const result = await runtime.run({
      program: [
        'a = await tools["__class__"]({"via": "subscript"})',
        'b = await tools.__class__({"via": "dot"})',
        'return [a, b]',
      ].join('\n'),
      bindings: tools({
        '__class__': async () => { seen.push('called'); return 'bridged' },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual(['bridged', 'bridged'])
    expect(seen).toEqual(['called', 'called'])
  })

  it('rejects NaN binding arguments immediately instead of hanging', async () => {
    // Default json.dumps would emit a non-standard NaN token that the host
    // JSON.parse drops silently, hanging the call until the wall clock;
    // allow_nan=False raises in-program right away.
    const { runtime } = await setup({ maxWallMs: 8000 })
    const start = Date.now()
    const result = await runtime.run({
      program: [
        'caught = ""',
        'try:',
        '    await tools.echo({"x": float("nan")})',
        'except RuntimeError as e:',
        '    caught = str(e)',
        'return caught',
      ].join('\n'),
      bindings: tools({ echo: async args => args as CodeJsonValue }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toContain('lossless JSON')
    expect(Date.now() - start).toBeLessThan(5000)
  })

  it('carries large binding arguments well past maxValueBytes', async () => {
    // Binding traffic has no seam byte cap: a call frame far larger than the
    // completion budget must reach the host intact (the fd-3 ceiling is a
    // fixed memory-safety bound, not an output budget).
    const maxValueBytes = 4096
    const { runtime } = await setup({ maxValueBytes })
    let receivedLength = 0
    const result = await runtime.run({
      program: [
        `big = "B" * ${maxValueBytes * 50}`,
        'r = await tools.measure({"payload": big})',
        'return r',
      ].join('\n'),
      bindings: tools({
        measure: async (args) => {
          receivedLength = ((args as { payload: string }).payload).length
          return receivedLength
        },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(receivedLength).toBe(maxValueBytes * 50)
    expect(result.value).toBe(maxValueBytes * 50)
  })

  it('rejects an unknown binding name inside the program with a matching error', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'caught = ""',
        'try:',
        '    await tools.nope({})',
        'except (AttributeError, RuntimeError) as e:',
        '    caught = str(e)',
        'return caught',
      ].join('\n'),
      bindings: tools({ known: async () => 'ok' }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toContain('nope')
  })

  it('bounds an unknown-binding diagnostic built from a forged call frame', async () => {
    // `call.global` and `call.name` carry no byte cap of their own, only the
    // 64 MiB fd-3 frame parse cap, and the reply interpolated them raw: one copy
    // into the template result, one into the `JSON.stringify` escape, one into
    // the `encodeJsonPlain` frame, one into the pipe write. Slicing each field
    // to `maxValueBytes` code units first makes an 8 MiB forged name a
    // 128-byte reply. The observable effect is the reply the child then has to
    // READ: its fd-3 reader is unbuffered, so `readline` consumes an oversized
    // reply one `read(2)` per byte and the run's own legitimate call never gets
    // answered — measured under a 60 s ceiling, the 8 MiB case timed out and a
    // 64 MiB case cost the host 509.9 MiB of heap against 120.3 MiB with the
    // slices in place. The child's address space stays generous enough to BUILD
    // the forgery, which is not what is under test.
    const { runtime } = await setup({ maxValueBytes: 128, addressSpaceMb: 1024, maxWallMs: 20_000 })
    const result = await runtime.run({
      program: [
        'import os',
        'frame = b\'{"type":"call","id":9001,"global":"tools","name":"\' + b"n" * (8 * 1024 * 1024) + b\'","args":{}}\\n\'',
        // One os.write returns short past the pipe buffer, and a partial frame
        // would glue itself to the next one and be dropped as malformed, so the
        // forgery goes out through a drain loop.
        'view = memoryview(frame)',
        'while view:',
        '    view = view[os.write(3, view):]',
        // A legitimate call after the forgery: its reply can only arrive once
        // the child has read past whatever the forged frame was answered with.
        'await tools.known({})',
        'return "settled"',
      ].join('\n'),
      bindings: tools({ known: async () => 'ok' }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('settled')
  }, 40_000)

  it('bridges a binding call reached via subscript access (tools["name"])', async () => {
    // The SDK tells the model `await tools["my-tool"](args)` works for exotic
    // names; the proxy's __getitem__ must route it through the bridge.
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'r = await tools["my-tool"]({"n": 7})',
        'return r',
      ].join('\n'),
      bindings: tools({ 'my-tool': async args => ({ got: args as CodeJsonValue }) }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({ got: { n: 7 } })
  })

  it('raises KeyError for an undeclared subscript name', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({
      program: [
        'caught = ""',
        'try:',
        '    await tools["absent"]({})',
        'except KeyError as e:',
        '    caught = str(e)',
        'return caught',
      ].join('\n'),
      bindings: tools({ known: async () => 'ok' }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toContain('absent')
  })
})
