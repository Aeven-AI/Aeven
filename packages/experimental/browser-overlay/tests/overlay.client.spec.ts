// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { BrowserOverlay, IDLE_HIDE_MS } from '../src/overlay.ts'
import type { AttachOptions, Rect } from '../src/overlay.ts'
import { CLASS_PREFIX, cls } from '../src/styles.ts'

/**
 * The overlay's own pointer/action surface, driven through its public API.
 *
 * Everything the class does outside `attach()` is reachable this way: the
 * animation-frame loop runs from a captured `requestAnimationFrame` callback,
 * timers from fake time, and the scroll/resize listeners from real dispatched
 * events.
 */

/** Frames the overlay requested, in request order; the stub never runs them. */
let frames: FrameRequestCallback[] = []

/** Handles passed to `cancelAnimationFrame`. */
let cancelledFrames: number[] = []

/** Overlays created by a test, torn down afterwards. */
let live: BrowserOverlay[] = []

/** The overlay root, as a page's own selector queries would find it. */
function rootElement(): HTMLElement | null {
  return document.documentElement.querySelector<HTMLElement>(`.${CLASS_PREFIX}`)
}

/** One overlay-owned element, by class suffix. */
function part(suffix: string): HTMLElement | null {
  return rootElement()?.querySelector<HTMLElement>(`.${cls(suffix)}`) ?? null
}

/** Every overlay-owned element with that class suffix, in document order. */
function parts(suffix: string): HTMLElement[] {
  return [...(rootElement()?.querySelectorAll<HTMLElement>(`.${cls(suffix)}`) ?? [])]
}

/** Build an overlay that the test's teardown will destroy. */
function makeOverlay(options: AttachOptions = {}): BrowserOverlay {
  const overlay = new BrowserOverlay(options)
  live.push(overlay)
  return overlay
}

/** A `DOMRect` carrying `rect`'s measurements, since jsdom measures everything as zero. */
function domRect(rect: Rect): DOMRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => rect,
  }
}

/** An element with a fixed viewport rectangle, because the redraw math needs real numbers. */
function measuredElement(rect: Rect): HTMLElement {
  const element = document.createElement('div')
  document.body.append(element)
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(domRect(rect))
  return element
}

/** Move an element's viewport rectangle, as a scroll or a reflow would. */
function remeasure(element: HTMLElement, rect: Rect): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(domRect(rect))
}

/** The measurement pair the overlay drives, as a mocked audio node exposes it. */
interface MockedAudioParam {
  setValueAtTime: ReturnType<typeof vi.fn>
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>
}

/** The parts of a stubbed `AudioContext` the overlay's click sound touches. */
interface AudioContextStub {
  /** The context instance every `new AudioContext()` returns. */
  context: {
    currentTime: number
    destination: object
    createOscillator: ReturnType<typeof vi.fn>
    createGain: ReturnType<typeof vi.fn>
    close: Mock<() => Promise<void>>
  }
  /** The oscillator the overlay configured and started. */
  oscillator: {
    type: string
    frequency: MockedAudioParam
    connect: ReturnType<typeof vi.fn>
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  }
  /** The gain node the oscillator was connected through. */
  gain: {
    gain: MockedAudioParam
    connect: ReturnType<typeof vi.fn>
  }
  /** The `AudioContext` constructor the overlay calls. */
  construct: ReturnType<typeof vi.fn>
}

/** Install a working `AudioContext` and hand back its observable pieces. */
function stubAudioContext(): AudioContextStub {
  const connect = vi.fn((node: unknown) => node)
  const oscillator = {
    type: '',
    frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect,
    start: vi.fn(),
    stop: vi.fn(),
  }
  const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect }
  const context = {
    currentTime: 4.25,
    destination: { name: 'destination' },
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
    close: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  }
  const construct = vi.fn(function AudioContextStub() { return context })
  vi.stubGlobal('AudioContext', construct)
  return { context, oscillator, gain, construct }
}

