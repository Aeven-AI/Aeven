/**
 * The agent's on-screen pointer: a DOM overlay the host injects into a page the
 * model is operating, so a person watching can see where the agent is about to
 * act and what it just did.
 *
 * The overlay never handles input and never reads the page's own state. It is a
 * pure display surface: the host tells it a point and an action, and it draws.
 * That keeps every judgment — which element, which coordinates, whether an action
 * actually landed — with the caller, which is the only party that knows.
 * @module
 */

import {
  ACCENT,
  CLASS_PREFIX,
  cls,
  CURSOR_BOX,
  overlayStyles,
} from './styles.ts'
import { CURSOR_ASSET_URL } from './cursor-asset.ts'
import { CursorMotion, cursorTransform, visibilityStyles } from './motion.ts'

/**
 * Which moment of an action the pointer is showing.
 *
 * Both modes draw the same sprite. The distinction is the action's commitment —
 * `add` while a target is still being chosen, `comment` once a point is
 * committed — and the overlay expresses that through its label rather than by
 * swapping the glyph, so the pointer is always the same recognizable shape.
 */
export type CursorMode = 'comment' | 'add'

/** A point in the page's own viewport coordinates (CSS pixels, origin top-left). */
export interface Point {
  x: number
  y: number
}

/** A viewport-space rectangle, as `DOMRect`-like reads report it. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Idle time after which the pointer hides itself, in milliseconds.
 *
 * The pointer is meaningless when nothing is happening, and leaving it parked
 * over page content invites a misread. The reference app also uses 20s.
 */
export const IDLE_HIDE_MS = 20_000

/** How long one click's ripple stays on screen, in milliseconds. */
const RIPPLE_MS = 620

/** How long a typing caret stays visible at a point, in milliseconds. */
const CARET_MS = 900

/** Options for {@link BrowserOverlay.attach}. */
export interface AttachOptions {
  /**
   * Emit a short click sound on each pointer action. Off by default: an
   * unexpected noise in someone's browser is worse than no feedback, and a page
   * with its own audio should not have to compete with the overlay.
   */
  sound?: boolean
  /** Idle-hide timeout; defaults to {@link IDLE_HIDE_MS}. `0` keeps it visible. */
  idleHideMs?: number
}

/**
 * The injected overlay.
 *
 * One instance owns one document. Constructing it has no side effects; call
 * {@link attach} to put it on screen and {@link destroy} to take it off and
 * release every listener it registered.
 */
export class BrowserOverlay {
  readonly #options: Required<AttachOptions>

  #root: HTMLDivElement | undefined
  #cursor: HTMLDivElement | undefined
  #label: HTMLDivElement | undefined
  #box: HTMLDivElement | undefined
  #hoverTarget: Element | undefined
  #sounds: AudioContext | undefined

  #point: Point | undefined
  #idleTimer: ReturnType<typeof setTimeout> | undefined
  #caretTimer: ReturnType<typeof setTimeout> | undefined
  #listeners: AbortController | undefined
  #motion: CursorMotion | undefined
  #frame: number | undefined
  #lastFrameAt = 0

