/**
 * The cursor's motion model: spring physics, travel paths, and the transforms
 * they produce.
 *
 * This is a faithful port of the Codex desktop app's browser-agent cursor, read
 * out of its extracted bundle. The integrator is React Spring's, reproduced
 * exactly — including the stiffness clamp, the half-step force/velocity exchange,
 * and the rest test — because a re-derived spring with the same nominal
 * "damping and response" does not produce the same motion.
 *
 * Three behaviours matter for the feel, and all three are here:
 *   - **Travel** is spring-driven, so a redirect mid-flight continues from the
 *     current velocity instead of restarting.
 *   - **Long moves arc.** Past `LONG_MOVE_PX` the cursor follows a quadratic
 *     Bézier whose control point is offset perpendicular to the travel line, and
 *     its rotation tracks the curve's tangent.
 *   - **Short moves scoot.** Below that threshold it moves straight with a brief
 *     axis-aligned stretch and a small overshoot rotation.
 *
 * Plus the idle "think" wobble: after arriving, the cursor holds a small damped
 * oscillation for a moment, which is what makes it read as alive rather than
 * parked.
 * @module
 */

import { BASE_ROTATION_DEG } from './styles.ts'
import { CURSOR_SPRINGS, createSpring, isAtRest, stepSpring } from './springs.ts'

/** At or above this distance a move arcs instead of scooting, in CSS pixels. */
export const LONG_MOVE_PX = 196

/** Largest lean toward a curve's tangent, in degrees. */
export const MAX_LEAN_DEG = 70

/** Speed in px/s at which the cursor stops stretching along its travel. */
export const STRETCH_SPEED_PX_PER_SECOND = 5500

/** Minimum lengthwise stretch, applied at top speed. */
export const MIN_STRETCH = 0.65

/** Peak curvature of a long move, as a fraction of the travel distance. */
export const ARC_CURVATURE = 0.18

/** Bounds on the arc's curvature, so a tiny or huge move does not over- or under-bend. */
export const ARC_CURVATURE_MIN = 0.035
export const ARC_CURVATURE_MAX = 0.12

/** Delay before the idle wobble starts, in seconds; the reference is 0. */
export const THINK_DELAY_SECONDS = 0

/** How long the idle wobble lasts, in seconds, after which it stops re-arming. */
export const THINK_DURATION_SECONDS = 1.41

/** Frequency of the idle wobble, in cycles per second. */
export const THINK_FREQUENCY = 0.66

/** Amplitude of the idle wobble, in degrees. */
export const THINK_AMPLITUDE_DEG = 12.5

/** Below this distance a move is treated as already arrived, in CSS pixels. */
export const ARRIVAL_EPSILON_PX = 0.5

/** Snap a value into [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Wrap an angle difference into (-180, 180].
 *
 * Needed because a rotation spring must take the short way around: asking it to
 * go from 170deg to -170deg should move 20deg, not 340deg.
 */
export function shortestAngleDelta(from: number, to: number): number {
  let delta = to - from
  while (delta > 180) delta -= 360
  while (delta < -180) delta += 360
  return delta
}

/**
 * Normalize a rotation for display into [0, 360).
 *
 * The composition carries a negative base rotation, so this is what keeps the
 * emitted `rotate()` values comparable with the reference's.
 */
export function normalizeDegrees(degrees: number): number {
  const wrapped = degrees % 360
  // `+ 0` turns the -0 that a negative multiple of 360 produces back into +0, so
  // the emitted transform never reads "rotate(-0deg)".
  return (wrapped < 0 ? wrapped + 360 : wrapped) + 0
}

/** One point along a travel path. */
export interface PathPoint {
  /** Position on the path, in viewport coordinates. */
  x: number
  y: number
  /** Direction of travel at this point, in degrees. */
  tangent: number
}

/** A travel path the cursor follows, sampled by a spring-driven progress value. */
export interface TravelPath {
  start: PathPoint
  control: PathPoint
  end: PathPoint
}

/** Build the arc for a long move: a quadratic Bézier bowed off the direct line. */
export function createArcPath(start: PathPoint, end: PathPoint): TravelPath {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const distance = Math.hypot(dx, dy)
  // Offset the control point perpendicular to the travel line so the bow is
  // always to one side rather than along the direction of travel.
  const curvature = clamp(distance * ARC_CURVATURE, ARC_CURVATURE_MIN, ARC_CURVATURE_MAX)
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const perpendicular = distance < 0.001 ? { x: 0, y: 0 } : { x: -dy / distance, y: dx / distance }
  return {
    start,
    control: { x: midpoint.x + perpendicular.x * distance * curvature, y: midpoint.y + perpendicular.y * distance * curvature, tangent: 0 },
    end,
  }
}

