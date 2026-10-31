/** Clause-at-a-time read-aloud: several fragments synthesize ahead of playback, and every step cancels. */
import { detectLanguage } from './language.ts'
import { minSegmentLength, takeSegments } from './sentences.ts'
import { preferredVoice } from './voices.ts'

/** Observable read-aloud facts, all scoped to one Session id. */
export interface ReadAloudSnapshot {
  readonly enabled: readonly string[]
  /** Synthesis in flight: a fragment was sent and its audio has not arrived yet. */
  readonly loading: readonly string[]
  readonly speaking: readonly string[]
  readonly failed: readonly string[]
}

/** Owning plugin capabilities the engine needs. */
export interface ReadAloudDeps {
  /**
   * Synthesize one fragment through the Host.
   * @param text - fragment to speak.
   * @param language - primary language subtag the fragment is read in.
   * @param voiceId - the reader's choice for that language, when one is stored.
   * @returns the encoded audio as base64.
   */
  readonly speak: (text: string, language: string, voiceId: string | undefined, signal: AbortSignal) => Promise<string>
  /** Primary subtag used when a sentence carries no language signal of its own. */
  readonly fallbackLanguage: () => string
  /** Called after every change to the published snapshot. */
  readonly publish: () => void
}

/** One Session's reading state. */
interface Channel {
  readonly id: string
  enabled: boolean
  failed: boolean
  speaking: boolean
  /** Live step identity; a new value means a new assistant step or turn. */
  key: string
  /** Language the reply is being read in, which decides the voice of a fragment carrying no signal. */
  language: string | undefined
  /** Characters of the live flattened text already handed to the splitter. */
  consumed: number
  /** Flattened text not yet cut into fragments. */
  buffer: string
  /** Fragments waiting for a synthesis slot. */
  readonly queue: string[]
  /** Syntheses in flight, in the order their audio plays, each with the fragment they speak. */
  readonly pending: PendingFragment[]
  /** Aborts every synthesis this channel started. */
  readonly controllers: Set<AbortController>
  pumping: boolean
  /** Bumped by every stop, so an abandoned synthesis cannot report itself as a failure. */
  generation: number
  /** Earliest start time of the next scheduled fragment, which keeps playback gapless. */
  nextStart: number
  readonly sources: Set<AudioBufferSourceNode>
}

/** One fragment's synthesis, kept beside its text so a retry can repeat it. */
interface PendingFragment {
  readonly text: string
  readonly work: Promise<AudioBuffer>
}

/** Fragments kept synthesizing ahead of playback; four covers a Host round trip per fragment. */
const PREFETCH = 4

/** Seconds of already-scheduled audio allowed ahead of the playback position. */
const AHEAD_SECONDS = 12

/**
 * Speak assistant replies fragment by fragment, per Session, from a single audio context.
 * Nothing here reads React state: the owning plugin feeds live text and publishes the snapshot.
 */
export class ReadAloud {
  private readonly channels = new Map<string, Channel>()
  private snapshot: ReadAloudSnapshot = { enabled: [], loading: [], speaking: [], failed: [] }
  private context: AudioContext | undefined

  constructor(private readonly deps: ReadAloudDeps) {}

  /**
   * The reader's current channels and fragments.
   * @returns the current snapshot, with its reference unchanged while nothing moves.
   */
  get view(): ReadAloudSnapshot { return this.snapshot }

  /**
   * Open and resume the audio context while a click still counts as a user gesture.
   * Playing later, outside a gesture, would otherwise wait for the browser to unsuspend it.
   */
  prewarm(): void {
    void this.audio().resume()
  }

  /**
   * Turn reading on or off for one Session.
   * Enabling starts after the text already on screen, so turning it on mid-reply reads only what follows.
   * @param sessionId - Session whose replies are read.
   * @param enabled - whether replies are read aloud.
   * @param key - live step identity the shown text belongs to.
   * @param shown - flattened text already on screen.
   */
  setEnabled(sessionId: string, enabled: boolean, key: string, shown: string): void {
    const channel = this.channel(sessionId)
    if (channel.enabled === enabled) return
    channel.enabled = enabled
    channel.failed = false
    if (!enabled) {
      this.stop(channel)
      return
    }
    this.prewarm()
    channel.key = key
    channel.consumed = 0
    channel.buffer = ''
    this.speak(sessionId, key, shown)
    this.publish()
  }