/**
 * Run queued animation frames until the motion model stops asking for more.
 * @returns how many frames ran, so a test can compare two motion settings.
 */
function runFramesUntilRest(startAt: number = performance.now(), limit = 4000): number {
  let now = startAt
  let ran = 0
  while (frames.length > 0 && ran < limit) {
    const tick = frames.shift()!
    now += 16
    tick(now)
    ran += 1
  }
  return ran
}

beforeEach(() => {
  vi.useFakeTimers()
  frames = []
  cancelledFrames = []
  live = []
  // The stub records frames instead of scheduling them, so every test decides
  // exactly when the loop advances.
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => { cancelledFrames.push(handle) })
})

afterEach(() => {
  for (const overlay of live) overlay.destroy()
  live = []
  // A teardown that raced an attach leaves a root no instance owns any more.
  for (const orphan of document.querySelectorAll(`.${CLASS_PREFIX}`)) orphan.remove()
  // Spies on shared globals must not leak into the next test's call records.
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('BrowserOverlay lifecycle', () => {
  it('is inert until attach() and reports no pointer state', () => {
    const overlay = makeOverlay()

    expect(overlay.attached).toBe(false)
    expect(overlay.point).toBeUndefined()
    // Nothing on screen means the mode falls back to the default wording.
    expect(overlay.mode).toBe('comment')
    expect(rootElement()).toBeNull()
  })

  it('puts one root on the document and returns itself from attach()', () => {
    const overlay = makeOverlay()

    expect(overlay.attach()).toBe(overlay)
    expect(overlay.attached).toBe(true)

    const root = rootElement()
    expect(root).not.toBeNull()
    expect(root?.getAttribute('aria-hidden')).toBe('true')
    expect(root?.dataset.visible).toBe('false')

    // A second attach is a no-op rather than a second layer.
    overlay.attach()
    expect(document.querySelectorAll(`.${CLASS_PREFIX}`)).toHaveLength(1)
    expect(rootElement()).toBe(root)
  })

  it('builds the sprite, caret layer, box, and label once', () => {
    makeOverlay().attach()

    const sprite = part('cursor-sprite')?.querySelector('img')
    expect(sprite?.alt).toBe('')
    expect(sprite?.draggable).toBe(false)
    expect(sprite?.decoding).toBe('sync')
    expect(sprite?.getAttribute('data-aeven-browser-overlay-sprite')).toBe('')
    expect(sprite?.src.startsWith('data:image/')).toBe(true)
    expect(part('label')).not.toBeNull()
    expect(part('box')?.style.display).toBe('none')
    expect(part('box')?.dataset.kind).toBe('hover')
    expect(part('cursor')?.dataset.mode).toBe('comment')
  })

  it('injects its stylesheet into the root', () => {
    makeOverlay().attach()

    const style = rootElement()?.querySelector('style')
    expect(style?.textContent).toContain(`.${CLASS_PREFIX}`)
  })

  it('defers the append to DOMContentLoaded for a document-start injection', () => {
    const loading = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    const overlay = makeOverlay()
    overlay.attach()
    loading.mockRestore()

    // The instance is live and queues actions, but nothing is in the document yet.
    expect(overlay.attached).toBe(true)
    expect(rootElement()).toBeNull()
    expect(() => { overlay.moveTo({ x: 4, y: 5 }) }).not.toThrow()

    document.dispatchEvent(new Event('DOMContentLoaded'))
    expect(rootElement()).not.toBeNull()
  })

  it('stays inert when a host tears the overlay down while it is being injected', () => {
    const overlay = makeOverlay({ idleHideMs: 0 })
    const add = vi.spyOn(window, 'addEventListener')
    // A host may take the overlay down while attach() is still assembling it.
    // Reading `readyState` here is exactly the moment the root would join the
    // document, so the teardown lands between the elements and the listeners.
    const readyState = vi.spyOn(document, 'readyState', 'get').mockImplementation(() => {
      overlay.destroy()
      return 'complete'
    })
    overlay.attach()
    readyState.mockRestore()
    expect(overlay.attached).toBe(false)

    const [, , scrollOptions] = add.mock.calls.find(([type]) => type === 'scroll')!
    // The listeners were registered after the teardown, so they are live and
    // there is no box for them to redraw: a page event must find neither.
    expect((scrollOptions as AddEventListenerOptions).signal?.aborted).toBe(false)
    const box = part('box')!
    box.style.transform = 'translate(7px, 8px)'
    expect(() => {
      window.dispatchEvent(new Event('scroll'))
      window.dispatchEvent(new Event('resize'))
    }).not.toThrow()
    expect(box.style.transform).toBe('translate(7px, 8px)')
  })

  it('does not append a root destroyed before DOMContentLoaded fires', () => {
    const loading = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    const overlay = makeOverlay()
    overlay.attach()
    loading.mockRestore()

    overlay.destroy()
    document.dispatchEvent(new Event('DOMContentLoaded'))
    expect(rootElement()).toBeNull()
  })

  it('takes the overlay and every resource down with destroy()', async () => {
    const { context } = stubAudioContext()
    const overlay = makeOverlay({ sound: true, idleHideMs: 50 })
    overlay.attach()
    overlay.moveTo({ x: 10, y: 20 })
    overlay.type({ x: 10, y: 20 })
    overlay.click({ x: 10, y: 20 })
    const pending = frames.length
    expect(pending).toBeGreaterThan(0)

    overlay.destroy()

    expect(overlay.attached).toBe(false)
    expect(overlay.point).toBeUndefined()
    expect(rootElement()).toBeNull()
    expect(cancelledFrames).toContain(pending)
    expect(context.close).toHaveBeenCalledTimes(1)
    await Promise.resolve()

    // Already detached: a second destroy is a no-op rather than an error.
    expect(() => { overlay.destroy() }).not.toThrow()
  })

  it('contains an action a host callback re-enters with during teardown', () => {
    const { context } = stubAudioContext()
    const overlay = makeOverlay({ sound: true, idleHideMs: 0 }).attach()
    overlay.click({ x: 10, y: 20 })
    const requested = frames.length
    expect(requested).toBe(1)

    // close() is destroy()'s last call out to host-owned code, and it runs after
    // the motion model is released but before the root is: an action arriving
    // there must not start a glide against a model that is already gone.
    context.close.mockImplementation(() => {
      overlay.moveTo({ x: 500, y: 400 }, { label: 'Too late' })
      return Promise.resolve()
    })
    overlay.destroy()

    expect(frames).toHaveLength(requested)
    expect(overlay.attached).toBe(false)
    expect(overlay.point).toBeUndefined()
  })

  it('swallows a close() that rejects', async () => {
    const { context } = stubAudioContext()
    context.close.mockReturnValue(Promise.reject(new Error('blocked')))
    const overlay = makeOverlay({ sound: true }).attach()
    overlay.click({ x: 1, y: 2 })

    expect(() => { overlay.destroy() }).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(context.close).toHaveBeenCalledTimes(1)
  })
})

describe('BrowserOverlay pointer actions', () => {
  it('refuses every action while detached', () => {
    const overlay = makeOverlay()

    overlay.moveTo({ x: 1, y: 1 })
    overlay.hover(measuredElement({ x: 1, y: 1, width: 2, height: 2 }))
    overlay.click({ x: 1, y: 1 })
    overlay.type({ x: 1, y: 1 })
    overlay.scroll({ x: 1, y: 1 })
    overlay.setThinkEnabled(false)
    overlay.hide()

    expect(overlay.point).toBeUndefined()
    expect(rootElement()).toBeNull()
    expect(frames).toHaveLength(0)
  })

  it('shows the pointer at the point it was sent to', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()

    overlay.moveTo({ x: 120, y: 340 })

    expect(overlay.point).toEqual({ x: 120, y: 340 })
    expect(part('cursor')?.dataset.visible).toBe('true')
    expect(rootElement()?.dataset.visible).toBe('true')
    // The point reads back as a copy: a caller cannot edit the overlay's state.
    const read = overlay.point
    if (read === undefined) throw new Error('expected a point')
    read.x = 999
    expect(overlay.point).toEqual({ x: 120, y: 340 })
  })

  it('switches the pointer between the two action moments', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()

    overlay.moveTo({ x: 1, y: 1 }, { mode: 'add' })
    expect(overlay.mode).toBe('add')
    // A second move without a mode leaves the pointer where it was.
    overlay.moveTo({ x: 2, y: 2 })
    expect(overlay.mode).toBe('add')
    overlay.moveTo({ x: 3, y: 3 }, { mode: 'comment' })
    expect(overlay.mode).toBe('comment')
  })

  it('labels an action and clears the label when the text is empty', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()

    overlay.moveTo({ x: 40, y: 50 }, { label: 'Clicking Sign in' })
    const label = part('label')
    expect(label?.textContent).toBe('Clicking Sign in')
    expect(label?.dataset.visible).toBe('true')
    expect(label?.style.transform).toBe('translate(58px, 64px)')

    overlay.moveTo({ x: 40, y: 50 }, { label: '' })
    expect(label?.dataset.visible).toBe('false')
  })

  it('flips a label that would land off the right or bottom edge', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()
    const label = part('label')!
    Object.defineProperty(label, 'offsetWidth', { value: 200, configurable: true })
    Object.defineProperty(label, 'offsetHeight', { value: 100, configurable: true })

    overlay.moveTo({ x: innerWidth - 10, y: innerHeight - 10 }, { label: 'Saving' })

    // Flipped to the pointer's upper-left and clamped inside the viewport.
    expect(label.style.transform).toBe(`translate(${Math.max(4, innerWidth - 10 - 18 - 200)}px, ${Math.max(4, innerHeight - 10 - 14 - 100)}px)`)
  })

  it('hides the pointer after the idle timeout', () => {
    const overlay = makeOverlay().attach()
    overlay.moveTo({ x: 7, y: 8 }, { label: 'Reading' })

    vi.advanceTimersByTime(IDLE_HIDE_MS - 1)
    expect(part('cursor')?.dataset.visible).toBe('true')

    vi.advanceTimersByTime(1)
    expect(part('cursor')?.dataset.visible).toBe('false')
    expect(rootElement()?.dataset.visible).toBe('false')
    expect(part('label')?.dataset.visible).toBe('false')
  })

  it('keeps the pointer visible when the idle timeout is disabled', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()
    overlay.moveTo({ x: 7, y: 8 })

    vi.advanceTimersByTime(IDLE_HIDE_MS * 2)
    expect(part('cursor')?.dataset.visible).toBe('true')
  })

  it('restarts the idle countdown on each action', () => {
    const overlay = makeOverlay({ idleHideMs: 1000 }).attach()

    overlay.moveTo({ x: 1, y: 1 })
    vi.advanceTimersByTime(900)
    overlay.moveTo({ x: 2, y: 2 })
    vi.advanceTimersByTime(900)
    expect(part('cursor')?.dataset.visible).toBe('true')

    vi.advanceTimersByTime(100)
    expect(part('cursor')?.dataset.visible).toBe('false')
  })

  it('toggles the idle wobble on a detached and on a live instance', () => {
    const overlay = makeOverlay({ idleHideMs: 0 })

    // Detached there is no motion model yet, and that must not throw.
    expect(() => { overlay.setThinkEnabled(false) }).not.toThrow()

    overlay.attach()
    overlay.setThinkEnabled(false)
    overlay.moveTo({ x: 300, y: 200 })
    const wobbleOffFrames = runFramesUntilRest()

    overlay.setThinkEnabled(true)
    overlay.moveTo({ x: 0, y: 0 })
    const wobbleOnFrames = runFramesUntilRest()

    // The wobble keeps the loop alive after arrival, so it runs longer.
    expect(wobbleOffFrames).toBeGreaterThan(0)
    expect(wobbleOnFrames).toBeGreaterThan(wobbleOffFrames)
  })
})