/** Sample a quadratic Bézier at `t`, including its tangent direction. */
export function samplePath(path: TravelPath, t: number): PathPoint {
  const u = 1 - t
  const x = u * u * path.start.x + 2 * u * t * path.control.x + t * t * path.end.x
  const y = u * u * path.start.y + 2 * u * t * path.control.y + t * t * path.end.y
  // Derivative of the quadratic: direction of travel, not position.
  const dx = 2 * u * (path.control.x - path.start.x) + 2 * t * (path.end.x - path.control.x)
  const dy = 2 * u * (path.control.y - path.start.y) + 2 * t * (path.end.y - path.control.y)
  return { x, y, tangent: Math.atan2(dy, dx) * 180 / Math.PI }
}

/**
 * One cursor spring set: where it is, how it is turned, and how it is moving.
 *
 * All of it is state rather than a timeline, so an interruption is just a new
 * target for the springs that are already running.
 */
export class CursorMotion {
  readonly positionX = createSpring(0, CURSOR_SPRINGS.position)
  readonly positionY = createSpring(0, CURSOR_SPRINGS.position)
  readonly rotation = createSpring(BASE_ROTATION_DEG, CURSOR_SPRINGS.rotation)
  readonly stretch = createSpring(1, CURSOR_SPRINGS.stretch)
  readonly visibility = createSpring(0, CURSOR_SPRINGS.visibility)
  readonly scootAxis = createSpring(0, CURSOR_SPRINGS.scootAxis)
  readonly scootRotation = createSpring(0, CURSOR_SPRINGS.scootRotation)
  readonly scootStretch = createSpring(1, CURSOR_SPRINGS.scootStretch)
  readonly progress = createSpring(0, CURSOR_SPRINGS.rotation)

  #path: TravelPath | undefined
  #scootFrom: PathPoint | undefined
  #scootTo: PathPoint | undefined
  #scootAxisTarget = 0
  #scootRotationTarget = 0
  #thinkStartedAt: number | undefined
  #thinkEnabled = true

  /** Current position, in viewport coordinates. */
  get point(): { x: number; y: number } {
    return { x: this.positionX.value, y: this.positionY.value }
  }

