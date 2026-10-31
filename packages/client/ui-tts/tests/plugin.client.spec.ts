// @vitest-environment jsdom
/**
 * The browser plugin body: the two dictionaries it registers, the three entries it contributes to the
 * composer and the message strip, and the faces those entries reach the engine and the Host through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, inject } from '../src/client/index.ts'
import { en, es, zh } from '../src/client/locales.ts'
import { ENABLED_KEY, STORAGE_KEY } from '../src/client/voices.ts'
import { MessageReadAloud } from '../src/client/MessageReadAloud.tsx'
import { ReadAloudToggle } from '../src/client/ReadAloud.tsx'
import { SystemVoice } from '../src/client/SystemVoice.tsx'
import type { ReadAloudSnapshot } from '../src/client/engine.ts'

/** The audio bytes the Host would return, base64 encoded. */
const AUDIO = Buffer.from('audio').toString('base64')

const CATALOG = {
  voices: [{ id: 'en-sonia', name: 'Sonia', language: 'en', gender: 'female' as const }],
  voiceByLanguage: { en: 'en-sonia' },
}

/** The smallest audio graph the engine accepts, remembering what it was asked to do. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  readonly destination = { name: 'destination' }
  currentTime = 0
  resumed = 0
  closed = false
  constructor() { FakeAudioContext.instances.push(this) }
  async resume(): Promise<void> { this.resumed += 1 }
  createBufferSource() {
    return {
      buffer: null as unknown,
      onended: null as (() => void) | null,
      connect: () => {},
      start: () => {},
      stop: () => {},
    }
  }
  async decodeAudioData(): Promise<{ duration: number }> { return { duration: 1 } }
  async close(): Promise<void> { this.closed = true }
}

/** A Host answer, as the typed Remote hands it back. */
type Answer<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: Error }

/** One registration the plugin made. */
interface Registration {
  readonly name: string
  readonly id: string
  readonly locale: string
  readonly inject: () => Record<string, unknown>
  readonly Component: unknown
}

/**
 * The Cordis context the plugin body sees, with its effects and registrations captured.
 * @param answers - Host answers the case wants instead of success.
 * @returns the context and the records a case asserts against.
 */
function makeCtx(answers: {
  synthesize?: () => Promise<Answer<{ audioBase64: string }>>
  catalog?: () => Promise<Answer<typeof CATALOG>>
} = {}) {
  const effects: (() => unknown)[] = []
  const registrations: Registration[] = []
  const dictionaries: { namespace: string; entries: unknown }[] = []
  const synthesize = vi.fn(answers.synthesize ?? (async () => ({ ok: true as const, value: { audioBase64: AUDIO } })))
  const catalog = vi.fn(answers.catalog ?? (async () => ({ ok: true as const, value: CATALOG })))
  const ctx = {
    effect: vi.fn((factory: () => unknown) => { effects.push(factory); return () => {} }),
    locale: {
      register: vi.fn((namespace: string, entries: unknown) => {
        dictionaries.push({ namespace, entries })
        return () => {}
      }),
    },
    remote: { tts: { synthesize, catalog } },
    slots: {
      inject: vi.fn((_name: string, contribute: () => unknown) => contribute()),
      register: vi.fn((options: Registration, Component: unknown) => {
        registrations.push({ ...options, Component })
        return () => {}
      }),
    },
  }
  return {
    ctx,
    effects,
    registrations,
    dictionaries,
    synthesize,
    catalog,
    /** Apply the plugin and mount what it registered, as the renderer would. */
    boot: (): void => {
      apply(ctx as unknown as Context)
      for (const factory of effects) factory()
    },
  }
}

/** Let the engine's promise chain run to its next await. */
async function flush(): Promise<void> {
  for (let hop = 0; hop < 4; hop += 1) {
    await new Promise<void>((resolve) => { setImmediate(resolve) })
  }
}