  /**
   * Feed the growing flattened text of the current step.
   * @param sessionId - Session being read.
   * @param key - live step identity; a change restarts from the new step.
   * @param text - complete flattened text shown for that step.
   */
  sync(sessionId: string, key: string, text: string): void {
    this.speak(sessionId, key, text)
  }

  /**
   * Feed the text shown for one step, cutting and queuing whatever is new.
   * A new step continues the reply already being spoken: its queued fragments keep playing and the new
   * step's text follows them, so changing from reasoning to the answer never cuts a sentence short.
   * @param sessionId - Session being read.
   * @param key - live step identity.
   * @param text - complete flattened text shown for that step.
   */
  private speak(sessionId: string, key: string, text: string): void {
    const channel = this.channels.get(sessionId)
    if (channel === undefined || !channel.enabled) return
    if (channel.key !== key) {
      this.flush(channel)
      channel.key = key
      channel.consumed = 0
      channel.buffer = ''
    }
    if (text.length < channel.consumed) {
      this.stop(channel)
      channel.consumed = 0
      channel.buffer = ''
    }
    if (text.length <= channel.consumed) return
    channel.buffer += text.slice(channel.consumed)
    channel.consumed = text.length
    const language = detectLanguage(channel.buffer, channel.language ?? this.deps.fallbackLanguage())
    channel.language = language
    const cut = takeSegments(channel.buffer, minSegmentLength(language))
    channel.buffer = cut.rest
    channel.queue.push(...cut.segments)
    this.pump(channel)
  }

  /**
   * Queue the text not yet cut into a fragment, so the tail of a step is still spoken.
   * @param channel - Session whose unterminated text is flushed.
   */
  private flush(channel: Channel): void {
    const rest = channel.buffer.trim()
    channel.buffer = ''
    if (rest === '') return
    channel.queue.push(rest)
    this.pump(channel)
  }

  /**
   * Speak the unterminated remainder, called when the step stops streaming.
   * @param sessionId - Session being read.
   */
  finish(sessionId: string): void {
    const channel = this.channels.get(sessionId)
    if (channel === undefined || !channel.enabled) return
    this.flush(channel)
  }

  /**
   * Read one piece of text on its own channel: everything already queued or playing is dropped and the
   * whole text is spoken once, so a repeated request starts again instead of being ignored.
   * @param id - channel identity, distinct from a Session id.
   * @param text - the complete text to read.
   */
  speakOnce(id: string, text: string): void {
    const channel = this.channel(id)
    this.stop(channel)
    channel.enabled = true
    channel.failed = false
    channel.language = undefined
    channel.key = 'once'
    channel.consumed = 0
    this.prewarm()
    this.speak(id, 'once', text)
    this.flush(channel)
    this.publish()
  }

  /**
   * Silence one channel and forget that it was enabled, which a one-shot read leaves behind.
   * @param id - channel identity.
   */
  stopChannel(id: string): void {
    const channel = this.channels.get(id)
    if (channel === undefined) return
    channel.enabled = false
    channel.failed = false
    this.stop(channel)
  }

  /** Stop every Session and close the audio context. */
  dispose(): void {
    for (const channel of this.channels.values()) this.stop(channel)
    this.channels.clear()
    void this.context?.close()
    this.context = undefined
  }

  private channel(sessionId: string): Channel {
    const existing = this.channels.get(sessionId)
    if (existing !== undefined) return existing
    const created: Channel = { id: sessionId, enabled: false, failed: false, speaking: false, key: '',
      language: undefined, consumed: 0,
      buffer: '', queue: [], pending: [], controllers: new Set(), pumping: false, generation: 0, nextStart: 0,
      sources: new Set() }
    this.channels.set(sessionId, created)
    return created
  }

  private pump(channel: Channel): void {
    if (channel.pumping) return
    channel.pumping = true
    void this.drain(channel)
  }

  private async drain(channel: Channel): Promise<void> {
    const generation = channel.generation
    let spoken = false
    try {
      for (;;) {
        this.fill(channel)
        const next = channel.pending.shift()
        if (next === undefined) break
        const audio = await this.settle(channel, next, generation, spoken)
        if (!channel.enabled || channel.generation !== generation) return
        if (audio === undefined) {
          this.publish()
          continue
        }
        this.fill(channel)
        this.schedule(channel, audio)
        spoken = true
        await this.room(channel)
      }
    } finally {
      channel.pumping = false
      channel.speaking = channel.sources.size > 0
      this.publish()
      // A stop() taken mid-synthesis leaves the next request queued with no drain running, because the
      // interrupted drain was still the one holding the flag; picking the work up here starts it.
      if (channel.enabled && (channel.queue.length > 0 || channel.pending.length > 0)) this.pump(channel)
    }
  }