  /** Whether anything is still moving; used to stop the animation frame loop. */
  get isResting(): boolean {
    if (this.#path !== undefined) return false
    if (this.#thinkEnabled && this.#thinkStartedAt !== undefined) return false
    return isAtRest(this.positionX) && isAtRest(this.positionY) && isAtRest(this.rotation)
      && isAtRest(this.stretch) && isAtRest(this.visibility) && isAtRest(this.scootStretch)
  }

  /** Place the cursor without animating, as the reference does on a jump. */
  jumpTo(x: number, y: number): void {
    this.positionX.value = x
    this.positionX.target = x
    this.positionX.velocity = 0
    this.positionY.value = y
    this.positionY.target = y
    this.positionY.velocity = 0
    this.#path = undefined
    this.#scootFrom = undefined
    this.#scootTo = undefined
    this.rotation.target = BASE_ROTATION_DEG
    this.rotation.value = BASE_ROTATION_DEG
    this.rotation.velocity = 0
    this.scootAxis.target = 0
    this.scootAxis.value = 0
    this.scootRotation.target = 0
    this.scootRotation.value = 0
    this.scootStretch.target = 1
    this.scootStretch.value = 1
    this.stretch.target = 1
    this.stretch.value = 1
  }

  /** Set the visibility target; the caller hides the cursor by animating to 0. */
  setVisible(visible: boolean): void {
    this.visibility.target = visible ? 1 : 0
    if (visible) this.#thinkStartedAt = performance.now()
  }

  /**
   * Enable or disable the idle wobble, stopping any wobble in progress.
   *
   * The wobble moves the arrow's tip by up to {@link THINK_AMPLITUDE_DEG} degrees,
   * so anything that needs to measure where the cursor points has to turn it off
   * first: measuring mid-wobble reports a tip position that changes frame to frame,
   * which is a limit cycle rather than a calibration error.
   */
  setThinkEnabled(enabled: boolean): void {
    this.#thinkEnabled = enabled
    if (!enabled) this.#thinkStartedAt = undefined
  }

  /**
   * Aim the cursor at a point, choosing an arc or a scoot by distance.
   *
   * Returns the number of milliseconds the move is expected to take, so a caller
   * can decide whether to wait; the move itself is driven by {@link step}.
   */
  travelTo(x: number, y: number): number {
    const from: PathPoint = { x: this.positionX.value, y: this.positionY.value, tangent: 0 }
    const distance = Math.hypot(x - from.x, y - from.y)
    this.#thinkStartedAt = undefined
    if (distance < ARRIVAL_EPSILON_PX) {
      this.positionX.target = x
      this.positionY.target = y
      return 0
    }
    if (distance >= LONG_MOVE_PX) {
      this.#path = createArcPath(from, { x, y, tangent: 0 })
      this.progress.value = 0
      this.progress.target = 1
      this.progress.velocity = 0
      this.scootAxis.target = 0
      this.scootRotation.target = 0
      this.scootStretch.target = 1
    } else {
      this.#path = undefined
      this.#scootFrom = from
      this.#scootTo = { x, y, tangent: 0 }
      /* v8 ignore next -- unreachable: the ARRIVAL_EPSILON_PX early return above already holds distance >= 0.5. */
      const axis = distance < 0.001 ? 0 : Math.atan2(y - from.y, x - from.x) * 180 / Math.PI
      this.#scootAxisTarget = axis
      // Small overshoot whose direction depends on which way the move leans.
      this.#scootRotationTarget = clamp((x - from.x) * 0.75 + -(y - from.y) * 0.62, -1, 1) * MAX_LEAN_DEG
      this.scootAxis.target = this.#scootAxisTarget
      this.scootRotation.target = this.#scootRotationTarget
      this.positionX.target = x
      this.positionY.target = y
    }
    return distance >= LONG_MOVE_PX ? 700 : 420
  }

  /**
   * Advance every spring by `seconds`.
   *
   * Returns true when the cursor still needs another frame.
   */
  step(seconds: number): boolean {
    stepSpring(this.visibility, seconds)

    if (this.#path !== undefined) this.#stepArc(seconds)
    else if (this.#scootFrom !== undefined) this.#stepScoot(seconds)
    else {
      stepSpring(this.positionX, seconds)
      stepSpring(this.positionY, seconds)
      stepSpring(this.rotation, seconds)
      stepSpring(this.stretch, seconds)
    }

    stepSpring(this.scootAxis, seconds)
    stepSpring(this.scootRotation, seconds)
    stepSpring(this.scootStretch, seconds)
    return !this.isResting
  }

  #stepArc(seconds: number): void {
    const path = this.#path
    /* v8 ignore next -- narrows for the compiler only: the sole call site tests #path !== undefined, and nothing writes it in between. */
    if (path === undefined) return
    stepSpring(this.progress, seconds)
    const t = clamp(this.progress.value, 0, 1)
    const at = samplePath(path, t)
    this.positionX.target = at.x
    this.positionY.target = at.y
    // The curve's tangent is an absolute screen angle, so it is a *bank* only after
    // the resting orientation is subtracted: taking it as the target directly makes
    // a rightward move aim the cursor sideways instead of tipping it forward. The
    // bank is also clamped, because a curve's tangent can point anywhere.
    const bank = clamp(shortestAngleDelta(BASE_ROTATION_DEG, at.tangent), -MAX_LEAN_DEG, MAX_LEAN_DEG)
    this.rotation.target = BASE_ROTATION_DEG + bank
    this.scootAxis.target = 0
    this.scootRotation.target = 0
    this.scootStretch.target = 1
    stepSpring(this.positionX, seconds)
    stepSpring(this.positionY, seconds)
    stepSpring(this.rotation, seconds)
    const speed = Math.hypot(this.positionX.velocity, this.positionY.velocity)
    this.stretch.target = clamp(1 - speed / STRETCH_SPEED_PX_PER_SECOND, MIN_STRETCH, 1)
    stepSpring(this.stretch, seconds)
    if (t >= 0.999 && isAtRest(this.progress)) {
      const end = samplePath(path, 1)
      this.jumpTo(end.x, end.y)
      this.rotation.target = BASE_ROTATION_DEG
      this.rotation.value = BASE_ROTATION_DEG
      this.#path = undefined
      this.#thinkStartedAt = performance.now()
    }
  }

  #stepScoot(seconds: number): void {
    const from = this.#scootFrom
    const to = this.#scootTo
    /* v8 ignore next -- narrowing only: the sole call site tests #scootFrom, and the pair is written and cleared together. */
    if (from === undefined || to === undefined) return
    this.rotation.target = this.rotation.value + shortestAngleDelta(this.rotation.value, BASE_ROTATION_DEG)
    stepSpring(this.positionX, seconds)
    stepSpring(this.positionY, seconds)
    stepSpring(this.rotation, seconds)
    const at = {
      x: this.positionX.value,
      y: this.positionY.value,
    }
    const spanX = to.x - from.x
    const spanY = to.y - from.y
    const lengthSquared = spanX * spanX + spanY * spanY
    /* v8 ignore next 3 -- unreachable: lengthSquared is the square of a move distance the epsilon early return holds to >= 0.5. */
    const travelled = lengthSquared < 0.001
      ? 1
      : clamp(((at.x - from.x) * spanX + (at.y - from.y) * spanY) / lengthSquared, 0, 1)
    const bell = Math.sin(Math.min(1, travelled) * Math.PI)
    // The overshoot rotation peaks mid-move, then unwinds.
    this.scootRotation.target = this.#scootRotationTarget * bell
    this.scootStretch.target = 1 - (1 - MIN_STRETCH) * 0.15 * bell
    if (travelled >= 0.999 && isAtRest(this.positionX) && isAtRest(this.positionY)) {
      this.jumpTo(to.x, to.y)
      this.rotation.target = BASE_ROTATION_DEG
      this.rotation.value = BASE_ROTATION_DEG
      this.scootAxis.target = 0
      this.scootRotation.target = 0
      this.scootStretch.target = 1
      this.#scootFrom = undefined
      this.#scootTo = undefined
      this.#thinkStartedAt = performance.now()
    }
  }

  /**
   * The rotation to draw, including the idle wobble.
   *
   * The wobble is a decaying oscillation added on top of the settled rotation, so
   * it never changes where the cursor points for more than a moment.
   * @param now - current time in milliseconds.
   */
  displayRotation(now: number): number {
    if (!this.#thinkEnabled || this.#thinkStartedAt === undefined) return this.rotation.value
    const elapsed = (now - this.#thinkStartedAt) / 1000 - THINK_DELAY_SECONDS
    if (elapsed < 0) return this.rotation.value
    const progress = Math.min(1, elapsed / THINK_DURATION_SECONDS)
    if (progress >= 1) {
      this.#thinkStartedAt = undefined
      return this.rotation.value
    }
    return this.rotation.value + thinkWobble(elapsed, progress)
  }
}

/**
 * The idle wobble's angular offset at a point inside its window.
 *
 * A sine at {@link THINK_FREQUENCY} under a half-sine envelope, so it starts and
 * ends at zero and never leaves a residue in the settled rotation.
 * @param elapsedSeconds - time since the wobble began.
 * @param progress - fraction of the window already elapsed, in [0, 1].
 */
export function thinkWobble(elapsedSeconds: number, progress: number): number {
  const envelope = Math.sin(progress * Math.PI)
  return Math.sin(elapsedSeconds / THINK_FREQUENCY * Math.PI * 2) * envelope * THINK_AMPLITUDE_DEG
}

/**
 * The rotation a motion model would draw at `now`, without advancing it.
 *
 * Exists so a caller can read the composed angle in a test or a one-off draw
 * without owning the animation loop.
 */
export function displayRotationFor(motion: CursorMotion, now: number): number {
  return motion.displayRotation(now)
}

/**
 * Build the cursor's CSS transform string.
 *
 * The order is the reference's: the box is translated so its own origin lands on
 * the point, then the axis-aligned scoot is applied as rotate/scale/unrotate, and
 * last the sprite's own rotation and lengthwise stretch. The nested rotate pair
 * is what keeps a stretched cursor pointing along its axis rather than shearing.
 */
export function cursorTransform(input: {
  point: { x: number; y: number }
  rotation: number
  scootAxisRotation: number
  scootRotation: number
  scootStretch: number
  stretch: number
  boxSize: number
}): string {
  const half = input.boxSize / 2
  const parts = [`translate3d(${round(input.point.x - half)}px, ${round(input.point.y - half)}px, 0)`]
  const scootStretch = clamp(input.scootStretch, 0, 1)
  if (Math.abs(normalizeDegrees(input.scootAxisRotation)) > 0.001 || Math.abs(scootStretch - 1) > 0.001) {
    parts.push(
      `rotate(${round(input.scootAxisRotation)}deg)`,
      `scale(1, ${round(scootStretch)})`,
      `rotate(${round(-input.scootAxisRotation)}deg)`,
    )
  }
  const total = normalizeDegrees(input.rotation + input.scootRotation)
  parts.push(`rotate(${round(total)}deg)`, `scale(${round(input.stretch)}, ${round(clamp(input.stretch, 0, 1))})`)
  return parts.join(' ')
}

/** Round to three decimals, matching the reference's emitted precision. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** Blur and opacity driven by the visibility spring: appear soft, fade in. */
export function visibilityStyles(visibility: number): { opacity: number; blurPx: number } {
  const clamped = clamp(visibility, 0, 1)
  return { opacity: clamped, blurPx: (1 - clamped) * 5 }
}