beforeEach(() => {
  FakeAudioContext.instances = []
  localStorage.clear()
  document.documentElement.lang = ''
  vi.stubGlobal('AudioContext', FakeAudioContext)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('plugin registration', () => {
  it('names the services it needs', () => {
    expect(inject).toEqual(['remote', 'remote.tts', 'slots', 'locale'])
  })

  it('registers the read-aloud dictionaries under its own namespace', () => {
    const harness = makeCtx()
    harness.boot()

    expect(harness.dictionaries).toEqual([{ namespace: 'read-aloud', entries: { zh, en, es } }])
  })

  it('contributes the toggle, the voice row and the message action to their slots', () => {
    const harness = makeCtx()
    harness.boot()

    expect(harness.registrations.map(registration => [
      registration.name, registration.id, registration.locale, registration.Component,
    ])).toEqual([
      ['conversation.input.left', 'read-aloud', 'read-aloud', ReadAloudToggle],
      ['conversation.input.options', 'read-aloud-voice', 'read-aloud', SystemVoice],
      ['conversation.chat.assistant-actions', 'read-aloud-message', 'read-aloud', MessageReadAloud],
    ])
  })
})

describe('the toggle\u2019s face', () => {
  it('reads the Host\u2019s audio and publishes the reading state', async () => {
    document.documentElement.lang = 'nl-NL'
    const harness = makeCtx()
    harness.boot()
    const face = harness.registrations[0]!.inject() as {
      hooks: { readAloud: { getSnapshot: () => ReadAloudSnapshot } }
      setEnabled: (sessionId: string, enabled: boolean, key: string, shown: string) => void
      sync: (sessionId: string, key: string, text: string) => void
      finish: (sessionId: string) => void
    }

    face.setEnabled('s1', true, '1.1', 'Dankjewel.')
    await flush()

    expect(localStorage.getItem(ENABLED_KEY)).toBe('on')
    expect(harness.synthesize).toHaveBeenCalledWith({ text: 'Dankjewel.', language: 'nl' }, expect.anything())
    expect(face.hooks.readAloud.getSnapshot()).toEqual({
      enabled: ['s1'], loading: [], speaking: ['s1'], failed: [],
    })
  })

  it('sends the stored voice for the fragment\u2019s language', async () => {
    document.documentElement.lang = 'nl-NL'
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nl: 'nl-NL-ColetteNeural' }))
    const harness = makeCtx()
    harness.boot()
    const face = harness.registrations[0]!.inject() as {
      setEnabled: (sessionId: string, enabled: boolean, key: string, shown: string) => void
    }

    face.setEnabled('s1', true, '1.1', 'Dankjewel.')
    await flush()

    expect(harness.synthesize).toHaveBeenCalledWith(
      { text: 'Dankjewel.', language: 'nl', voiceId: 'nl-NL-ColetteNeural' },
      expect.anything(),
    )
  })

  it('feeds the growing step text and the end of the step', async () => {
    document.documentElement.lang = 'en-GB'
    const harness = makeCtx()
    harness.boot()
    const face = harness.registrations[0]!.inject() as {
      setEnabled: (sessionId: string, enabled: boolean, key: string, shown: string) => void
      sync: (sessionId: string, key: string, text: string) => void
      finish: (sessionId: string) => void
    }
    face.setEnabled('s1', true, '1.1', '')
    face.sync('s1', '1.1', 'Hello there')
    await flush()
    expect(harness.synthesize).not.toHaveBeenCalled()

    face.finish('s1')
    await flush()
    expect(harness.synthesize).toHaveBeenCalledWith({ text: 'Hello there', language: 'en' }, expect.anything())
  })

  it('records the standing choice and stops the reading when switched off', async () => {
    const harness = makeCtx()
    harness.boot()
    const face = harness.registrations[0]!.inject() as {
      hooks: { readAloud: { getSnapshot: () => ReadAloudSnapshot } }
      setEnabled: (sessionId: string, enabled: boolean, key: string, shown: string) => void
    }
    face.setEnabled('s1', true, '1.1', 'Hello there.')
    await flush()
    face.setEnabled('s1', false, '1.1', 'Hello there.')

    expect(localStorage.getItem(ENABLED_KEY)).toBe('off')
    expect(face.hooks.readAloud.getSnapshot()).toEqual({ enabled: [], loading: [], speaking: [], failed: [] })
  })

  it('reports a reply the Host could not synthesize', async () => {
    const harness = makeCtx({ synthesize: async () => ({ ok: false, error: new Error('tts down') }) })
    harness.boot()
    const face = harness.registrations[0]!.inject() as {
      hooks: { readAloud: { getSnapshot: () => ReadAloudSnapshot } }
      setEnabled: (sessionId: string, enabled: boolean, key: string, shown: string) => void
    }
    face.setEnabled('s1', true, '1.1', 'Hello there.')
    await flush()
    await flush()

    expect(harness.synthesize).toHaveBeenCalledTimes(2)
    expect(face.hooks.readAloud.getSnapshot().failed).toEqual(['s1'])
  })

  it('notifies subscribers until they unsubscribe', async () => {
    const harness = makeCtx()
    harness.boot()
    const face = harness.registrations[0]!.inject() as {
      hooks: { readAloud: { subscribe: (listener: () => void) => () => void } }
      setEnabled: (sessionId: string, enabled: boolean, key: string, shown: string) => void
    }
    const listener = vi.fn()
    const stop = face.hooks.readAloud.subscribe(listener)

    face.setEnabled('s1', true, '1.1', 'Hello there.')
    await flush()
    expect(listener).toHaveBeenCalled()
    const seen = listener.mock.calls.length

    stop()
    face.setEnabled('s1', false, '1.1', 'Hello there.')
    await flush()
    expect(listener.mock.calls.length).toBe(seen)
  })

  it('closes the audio graph when the plugin is disposed', async () => {
    const harness = makeCtx()
    apply(harness.ctx as unknown as Context)
    const face = harness.registrations[0]!.inject() as {
      setEnabled: (sessionId: string, enabled: boolean, key: string, shown: string) => void
    }
    face.setEnabled('s1', true, '1.1', 'Hello there.')
    await flush()

    for (const factory of harness.effects) {
      const disposer = factory()
      if (typeof disposer === 'function') (disposer as () => void)()
    }
    expect(FakeAudioContext.instances[0]?.closed).toBe(true)
  })
})