describe('BrowserOverlay decorations', () => {
  it('creates nothing that marks a target or a moment when they are off', () => {
    const overlay = makeOverlay({ decorations: false }).attach()

    // The pointer is still drawn: it is what the host asked for.
    expect(part('cursor')).not.toBeNull()
    expect(part('cursor-sprite')).not.toBeNull()
    expect(part('box')).toBeNull()
    expect(part('label')).toBeNull()
    overlay.hover({ x: 1, y: 2, width: 3, height: 4 })
    expect(part('box')).toBeNull()
  })

  it('draws no click ring, flash, or caret when they are off', () => {
    const overlay = makeOverlay({ decorations: false }).attach()

    overlay.click({ x: 20, y: 30 })
    overlay.type({ x: 20, y: 30 })
    expect(parts('ripple')).toHaveLength(0)
    expect(parts('flash')).toHaveLength(0)
    expect(parts('caret')).toHaveLength(0)
  })

  it('draws them by default', () => {
    const overlay = makeOverlay().attach()

    overlay.click({ x: 20, y: 30 })
    overlay.type({ x: 20, y: 30 })
    expect(parts('ripple')).toHaveLength(1)
    expect(parts('flash')).toHaveLength(1)
    expect(parts('caret')).toHaveLength(1)
  })
})