  constructor(options: AttachOptions = {}) {
    this.#options = {
      sound: options.sound ?? false,
      idleHideMs: options.idleHideMs ?? IDLE_HIDE_MS,
    }
  }

  /** Whether the overlay is currently on screen. */
  get attached(): boolean {
    return this.#root !== undefined
  }

  /** Where the pointer currently sits, in viewport coordinates. */
  get point(): Point | undefined {
    return this.#point === undefined ? undefined : { ...this.#point }
  }

  /** Which moment of an action the pointer is currently expressing. */
  get mode(): CursorMode {
    return this.#cursor?.dataset.mode === 'add' ? 'add' : 'comment'
  }

  /**
   * Put the overlay on screen, idempotently.
   *
   * The stylesheet and every element are created once and reused, so a repeated
   * call is a no-op rather than a second layer. Appends to `documentElement`,
   * not `body`, so a page that replaces its body mid-session does not orphan it.
   * @param options - per-attach overrides; identical to the constructor's.
   * @returns this instance, for chaining.
   */
  attach(options: AttachOptions = {}): this {
    Object.assign(this.#options, options)
    if (this.#root !== undefined) return this

    const doc = document
    const root = doc.createElement('div')
    root.className = CLASS_PREFIX
    root.setAttribute('aria-hidden', 'true')
    root.dataset.visible = 'false'

    const style = doc.createElement('style')
    style.textContent = overlayStyles()
    root.append(style)

    const box = doc.createElement('div')
    box.className = cls('box')
    box.dataset.kind = 'hover'
    box.style.display = 'none'

    const label = doc.createElement('div')
    label.className = cls('label')

    const layer = doc.createElement('div')
    layer.className = cls('cursor-layer')

    const cursor = doc.createElement('div')
    cursor.className = cls('cursor')
    cursor.dataset.mode = 'comment'
    cursor.dataset.visible = 'false'

    // The sprite is an <img> with a data URI: a plain element cannot be styled by
    // the page's own `img` rules that way, and a data URI cannot be blocked by CSP
    // or 404 from the target origin.
    const wrapper = doc.createElement('div')
    wrapper.className = cls('cursor-sprite')
    const sprite = doc.createElement('img')
    sprite.alt = ''
    sprite.draggable = false
    sprite.decoding = 'sync'
    sprite.dataset.aevenBrowserOverlaySprite = ''
    sprite.src = CURSOR_ASSET_URL
    wrapper.append(sprite)
    cursor.append(wrapper)

    layer.append(cursor)
    root.append(box, label, layer)

    this.#root = root
    this.#cursor = cursor
    this.#label = label
    this.#box = box
    this.#motion = new CursorMotion()

    // A document-start injection has no `documentElement` yet; the elements are
    // built regardless so a caller can queue actions, and the root joins the
    // document as soon as there is one to join.
    // A document-start injection runs while the document is still `loading` and
    // the parser has not created a root element to append to, so readiness — not
    // the element's type — is what decides. Deferring the append keeps attach()
    // safe at any point in the document lifecycle.
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', () => {
        if (this.#root !== undefined) doc.documentElement.append(this.#root)
      }, { once: true })
    } else {
      doc.documentElement.append(root)
    }

    // Scroll and resize move page content under a viewport-anchored box, so a
    // hover rectangle must be recomputed rather than cached.
    const listeners = new AbortController()
    const reposition = (): void => { this.#redrawBox() }
    addEventListener('scroll', reposition, { capture: true, passive: true, signal: listeners.signal })
    addEventListener('resize', reposition, { passive: true, signal: listeners.signal })
    this.#listeners = listeners

    return this
  }

  /**
   * Remove the overlay and release every listener, timer, and audio resource.
   *
   * Safe to call when already detached. The DOM subtree is removed outright
   * rather than hidden, so a page's own selector queries cannot observe it.
   */
  destroy(): void {
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame)
    this.#frame = undefined
    this.#motion = undefined
    if (this.#idleTimer !== undefined) clearTimeout(this.#idleTimer)
    if (this.#caretTimer !== undefined) clearTimeout(this.#caretTimer)
    this.#idleTimer = undefined
    this.#caretTimer = undefined
    this.#listeners?.abort()
    this.#listeners = undefined
    this.#root?.remove()
    void this.#sounds?.close().catch(() => {})
    this.#sounds = undefined
    this.#root = undefined
    this.#cursor = undefined
    this.#label = undefined
    this.#box = undefined
    this.#hoverTarget = undefined
    this.#point = undefined
  }

  /**
   * Show the pointer at a point, gliding from wherever it last was.
   * @param point - target in viewport coordinates.
   * @param options - `mode` switches the pointer shape; `label` names the action.
   */
  moveTo(point: Point, options: { mode?: CursorMode; label?: string } = {}): void {
    if (this.#root === undefined) return
    if (options.mode !== undefined) this.#setMode(options.mode)
    this.#glideTo(point)
    this.#setLabel(options.label)
    this.#armIdleTimer()
  }

  /**
   * Highlight a page element without moving the pointer onto it.
   *
   * Accepts either the element itself or a plain rectangle. Prefer the element:
   * a rectangle is a snapshot of where the element was, so a scroll or reflow
   * leaves the box behind, floating over whatever moved into those coordinates.
   * An element reference lets the box re-measure on scroll and resize.
   *
   * Passing `undefined` clears the highlight.
   * @param target - the element to track, or its current viewport rectangle.
   * @param options - `kind` picks the box treatment for the action in flight.
   */
  hover(target: Element | Rect | undefined, options: { kind?: 'hover' | 'region' | 'text' } = {}): void {
    if (this.#box === undefined) return
    if (target === undefined) {
      this.#hoverTarget = undefined
      this.#box.style.display = 'none'
      delete this.#box.dataset.rect
      return
    }
    this.#box.dataset.kind = options.kind ?? 'hover'
    if (target instanceof Element) {
      this.#hoverTarget = target
      delete this.#box.dataset.rect
    } else {
      this.#hoverTarget = undefined
      this.#box.dataset.rect = JSON.stringify(target)
    }
    this.#redrawBox()
  }

  /**
   * Draw one click at a point: the pointer arrives, a ring expands, and the
   * pointer dwells briefly so the action is readable rather than instantaneous.
   * @param point - where the click landed, in viewport coordinates.
   * @param options - `mode` and `label` as in {@link moveTo}.
   */
  click(point: Point, options: { mode?: CursorMode; label?: string } = {}): void {
    if (this.#root === undefined) return
    this.moveTo(point, { mode: options.mode ?? 'comment', ...options.label === undefined ? {} : { label: options.label } })
    // The ring goes on the arrow's tip, which is the box origin. Anchoring it to
    // the arrow's visual centre instead would draw a ring beside the point the
    // arrow is pointing at, which reads as two different targets.
    this.#spawnAt(point, cls('ripple'), RIPPLE_MS)
    this.#spawnAt(point, cls('flash'), 380)
    this.#playClick()
  }

  /**
   * Show a blinking caret at a point, for a typing action.
   * @param point - the caret's position in viewport coordinates.
   * @param options - `label` names the action.
   */
  type(point: Point, options: { label?: string } = {}): void {
    if (this.#root === undefined) return
    this.moveTo(point, { mode: 'comment', ...options.label === undefined ? {} : { label: options.label } })
    const caret = this.#spawnAt(point, cls('caret'), CARET_MS)
    if (this.#caretTimer !== undefined) clearTimeout(this.#caretTimer)
    this.#caretTimer = setTimeout(() => { caret.remove() }, CARET_MS)
  }

  /**
   * Show a directional scroll nudge at a point.
   * @param point - the point the wheel event targeted, in viewport coordinates.
   * @param options - `deltaY` decides the chevron's direction and distance.
   */
  scroll(point: Point, options: { deltaY?: number; label?: string } = {}): void {
    if (this.#root === undefined) return
    this.moveTo(point, { mode: 'comment', ...options.label === undefined ? {} : { label: options.label } })
    const shift = Math.sign(options.deltaY ?? 1) * 18
    const node = this.#spawnAt(point, cls('scroll'), 520)
    node.style.setProperty(`--${CLASS_PREFIX}-scroll-shift`, `${shift}px`)
  }

  /**
   * Enable or disable the idle wobble.
   *
   * Off is the state a screenshot or a coordinate measurement needs, because the
   * wobble moves the tip by a few degrees and would otherwise make the same
   * question return different answers on consecutive frames.
   */
  setThinkEnabled(enabled: boolean): void {
    this.#motion?.setThinkEnabled(enabled)
  }

  /** Hide the pointer without detaching the overlay. */
  hide(): void {
    if (this.#cursor !== undefined) this.#cursor.dataset.visible = 'false'
    if (this.#root !== undefined) this.#root.dataset.visible = 'false'
    this.#setLabel(undefined)
  }

  /**
   * Record which moment of an action the pointer is showing.
   *
   * One sprite serves every mode, so there is no glyph to swap; the mode only
   * drives the label's wording. It is still stored so a host can read it back.
   */
  #setMode(mode: CursorMode): void {
    if (this.#cursor === undefined || this.#cursor.dataset.mode === mode) return
    this.#cursor.dataset.mode = mode
  }

  /**
   * Travel to a point under spring motion, arcing when the move is long.
   *
   * The move is not a tween, so a second call mid-flight redirects the springs
   * that are already running rather than restarting from rest. That is what makes
   * a rapid sequence of actions read as one continuous pointer instead of a
   * series of jumps.
   */
  #glideTo(point: Point): void {
    const cursor = this.#cursor
    const root = this.#root
    const motion = this.#motion
    if (cursor === undefined || root === undefined || motion === undefined) return
    const first = this.#point === undefined
    this.#point = { ...point }
    cursor.dataset.visible = 'true'
    root.dataset.visible = 'true'

    if (first) motion.jumpTo(point.x, point.y)
    motion.setVisible(true)
    motion.travelTo(point.x, point.y)
    this.#startFrameLoop()
  }

  /**
   * Drive the motion model and write its result to the DOM.
   *
   * One frame loop for position, rotation, and every secondary spring, rather
   * than one animation per property: the springs share a clock, so the composed
   * transform is always internally consistent.
   */
  #startFrameLoop(): void {
    if (this.#frame !== undefined) return
    this.#lastFrameAt = performance.now()
    const tick = (now: number): void => {
      const motion = this.#motion
      const cursor = this.#cursor
      if (motion === undefined || cursor === undefined) {
        this.#frame = undefined
        return
      }
      const seconds = Math.max(0, (now - this.#lastFrameAt) / 1000)
      this.#lastFrameAt = now
      const moving = motion.step(seconds)
      const visibility = visibilityStyles(motion.visibility.value)
      cursor.style.transform = cursorTransform({
        point: motion.point,
        rotation: motion.displayRotation(now),
        scootAxisRotation: motion.scootAxis.value,
        scootRotation: motion.scootRotation.value,
        scootStretch: motion.scootStretch.value,
        stretch: motion.stretch.value,
        boxSize: CURSOR_BOX,
      })
      cursor.style.opacity = `${visibility.opacity}`
      if (moving || motion.visibility.value !== motion.visibility.target) {
        this.#frame = requestAnimationFrame(tick)
      } else {
        this.#frame = undefined
      }
    }
    this.#frame = requestAnimationFrame(tick)
  }

  #setLabel(text: string | undefined): void {
    const label = this.#label
    const point = this.#point
    if (label === undefined || point === undefined) return
    if (text === undefined || text === '') {
      label.dataset.visible = 'false'
      return
    }
    label.textContent = text
    label.dataset.visible = 'true'
    // Place the chip just below-right of the pointer, flipping near an edge so it
    // never lands off-screen.
    const width = label.offsetWidth || 0
    const height = label.offsetHeight || 0
    const x = point.x + 18 + width > innerWidth ? Math.max(4, point.x - 18 - width) : point.x + 18
    const y = point.y + 14 + height > innerHeight ? Math.max(4, point.y - 14 - height) : point.y + 14
    label.style.transform = `translate(${x}px, ${y}px)`
  }

  #redrawBox(): void {
    const box = this.#box
    if (box === undefined) return
    // A tracked element is re-measured on every scroll and resize, so the box
    // stays on its target. A caller-supplied rectangle cannot be re-measured and
    // is therefore only correct until the page moves under it.
    let rect: Rect
    if (this.#hoverTarget !== undefined) {
      if (!this.#hoverTarget.isConnected) {
        // The element left the document (a re-render replaced it); dropping the
        // highlight is honest, whereas keeping the last rectangle would leave a
        // box pointing at nothing.
        this.#hoverTarget = undefined
        box.style.display = 'none'
        delete box.dataset.rect
        return
      }
      const measured = this.#hoverTarget.getBoundingClientRect()
      rect = { x: measured.x, y: measured.y, width: measured.width, height: measured.height }
    } else {
      const raw = box.dataset.rect
      if (raw === undefined) return
      rect = JSON.parse(raw) as Rect
    }
    box.style.display = 'block'
    box.style.transform = `translate(${rect.x}px, ${rect.y}px)`
    box.style.width = `${rect.width}px`
    box.style.height = `${rect.height}px`
  }

  /** Create one transient visual element at a point; removes itself on animation end. */
  #spawnAt(point: Point, className: string, ttlMs: number): HTMLElement {
    const node = document.createElement('div')
    node.className = className
    node.style.left = `${point.x}px`
    node.style.top = `${point.y}px`
    this.#root?.append(node)
    setTimeout(() => { node.remove() }, ttlMs)
    return node
  }

  #armIdleTimer(): void {
    if (this.#idleTimer !== undefined) clearTimeout(this.#idleTimer)
    if (this.#options.idleHideMs <= 0) return
    this.#idleTimer = setTimeout(() => { this.hide() }, this.#options.idleHideMs)
  }

  /**
   * A click sound synthesized in-process.
   *
   * Synthesized rather than shipped as an asset: a few hundred bytes of code beat
   * a binary in the bundle, and the timbre is not the point — a short, quiet tick
   * is enough to signal that an action landed.
   */
  #playClick(): void {
    if (!this.#options.sound) return
    try {
      this.#sounds ??= new AudioContext()
      const ctx = this.#sounds
      const at = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(1180, at)
      osc.frequency.exponentialRampToValueAtTime(560, at + 0.045)
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.06, at + 0.006)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + 0.08)
    } catch {
      // Audio is a nicety; a blocked AudioContext must not break an action.
    }
  }
}

/** Accent color, re-exported so a host can theme its own chrome to match. */
export { ACCENT }