describe('the voice row\u2019s face', () => {
  it('hands the Host catalogue to the picker', async () => {
    const harness = makeCtx()
    harness.boot()
    const face = harness.registrations[1]!.inject() as { loadCatalog: () => Promise<unknown> }

    await expect(face.loadCatalog()).resolves.toEqual(CATALOG)
  })

  it('reports a catalogue the Host refused', async () => {
    const harness = makeCtx({
      catalog: async () => ({ ok: false, error: new Error('no catalogue') }),
    })
    harness.boot()
    const face = harness.registrations[1]!.inject() as { loadCatalog: () => Promise<unknown> }

    await expect(face.loadCatalog()).rejects.toThrow('no catalogue')
  })
})

describe('the message action\u2019s face', () => {
  it('reads one message on its own channel and stops it again', async () => {
    const harness = makeCtx()
    harness.boot()
    const face = harness.registrations[2]!.inject() as {
      hooks: { readAloud: { getSnapshot: () => ReadAloudSnapshot } }
      read: (channel: string, text: string) => void
      stop: (channel: string) => void
    }

    face.read('message:m1', 'Read this.')
    await flush()
    expect(face.hooks.readAloud.getSnapshot().speaking).toEqual(['message:m1'])
    expect(harness.synthesize).toHaveBeenCalledWith({ text: 'Read this.', language: 'en' }, expect.anything())

    face.stop('message:m1')
    expect(face.hooks.readAloud.getSnapshot()).toEqual({ enabled: [], loading: [], speaking: [], failed: [] })
  })
})