describe('BrowserOverlay hover box', () => {
  it('tracks an element and re-measures it as the page moves', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()
    const element = measuredElement({ x: 10, y: 20, width: 30, height: 40 })

    overlay.hover(element, { kind: 'region' })

    const box = part('box')!
    expect(box.dataset.kind).toBe('region')
    expect(box.dataset.rect).toBeUndefined()
    expect(box.style.display).toBe('block')
    expect(box.style.transform).toBe('translate(10px, 20px)')
    expect(box.style.width).toBe('30px')
    expect(box.style.height).toBe('40px')

    remeasure(element, { x: 15, y: 25, width: 35, height: 45 })
    window.dispatchEvent(new Event('scroll'))
    expect(box.style.transform).toBe('translate(15px, 25px)')
    expect(box.style.width).toBe('35px')

    remeasure(element, { x: 1, y: 2, width: 3, height: 4 })
    window.dispatchEvent(new Event('resize'))
    expect(box.style.transform).toBe('translate(1px, 2px)')
  })

  it('draws a plain rectangle without tracking an element', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()

    overlay.hover({ x: 5, y: 6, width: 7, height: 8 })

    const box = part('box')!
    expect(box.dataset.kind).toBe('hover')
    expect(JSON.parse(box.dataset.rect ?? '{}')).toEqual({ x: 5, y: 6, width: 7, height: 8 })
    expect(box.style.width).toBe('7px')
    expect(box.style.height).toBe('8px')

    // A rectangle is a snapshot, so a scroll must not move it.
    window.dispatchEvent(new Event('scroll'))
    expect(box.style.transform).toBe('translate(5px, 6px)')
  })

  it('clears the highlight when the target is dropped', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()
    overlay.hover({ x: 5, y: 6, width: 7, height: 8 })

    overlay.hover(undefined)

    const box = part('box')!
    expect(box.style.display).toBe('none')
    expect(box.dataset.rect).toBeUndefined()
  })

  it('drops the highlight when the tracked element leaves the document', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()
    const element = measuredElement({ x: 10, y: 20, width: 30, height: 40 })
    overlay.hover(element)
    const box = part('box')!

    element.remove()
    window.dispatchEvent(new Event('scroll'))
    expect(box.style.display).toBe('none')
    expect(box.dataset.rect).toBeUndefined()

    // With no element and no rectangle there is nothing left to redraw from; a
    // later scroll must not resurrect a box or throw on a missing rectangle.
    const before = box.style.cssText
    window.dispatchEvent(new Event('resize'))
    expect(box.style.cssText).toBe(before)
  })

  it('ignores hover before attach', () => {
    const overlay = makeOverlay()

    overlay.hover({ x: 1, y: 2, width: 3, height: 4 })
    expect(rootElement()).toBeNull()
  })

  it('releases the scroll and resize listeners on destroy', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const overlay = makeOverlay({ idleHideMs: 0 })
    overlay.attach()

    const registered = add.mock.calls.filter(([type]) => type === 'scroll' || type === 'resize')
    expect(registered.map(([type]) => type)).toEqual(['scroll', 'resize'])
    const [, , scrollOptions] = registered[0]
    const [, , resizeOptions] = registered[1]
    expect((scrollOptions as AddEventListenerOptions).capture).toBe(true)
    expect((scrollOptions as AddEventListenerOptions).passive).toBe(true)
    const scrollSignal = (scrollOptions as AddEventListenerOptions).signal!
    const resizeSignal = (resizeOptions as AddEventListenerOptions).signal!
    expect(scrollSignal.aborted).toBe(false)

    overlay.destroy()
    expect(scrollSignal.aborted).toBe(true)
    expect(resizeSignal.aborted).toBe(true)
  })
})

