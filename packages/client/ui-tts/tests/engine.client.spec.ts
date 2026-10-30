/**
 * The reading engine driven through a fake Web Audio graph: fragments synthesize ahead of playback,
 * every step or switch cancels what it interrupts, and a request that arrives mid-synthesis takes the
 * pipeline over instead of leaving it stalled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadAloud } from '../src/client/engine.ts'

/** Base64 of the bytes the Host would return for one fragment. */
const AUDIO = Buffer.from('audio').toString('base64')

/** One scheduled playback node, remembered so a case can assert where and whether it played. */
class FakeSource {
  buffer: unknown = null
  connected: unknown = null
  started: number | undefined
  stopped = false
  onended: (() => void) | null = null
  /** Whether `stop()` reports a node that already ended. */
  stopThrows = false
  connect(destination: unknown): void { this.connected = destination }
  start(when: number): void { this.started = when }
  stop(): void {
    if (this.stopThrows) throw new Error('already ended')
    this.stopped = true
  }
  /** Report the node's own end, as the audio graph would. */
  end(): void { this.onended?.() }
}

/** The audio graph the engine builds: one destination, one clock, and every source it started. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  /** Seconds of audio every decoded buffer reports. */
  static duration = 1
  readonly destination = { name: 'destination' }
  readonly sources: FakeSource[] = []
  currentTime = 0
  resumes = 0
  closed = false
  constructor() { FakeAudioContext.instances.push(this) }
  async resume(): Promise<void> { this.resumes += 1 }
  createBufferSource(): FakeSource {
    const source = new FakeSource()
    this.sources.push(source)
    return source
  }
  async decodeAudioData(): Promise<{ duration: number }> { return { duration: FakeAudioContext.duration } }
  async close(): Promise<void> { this.closed = true }
}

/** One fragment sent to the Host, with the switch a case uses to settle it. */
interface Synthesis {
  readonly text: string
  readonly language: string
  readonly voiceId: string | undefined
  readonly signal: AbortSignal
  resolve: (audio?: string) => void
  reject: (error?: unknown) => void
}

/**
 * An engine over a fake graph, with synthesis kept under the case's control.
 * @param options - `instant: false` leaves every synthesis pending until the case settles it.
 * @returns the engine, the syntheses it made, and the graph it built.
 */
function makeEngine(options: { instant?: boolean } = {}) {
  const syntheses: Synthesis[] = []
  const fallbackLanguage = vi.fn(() => 'en')
  const published: number[] = []
  const engine = new ReadAloud({
    speak: (text, language, voiceId, signal) => {
      let settle!: (audio: string) => void
      let fail!: (error: unknown) => void
      const work = new Promise<string>((resolve, reject) => { settle = resolve; fail = reject })
      syntheses.push({
        text,
        language,
        voiceId,
        signal,
        resolve: (audio = AUDIO) => { settle(audio) },
        reject: (error = new Error('synthesis failed')) => { fail(error) },
      })
      if (options.instant !== false) settle(AUDIO)
      return work
    },
    fallbackLanguage,
    publish: () => { published.push(syntheses.length) },
  })
  return {
    engine,
    syntheses,
    fallbackLanguage,
    publishCount: () => published.length,
    context: () => {
      const context = FakeAudioContext.instances.at(-1)
      if (context === undefined) throw new Error('no audio context was opened')
      return context
    },
  }
}

/** @returns whether an audio graph was built. */
function hasContext(): boolean {
  return FakeAudioContext.instances.length > 0
}

/**
 * Let every pending microtask of the engine's promise chain run, and any real timer with them.
 * @returns nothing once the chain is idle.
 */
async function flush(): Promise<void> {
  for (let hop = 0; hop < 4; hop += 1) {
    await new Promise<void>((resolve) => { setImmediate(resolve) })
  }
}