  /**
   * Resolve one fragment's audio, retrying a failed synthesis once.
   * A fragment the Host cannot synthesize is skipped so the rest of the reply stays audible; only a
   * reply that never produced sound reports failure.
   * @param channel - Session being read.
   * @param fragment - queued synthesis and the text it speaks.
   * @param generation - generation the drain belongs to.
   * @param spoken - whether this drain already scheduled audio.
   * @returns decoded audio, or nothing when the fragment is given up on.
   */
  private async settle(
    channel: Channel,
    fragment: PendingFragment,
    generation: number,
    spoken: boolean,
  ): Promise<AudioBuffer | undefined> {
    try {
      return await fragment.work
    } catch {
      // A withdrawn synthesis belongs to a stop() that already reset the channel; only a live failure is retried.
      if (channel.generation !== generation) return undefined
    }
    try {
      return await this.render(channel, fragment.text)
    } catch {
      if (channel.generation !== generation) return undefined
      channel.failed = !spoken
      return undefined
    }
  }

  /**
   * Start every synthesis the queue can pay for, so a fragment is already decoded when its turn comes.
   * @param channel - Session whose fragments are queued.
   */
  private fill(channel: Channel): void {
    while (channel.pending.length < PREFETCH && channel.queue.length > 0) {
      const text = channel.queue.shift() as string
      const work = this.render(channel, text)
      work.catch(() => {})
      channel.pending.push({ text, work })
      this.publish()
    }
  }

  private async render(channel: Channel, text: string): Promise<AudioBuffer> {
    const controller = new AbortController()
    channel.controllers.add(controller)
    try {
      const language = detectLanguage(text, channel.language ?? this.deps.fallbackLanguage())
      channel.language = language
      const encoded = await this.deps.speak(text, language, preferredVoice(language), controller.signal)
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
      return await this.audio().decodeAudioData(bytes.buffer)
    } finally {
      channel.controllers.delete(controller)
    }
  }

  private schedule(channel: Channel, audio: AudioBuffer): void {
    const context = this.audio()
    const source = context.createBufferSource()
    source.buffer = audio
    source.connect(context.destination)
    const start = Math.max(context.currentTime + 0.02, channel.nextStart)
    source.start(start)
    channel.nextStart = start + audio.duration
    channel.sources.add(source)
    source.onended = () => {
      channel.sources.delete(source)
      channel.speaking = channel.sources.size > 0
      this.publish()
    }
    if (!channel.speaking) {
      channel.speaking = true
      this.publish()
    }
  }

  /**
   * Hold the pipeline back once enough audio is already scheduled.
   * @param channel - Session being read.
   * @returns a promise that settles when the scheduled tail comes within reach.
   */
  private async room(channel: Channel): Promise<void> {
    const ahead = channel.nextStart - this.audio().currentTime
    if (ahead <= AHEAD_SECONDS) return
    await new Promise<void>((resolve) => { setTimeout(resolve, (ahead - AHEAD_SECONDS) * 1000) })
  }

  private stop(channel: Channel): void {
    channel.generation += 1
    for (const controller of channel.controllers) controller.abort()
    channel.controllers.clear()
    channel.queue.length = 0
    channel.pending.length = 0
    channel.buffer = ''
    channel.nextStart = 0
    for (const source of channel.sources) {
      try {
        source.stop()
      } catch {
        // The node already ended between the loop and this call; nothing is left to silence.
      }
    }
    channel.sources.clear()
    channel.speaking = false
    this.publish()
  }

  private audio(): AudioContext {
    this.context ??= new AudioContext()
    return this.context
  }

  private publish(): void {
    const channels = [...this.channels.values()]
    const enabled = channels.filter(channel => channel.enabled).map(channel => channel.id)
    const loading = channels.filter(channel => channel.enabled && channel.pending.length > 0).map(channel => channel.id)
    const speaking = channels.filter(channel => channel.enabled && channel.speaking).map(channel => channel.id)
    const failed = channels.filter(channel => channel.enabled && channel.failed).map(channel => channel.id)
    const previous = this.snapshot
    if (same(previous.enabled, enabled) && same(previous.loading, loading)
      && same(previous.speaking, speaking) && same(previous.failed, failed)) return
    this.snapshot = { enabled, loading, speaking, failed }
    this.deps.publish()
  }
}

/**
 * @param left - previous id list.
 * @param right - current id list.
 * @returns whether both lists hold the same ids in the same order.
 */
function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