describe('BrowserOverlay action feedback', () => {
  it('expands a ripple and a flash that clear themselves', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()

    overlay.click({ x: 200, y: 100 }, { label: 'Clicking Pay' })

    const ripple = parts('ripple')
    const flash = parts('flash')
    expect(ripple).toHaveLength(1)
    expect(flash).toHaveLength(1)
    expect(ripple[0]?.style.left).toBe('200px')
    expect(ripple[0]?.style.top).toBe('100px')
    expect(part('label')?.textContent).toBe('Clicking Pay')

    vi.advanceTimersByTime(380)
    expect(parts('flash')).toHaveLength(0)
    expect(parts('ripple')).toHaveLength(1)
    vi.advanceTimersByTime(240)
    expect(parts('ripple')).toHaveLength(0)
  })

  it('clicks without a label and without a mode override', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()
    overlay.moveTo({ x: 1, y: 1 }, { mode: 'add' })

    overlay.click({ x: 2, y: 2 })

    // The click commits, so the pointer returns to the committed moment even
    // when the caller names no label.
    expect(overlay.mode).toBe('comment')
    expect(part('label')?.dataset.visible).toBe('false')
  })

  it('stays silent unless sound was asked for', () => {
    const { construct } = stubAudioContext()
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()

    overlay.click({ x: 1, y: 2 })

    expect(construct).not.toHaveBeenCalled()
  })

  it('synthesizes one click sound and reuses its audio context', () => {
    const { construct, oscillator, gain, context } = stubAudioContext()
    const overlay = makeOverlay({ sound: true, idleHideMs: 0 }).attach()

    overlay.click({ x: 1, y: 2 })
    overlay.click({ x: 3, y: 4 })

    expect(construct).toHaveBeenCalledTimes(1)
    expect(oscillator.type).toBe('triangle')
    expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(1180, 4.25)
    expect(oscillator.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(560, 4.295)
    expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.06, 4.256)
    expect(gain.connect).toHaveBeenCalledWith(context.destination)
    expect(oscillator.start).toHaveBeenCalledWith(4.25)
    expect(oscillator.stop).toHaveBeenCalledWith(4.33)
  })

  it('still clicks when the audio context is blocked', () => {
    vi.stubGlobal('AudioContext', vi.fn(function BlockedAudioContext() { throw new Error('blocked') }))
    const overlay = makeOverlay({ sound: true, idleHideMs: 0 }).attach()

    expect(() => { overlay.click({ x: 1, y: 2 }) }).not.toThrow()
    expect(parts('ripple')).toHaveLength(1)
  })

  it('accepts a sound override passed to attach()', () => {
    const { construct } = stubAudioContext()
    const overlay = makeOverlay()
    overlay.attach({ sound: true, idleHideMs: 0 })

    overlay.click({ x: 1, y: 2 })
    expect(construct).toHaveBeenCalledTimes(1)
  })

  it('blinks a caret that clears itself', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()

    overlay.type({ x: 30, y: 40 }, { label: 'Typing the email' })

    const carets = parts('caret')
    expect(carets).toHaveLength(1)
    expect(carets[0]?.style.left).toBe('30px')
    expect(part('label')?.textContent).toBe('Typing the email')

    vi.advanceTimersByTime(900)
    expect(parts('caret')).toHaveLength(0)
  })

  it('replaces the previous caret when typing moves on', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()

    overlay.type({ x: 1, y: 1 })
    overlay.type({ x: 2, y: 2 })

    expect(parts('caret')).toHaveLength(2)
    vi.advanceTimersByTime(900)
    expect(parts('caret')).toHaveLength(0)
  })

  it('shows a scroll by moving the pointer, and draws no separate glyph', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()

    overlay.scroll({ x: 50, y: 60 }, { label: 'Scrolling up' })

    expect(overlay.point).toEqual({ x: 50, y: 60 })
    expect(part('label')?.textContent).toBe('Scrolling up')
    // The travel is the affordance: a chevron alongside it said the same thing
    // twice, in a hue the page around it need not share.
    expect(parts('scroll')).toHaveLength(0)
  })
})