beforeEach(() => {
  FakeAudioContext.instances = []
  FakeAudioContext.duration = 1
  vi.stubGlobal('AudioContext', FakeAudioContext)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('switching reading on', () => {
  it('speaks what is already on screen from the click itself, resuming audio in the gesture', async () => {
    const h = makeEngine()
    h.engine.setEnabled('s1', true, '1.1', 'Hello there.')

    expect(h.engine.view.enabled).toEqual(['s1'])
    await flush()

    expect(h.syntheses.map(synthesis => synthesis.text)).toEqual(['Hello there.'])
    expect(h.syntheses[0]?.language).toBe('en')
    expect(h.syntheses[0]?.voiceId).toBeUndefined()
    expect(h.syntheses[0]?.signal.aborted).toBe(false)
    expect(h.context().resumes).toBe(1)
    expect(h.engine.view).toEqual({ enabled: ['s1'], loading: [], speaking: ['s1'], failed: [] })
  })

  it('does not speak a second time when the switch is already on', async () => {
    const h = makeEngine()
    h.engine.setEnabled('s1', true, '1.1', 'Hello there.')
    await flush()
    h.engine.setEnabled('s1', true, '1.1', 'Hello there.')
    await flush()

    expect(h.syntheses).toHaveLength(1)
    expect(h.context().resumes).toBe(1)
  })

  it('speaks nothing while reading has never been switched on for the session', async () => {
    const h = makeEngine()
    h.engine.sync('s1', '1.1', 'Hello there.')
    h.engine.finish('s1')
    await flush()

    expect(h.syntheses).toEqual([])
    expect(h.engine.view).toEqual({ enabled: [], loading: [], speaking: [], failed: [] })
    expect(hasContext()).toBe(false)
  })
})

describe('streaming text', () => {
  it('keeps fragments coming as the text grows, four syntheses ahead of playback', async () => {
    const h = makeEngine({ instant: false })
    h.engine.setEnabled('s1', true, '1.1', 'One. Two. Three. Four. Five. Six.')
    await flush()
    expect(h.syntheses.map(synthesis => synthesis.text)).toEqual(['One.', 'Two.', 'Three.', 'Four.'])

    h.syntheses[0]?.resolve()
    await flush()
    expect(h.syntheses).toHaveLength(5)
    expect(h.context().sources).toHaveLength(1)
  })

  it('continues the reply when a new step starts, flushing the unterminated tail first', async () => {
    const h = makeEngine()
    h.engine.setEnabled('s1', true, '1.1', 'An unterminated first step')
    await flush()
    h.engine.sync('s1', '2.1', 'Second step.')
    await flush()

    expect(h.syntheses.map(synthesis => synthesis.text)).toEqual([
      'An unterminated first step',
      'Second step.',
    ])
  })

  it('carries a finished sentence into the next step without speaking an empty fragment', async () => {
    const h = makeEngine()
    h.engine.setEnabled('s1', true, '1.1', 'First sentence.')
    await flush()
    h.engine.sync('s1', '2.1', 'Second sentence.')
    await flush()

    expect(h.syntheses.map(synthesis => synthesis.text)).toEqual(['First sentence.', 'Second sentence.'])
  })

  it('stops synthesizing text that has not changed', async () => {
    const h = makeEngine()
    h.engine.setEnabled('s1', true, '1.1', 'First sentence.')
    await flush()
    h.engine.sync('s1', '1.1', 'First sentence.')
    await flush()

    expect(h.syntheses).toHaveLength(1)
  })

  it('reads an edited reply again from its start', async () => {
    const h = makeEngine()
    h.engine.setEnabled('s1', true, '1.1', 'A long enough first sentence. And a second one.')
    await flush()
    const played = h.context().sources[0]
    h.engine.sync('s1', '1.1', 'Short.')
    await flush()

    expect(played?.stopped).toBe(true)
    expect(h.syntheses.at(-1)?.text).toBe('Short.')
    expect(h.context().sources.at(-1)?.started).toBeCloseTo(0.02)
  })

  it('speaks the unterminated remainder once the step stops streaming', async () => {
    const h = makeEngine()
    h.engine.setEnabled('s1', true, '1.1', 'An unterminated remainder')
    await flush()
    expect(h.syntheses).toEqual([])

    h.engine.finish('s1')
    await flush()
    expect(h.syntheses.map(synthesis => synthesis.text)).toEqual(['An unterminated remainder'])

    h.engine.finish('nobody')
    await flush()
    expect(h.syntheses).toHaveLength(1)
  })

  it('keeps the language of the reply for later fragments', async () => {
    const h = makeEngine()
    h.engine.setEnabled('s1', true, '1.1', 'Hello there friend.')
    await flush()
    expect(h.fallbackLanguage).toHaveBeenCalledTimes(1)

    h.engine.sync('s1', '1.1', 'Hello there friend. And a second sentence.')
    await flush()
    expect(h.fallbackLanguage).toHaveBeenCalledTimes(1)
    expect(h.syntheses.at(-1)?.language).toBe('en')
  })
})

describe('playback', () => {
  it('starts every fragment where the one before it ends', async () => {
    FakeAudioContext.duration = 5
    const h = makeEngine()
    h.engine.setEnabled('s1', true, '1.1', 'One. Two.')
    await flush()

    const [first, second] = h.context().sources
    expect(first?.connected).toBe(h.context().destination)
    expect(first?.started).toBeCloseTo(0.02)
    expect(second?.started).toBeCloseTo(5.02)
    expect(h.context().sources).toHaveLength(2)
  })

  it('reports speaking until the last fragment ends', async () => {
    FakeAudioContext.duration = 5
    const h = makeEngine()
    h.engine.setEnabled('s1', true, '1.1', 'One. Two.')
    await flush()

    const [first, second] = h.context().sources
    first?.end()
    expect(h.engine.view.speaking).toEqual(['s1'])
    second?.end()
    expect(h.engine.view.speaking).toEqual([])
  })

  it('holds the pipeline back while enough audio is already scheduled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    FakeAudioContext.duration = 20
    const h = makeEngine()
    h.engine.setEnabled('s1', true, '1.1', 'One. Two.')
    await flush()
    expect(h.syntheses.length).toBeGreaterThanOrEqual(2)
    expect(h.context().sources).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(8019)
    expect(h.context().sources).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(h.context().sources).toHaveLength(2)
  })
})

describe('failures', () => {
  it('retries a fragment the Host could not synthesize', async () => {
    const h = makeEngine({ instant: false })
    h.engine.setEnabled('s1', true, '1.1', 'One.')
    await flush()
    h.syntheses[0]?.reject()
    await flush()

    expect(h.syntheses.map(synthesis => synthesis.text)).toEqual(['One.', 'One.'])
    h.syntheses[1]?.resolve()
    await flush()
    expect(h.context().sources).toHaveLength(1)
    expect(h.engine.view.failed).toEqual([])
  })

  it('skips a fragment that fails twice and keeps reading the rest of the reply', async () => {
    const h = makeEngine({ instant: false })
    h.engine.setEnabled('s1', true, '1.1', 'One.')
    await flush()
    h.syntheses[0]?.reject()
    await flush()
    h.syntheses[1]?.reject()
    await flush()
    expect(h.syntheses.map(synthesis => synthesis.text)).toEqual(['One.', 'One.'])
    expect(h.engine.view.failed).toEqual(['s1'])

    h.engine.sync('s1', '1.1', 'One. Two.')
    await flush()
    const next = h.syntheses[2]
    expect(next?.text).toBe('Two.')
    next?.resolve()
    await flush()
    expect(h.context().sources).toHaveLength(1)
    expect(h.engine.view.speaking).toEqual(['s1'])
  })

  it('forgets a retry that fails after reading was switched off', async () => {
    const h = makeEngine({ instant: false })
    h.engine.setEnabled('s1', true, '1.1', 'One.')
    await flush()
    h.syntheses[0]?.reject()
    await flush()
    expect(h.syntheses).toHaveLength(2)

    h.engine.setEnabled('s1', false, '1.1', 'One.')
    h.syntheses[1]?.reject()
    await flush()

    expect(h.engine.view.failed).toEqual([])
    expect(h.engine.view.speaking).toEqual([])
  })

  it('reports no failure once the reply has already been audible', async () => {
    const h = makeEngine({ instant: false })
    h.engine.setEnabled('s1', true, '1.1', 'One. Two.')
    await flush()
    h.syntheses[0]?.resolve()
    await flush()
    h.syntheses[1]?.reject()
    await flush()
    h.syntheses[2]?.reject()
    await flush()

    expect(h.context().sources).toHaveLength(1)
    expect(h.engine.view.failed).toEqual([])
  })
})

describe('stop and restart', () => {
  it('silences playback and stops feeding when reading is switched off', async () => {
    const h = makeEngine()
    h.engine.setEnabled('s1', true, '1.1', 'First sentence.')
    await flush()
    const played = h.context().sources[0]

    h.engine.setEnabled('s1', false, '1.1', 'First sentence.')
    expect(played?.stopped).toBe(true)
    expect(h.engine.view).toEqual({ enabled: [], loading: [], speaking: [], failed: [] })

    h.engine.sync('s1', '1.1', 'Second sentence.')
    await flush()
    expect(h.syntheses).toHaveLength(1)
  })

  it('survives a scheduled fragment that already ended when reading stops', async () => {
    const h = makeEngine()
    h.engine.setEnabled('s1', true, '1.1', 'First sentence.')
    await flush()
    h.context().sources[0]!.stopThrows = true

    expect(() => { h.engine.setEnabled('s1', false, '1.1', 'First sentence.') }).not.toThrow()
    expect(h.engine.view.speaking).toEqual([])
  })
})

describe('reading one message on its own channel', () => {
  it('speaks the whole text once and keeps the session channel beside it', async () => {
    const h = makeEngine()
    h.engine.setEnabled('s1', true, '1.1', 'Session reply.')
    h.engine.speakOnce('message:m1', 'A whole message, spoken on demand.')
    await flush()

    expect(h.engine.view.enabled).toEqual(['s1', 'message:m1'])
    expect(h.syntheses.map(synthesis => synthesis.text)).toEqual([
      'Session reply.',
      'A whole message, spoken on demand.',
    ])
  })

  it('starts a repeated request again instead of ignoring it', async () => {
    const h = makeEngine()
    h.engine.speakOnce('message:m1', 'Read this.')
    await flush()
    h.engine.speakOnce('message:m1', 'Read this.')
    await flush()

    expect(h.syntheses.map(synthesis => synthesis.text)).toEqual(['Read this.', 'Read this.'])
    expect(h.context().sources.filter(source => !source.stopped)).toHaveLength(1)
  })

  it('takes the pipeline over when a request interrupts a synthesis in flight', async () => {
    const h = makeEngine({ instant: false })
    h.engine.speakOnce('message:m1', 'First sentence.')
    await flush()
    expect(h.syntheses.map(synthesis => synthesis.text)).toEqual(['First sentence.'])

    h.engine.speakOnce('message:m1', 'Second sentence.')
    await flush()
    expect(h.syntheses).toHaveLength(1)

    h.syntheses[0]?.resolve()
    await flush()
    expect(h.syntheses.map(synthesis => synthesis.text)).toEqual(['First sentence.', 'Second sentence.'])
    expect(h.context().sources).toHaveLength(0)

    h.syntheses[1]?.resolve()
    await flush()
    expect(h.context().sources).toHaveLength(1)
    expect(h.context().sources[0]?.started).toBeCloseTo(0.02)
    expect(h.engine.view.speaking).toEqual(['message:m1'])
  })

  it('takes the pipeline over when the interrupted synthesis fails instead', async () => {
    const h = makeEngine({ instant: false })
    h.engine.speakOnce('message:m1', 'First sentence.')
    await flush()

    h.engine.speakOnce('message:m1', 'Second sentence.')
    await flush()
    h.syntheses[0]?.reject()
    await flush()

    expect(h.syntheses.map(synthesis => synthesis.text)).toEqual(['First sentence.', 'Second sentence.'])
    expect(h.engine.view.failed).toEqual([])

    h.syntheses[1]?.resolve()
    await flush()
    expect(h.context().sources).toHaveLength(1)
  })

  it('forgets a one-shot channel when its message stops', async () => {
    const h = makeEngine()
    h.engine.speakOnce('message:m1', 'Read this.')
    await flush()
    h.engine.stopChannel('message:m1')

    expect(h.context().sources[0]?.stopped).toBe(true)
    expect(h.engine.view).toEqual({ enabled: [], loading: [], speaking: [], failed: [] })

    h.engine.stopChannel('nobody')
    expect(h.engine.view.enabled).toEqual([])
  })
})

describe('disposal', () => {
  it('silences every session and closes the audio graph', async () => {
    const h = makeEngine()
    h.engine.setEnabled('s1', true, '1.1', 'First sentence.')
    h.engine.speakOnce('message:m1', 'Second sentence.')
    await flush()

    h.engine.dispose()
    expect(FakeAudioContext.instances[0]?.closed).toBe(true)
    expect(h.context().sources.every(source => source.stopped)).toBe(true)
    expect(h.engine.view.speaking).toEqual([])

    h.engine.sync('s1', '1.1', 'Third sentence.')
    await flush()
    expect(h.syntheses).toHaveLength(2)
  })

  it('disposes an engine that never played anything', () => {
    const h = makeEngine()
    expect(() => { h.engine.dispose() }).not.toThrow()
    expect(hasContext()).toBe(false)
  })
})

describe('publication', () => {
  it('publishes only when a reported fact moves', async () => {
    const h = makeEngine()
    expect(h.engine.view).toEqual({ enabled: [], loading: [], speaking: [], failed: [] })

    h.engine.setEnabled('s1', true, '1.1', '')
    await flush()
    const settled = h.publishCount()
    expect(settled).toBeGreaterThan(0)

    h.engine.setEnabled('s1', true, '1.1', '')
    h.engine.sync('s1', '1.1', '')
    h.engine.sync('s1', '1.2', '')
    await flush()
    expect(h.publishCount()).toBe(settled)
  })

  it('keeps one audio graph and resumes it once per prewarm', () => {
    const h = makeEngine()
    h.engine.prewarm()
    h.engine.prewarm()

    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(h.context().resumes).toBe(2)
  })
})