describe('BrowserOverlay animation frame loop', () => {
  it('drives the cursor transform and opacity from the motion model', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()
    const cursor = part('cursor')!

    overlay.moveTo({ x: 300, y: 200 })

    expect(frames).toHaveLength(1)
    frames.shift()!(performance.now() + 16)

    expect(cursor.style.transform).toContain('translate3d(')
    expect(cursor.style.transform).toContain('rotate(')
    // The fade has started but has not finished, so the pointer is part way in.
    expect(Number(cursor.style.opacity)).toBeGreaterThan(0)
    expect(Number(cursor.style.opacity)).toBeLessThan(1)
    // Still travelling, so the loop asked for another frame.
    expect(frames).toHaveLength(1)
    expect(cancelledFrames).toHaveLength(0)
  })

  it('keeps one frame in flight while a move is redirected mid-glide', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()

    overlay.moveTo({ x: 300, y: 200 })
    overlay.moveTo({ x: 320, y: 210 })

    expect(frames).toHaveLength(1)
  })

  it('stops requesting frames once the cursor has arrived and faded in', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()
    const cursor = part('cursor')!

    overlay.moveTo({ x: 300, y: 200 })
    const ran = runFramesUntilRest()

    expect(frames).toHaveLength(0)
    expect(ran).toBeGreaterThan(1)
    expect(cursor.style.opacity).toBe('1')
    expect(cursor.style.transform).toBe('translate3d(288px, 188px, 0) rotate(0deg) scale(1, 1)')
  })

  it('drops the frame it was holding when the overlay is destroyed', () => {
    const overlay = makeOverlay({ idleHideMs: 0 }).attach()
    overlay.moveTo({ x: 300, y: 200 })
    const pending = frames.shift()!

    overlay.destroy()

    // The document may still deliver the callback it was handed, and it must
    // find nothing left to draw into.
    expect(() => { pending(performance.now() + 16) }).not.toThrow()
    expect(frames).toHaveLength(0)
  })
})
