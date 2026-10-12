/** Spring-driven browser pointer paths, rotation, stretch, and finite idle motion. @module */

import { BASE_ROTATION_DEG } from './styles.ts'
import { CURSOR_SPRINGS, createSpring, isAtRest, jumpSpring, stepSpring } from './springs.ts'

/** At or above this distance a move arcs instead of scooting, in CSS pixels. */
export const LONG_MOVE_PX = 196

/** Largest lean toward a curve's tangent, in degrees. */
export const MAX_LEAN_DEG = 70

/** Speed in px/s at which the cursor stops stretching along its travel. */
export const STRETCH_SPEED_PX_PER_SECOND = 5500

/** Minimum lengthwise stretch, applied at top speed. */
export const MIN_STRETCH = 0.65

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

/**
 * Scale the pointer starts from as it appears, 1 being full size. The pointer
 * grows into place as activity resumes and shrinks back as it fades, which is
 * what the reference's `lerp(0.4, 1, visibility)` does.
 */
export const APPEAR_SCALE = 0.4

/** Snap a value into [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Wrap an angle difference into (-180, 180].
 *
 * Needed because a rotation spring must take the short way around: asking it to
 * go from 170deg to -170deg should move 20deg, not 340deg.
 * @param from - the starting angle in degrees.
 * @param to - the target angle in degrees.
 * @returns the wrapped difference from `from` to `to`, in degrees.
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
 * @param degrees - the angle to normalize, in degrees.
 * @returns the equivalent angle in [0, 360).
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

/** One cubic segment of a cursor journey. */
interface PathSegment {
  control1: PathPoint
  control2: PathPoint
  end: PathPoint
}

/** A bounded cubic journey, optionally passing through an intermediate arc. */
export interface TravelPath {
  start: PathPoint
  end: PathPoint
  segments: PathSegment[]
  arc: boolean
}

/** Size of the region in which cursor paths are selected. */
export interface MotionBounds {
  width: number
  height: number
}

function distance(a: PathPoint, b: PathPoint): number { return Math.hypot(b.x - a.x, b.y - a.y) }
function point(x: number, y: number): PathPoint { return { x, y, tangent: 0 } }
function unit(x: number, y: number): PathPoint {
  const length = Math.hypot(x, y)
  return length < 0.001 ? point(1, 0) : point(x / length, y / length)
}
function handle(bounds: MotionBounds, origin: PathPoint, direction: PathPoint, length: number): PathPoint {
  let span = length
  if (direction.x < 0) span = Math.min(span, origin.x / -direction.x)
  if (direction.x > 0) span = Math.min(span, (bounds.width - origin.x) / direction.x)
  if (direction.y < 0) span = Math.min(span, origin.y / -direction.y)
  if (direction.y > 0) span = Math.min(span, (bounds.height - origin.y) / direction.y)
  return point(origin.x + direction.x * Math.max(0, span), origin.y + direction.y * Math.max(0, span))
}
function cubic(start: PathPoint, segment: PathSegment, t: number): PathPoint {
  const u = 1 - t
  return point(
    start.x * u ** 3 + 3 * segment.control1.x * u ** 2 * t + 3 * segment.control2.x * u * t ** 2 + segment.end.x * t ** 3,
    start.y * u ** 3 + 3 * segment.control1.y * u ** 2 * t + 3 * segment.control2.y * u * t ** 2 + segment.end.y * t ** 3,
  )
}
function metrics(path: TravelPath, bounds?: MotionBounds) {
  let length = 0, energy = 0, maxTurn = 0, totalTurn = 0
  let angle: number | undefined
  let previous = path.start
  const inside = (p: PathPoint): boolean => bounds === undefined ||
    (p.x >= 20 && p.x <= bounds.width - 20 && p.y >= 20 && p.y <= bounds.height - 20)
  let staysInBounds = inside(previous)
  let start = path.start
  for (const segment of path.segments) {
    for (let sample = 1; sample <= 24; sample++) {
      const at = cubic(start, segment, sample / 24)
      length += distance(previous, at)
      staysInBounds &&= inside(at)
      if (distance(previous, at) > 0.01) {
        const next = Math.atan2(at.y - previous.y, at.x - previous.x)
        if (angle !== undefined) {
          const turn = shortestAngleDelta(angle * 180 / Math.PI, next * 180 / Math.PI) * Math.PI / 180
          energy += turn * turn
          maxTurn = Math.max(maxTurn, Math.abs(turn))
          totalTurn += Math.abs(turn)
        }
        angle = next
      }
      previous = at
    }
    start = segment.end
  }
  return { length, energy, maxTurn, totalTurn, staysInBounds }
}
function reversePenalty(path: TravelPath): number {
  const direction = unit(path.end.x - path.start.x, path.end.y - path.start.y)
  const angle = -44 * Math.PI / 180
  return clamp((-(direction.x * Math.sin(angle) - direction.y * Math.cos(angle)) - 0.08) / 0.92, 0, 1)
}

/**
 * Select the reference's smoothest bounded cubic or two-segment arc.
 * @param start - initial cursor position.
 * @param end - destination.
 * @param bounds - drawing region; omitted for standalone callers with no measured viewport.
 * @returns the lowest-scoring in-bounds path, or the lowest-scoring candidate if none fits.
 */
export function createArcPath(start: PathPoint, end: PathPoint, bounds: MotionBounds = { width: Infinity, height: Infinity }): TravelPath {
  const span = distance(start, end)
  const angle = -44 * Math.PI / 180
  const click = point(Math.sin(angle), -Math.cos(angle))
  const reverse = point(-click.x, -click.y)
  const direction = unit(end.x - start.x, end.y - start.y)
  const startLength = Math.max(48, Math.min(640, span * 0.41960295031576633, span * 0.9))
  const endLength = Math.max(48, Math.min(640, span * 0.15, span * 0.9))
  const first = handle(bounds, start, click, startLength)
  const last = handle(bounds, end, reverse, endLength)
  const candidates: TravelPath[] = [
    { start, end, arc: false, segments: [{ control1: first, control2: last, end }] },
    { start, end, arc: false, segments: [{ control1: handle(bounds, start, click, startLength * 0.65), control2: handle(bounds, end, reverse, endLength * 0.65), end }] },
  ]
  const normal = point(-direction.y, direction.x)
  const sign = normal.x * click.x + normal.y * click.y >= 0 ? 1 : -1
  for (const arcScale of [0.55, 0.8, 1.05]) {
    for (const handleScale of [0.65, 1, 1.35]) {
      for (const side of [sign, -sign]) {
        const offset = Math.max(50, Math.min(520, span * 0.2765523188064277)) * arcScale
        const flow = Math.max(38, Math.min(440, span * 0.5783555327868779)) * handleScale
        const arc = point((start.x + end.x) / 2 + normal.x * side * offset + click.x * startLength * 0.16,
          (start.y + end.y) / 2 + normal.y * side * offset + click.y * startLength * 0.16)
        candidates.push({ start, end, arc: true, segments: [
          { control1: first, control2: point(arc.x - direction.x * flow, arc.y - direction.y * flow), end: arc },
          { control1: point(arc.x + direction.x * flow, arc.y + direction.y * flow), control2: last, end },
        ] })
      }
    }
  }
  let best = candidates[0]!, bestInside: TravelPath | undefined
  let score = Infinity, insideScore = Infinity
  for (const candidate of candidates.slice(0, 20)) {
    const m = metrics(candidate, bounds)
    const detour = Math.max(0, m.length / Math.max(1, span) - 1)
    const value = m.length + detour * 320 + m.energy * 140 + m.maxTurn * 180 + m.totalTurn * 18 + reversePenalty(candidate) * 90 + (candidate.arc ? 45 : 0)
    if (value < score) { best = candidate; score = value }
    if (m.staysInBounds && value < insideScore) { bestInside = candidate; insideScore = value }
  }
  return bestInside ?? best
}

/**
 * Sample a cubic journey and its tangent as a screen rotation.
 * @param path - selected journey.
 * @param t - progress in [0, 1].
 * @returns sampled position and rotation in degrees, where zero points upwards.
 */
export function samplePath(path: TravelPath, t: number): PathPoint {
  const progress = clamp(t, 0, 1)
  const index = progress === 1 ? path.segments.length - 1 : Math.floor(progress * path.segments.length)
  const segment = path.segments[index]!
  const start = index === 0 ? path.start : path.segments[index - 1]!.end
  const local = progress === 1 ? 1 : progress * path.segments.length - index
  const u = 1 - local
  const at = cubic(start, segment, local)
  const dx = 3 * u * u * (segment.control1.x - start.x) + 6 * u * local * (segment.control2.x - segment.control1.x) + 3 * local * local * (segment.end.x - segment.control2.x)
  const dy = 3 * u * u * (segment.control1.y - start.y) + 6 * u * local * (segment.control2.y - segment.control1.y) + 3 * local * local * (segment.end.y - segment.control2.y)
  return { ...at, tangent: Math.hypot(dx, dy) < 0.001 ? -44 : Math.atan2(dy, dx) * 180 / Math.PI + 90 }
}
function pathResponse(path: TravelPath): number {
  const m = metrics(path)
  const detour = Math.max(0, m.length / Math.max(1, distance(path.start, path.end)) - 1)
  const complexity = clamp(clamp(detour / 0.55, 0, 1) * 0.42 + clamp(m.totalTurn / (Math.PI * 1.4), 0, 1) * 0.38 + clamp(m.energy / 1.25, 0, 1) * 0.2, 0, 1)
  return clamp((0.42 + clamp((m.length - 180) / 760, 0, 1) * 0.22 + complexity * 0.12 + reversePenalty(path) * 0.28 + (path.arc ? 0.04 : 0)) * 0.7 * (path.arc ? 0.9 : 1), 0.12, 2.2)
}

/**
 * One cursor spring set: where it is, how it is turned, and how it is moving.
 *
 * All of it is state rather than a timeline, so an interruption is just a new
 * target for the springs that are already running.
 */
export class CursorMotion {
  /** X position in viewport coordinates, in CSS pixels. */
  readonly positionX = createSpring(0, CURSOR_SPRINGS.position)
  /** Y position in viewport coordinates, in CSS pixels. */
  readonly positionY = createSpring(0, CURSOR_SPRINGS.position)
  /** Sprite rotation in degrees; it rests at {@link BASE_ROTATION_DEG} and banks toward a curve's tangent on a long move. */
  readonly rotation = createSpring(BASE_ROTATION_DEG, CURSOR_SPRINGS.rotation)
  /** Scale a glide applies: 1 when the cursor is stopped, down to {@link MIN_STRETCH} at top speed. */
  readonly stretch = createSpring(1, CURSOR_SPRINGS.stretch)
  /** Drives opacity and blur: 0 hidden, 1 fully shown. */
  readonly visibility = createSpring(0, CURSOR_SPRINGS.visibility)
  /** Angle of the axis a short move travels along, in degrees. */
  readonly scootAxis = createSpring(0, CURSOR_SPRINGS.scootAxis)
  /** Overshoot rotation a short move adds to {@link rotation}, in degrees. */
  readonly scootRotation = createSpring(0, CURSOR_SPRINGS.scootRotation)
  /** Scale a short move applies perpendicular to its axis, dipping below 1 at mid-move. */
  readonly scootStretch = createSpring(1, CURSOR_SPRINGS.scootStretch)
  /** Position along the current arc, spring-driven from 0 at its start to 1 at its end. */
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

  /** Whether the cursor is still on its way to the last target it was sent to. */
  get isTravelling(): boolean {
    return this.#path !== undefined || this.#scootFrom !== undefined
      || !isAtRest(this.positionX) || !isAtRest(this.positionY)
  }

  /** Whether the idle wobble is running now. */
  get isThinking(): boolean {
    return this.#thinkEnabled && this.#thinkStartedAt !== undefined
  }

  /**
   * Start the idle wobble again, for a pointer its host wants visibly alive.
   *
   * The wobble is otherwise a fixed moment of life after arriving; a host that
   * holds the pointer while the agent works can keep it breathing, so a long
   * action shows a pointer that is present rather than one that froze.
   */
  keepThinking(): void {
    if (this.#thinkEnabled && this.#thinkStartedAt === undefined) this.#thinkStartedAt = performance.now()
  }

  /** Whether anything is still moving; used to stop the animation frame loop. */
  get isResting(): boolean {
    if (this.#path !== undefined) return false
    if (this.#thinkEnabled && this.#thinkStartedAt !== undefined) return false
    return isAtRest(this.positionX) && isAtRest(this.positionY) && isAtRest(this.rotation)
      && isAtRest(this.stretch) && isAtRest(this.visibility) && isAtRest(this.scootStretch)
  }

  /**
   * Place the cursor without animating, as the reference does on a jump.
   *
   * Any move in flight is dropped.
   * @param x - target x coordinate in CSS pixels.
   * @param y - target y coordinate in CSS pixels.
   */
  jumpTo(x: number, y: number): void {
    jumpSpring(this.positionX, x)
    jumpSpring(this.positionY, y)
    this.#path = undefined
    this.#scootFrom = undefined
    this.#scootTo = undefined
    jumpSpring(this.rotation, BASE_ROTATION_DEG)
    jumpSpring(this.scootAxis, 0)
    jumpSpring(this.scootRotation, 0)
    jumpSpring(this.scootStretch, 1)
    jumpSpring(this.stretch, 1)
  }

  /**
   * Set the visibility target; the caller hides the cursor by animating to 0.
   * @param visible - whether the cursor should end up shown; showing also arms the idle wobble.
   */
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
   * @param enabled - whether the wobble runs; disabling also discards a wobble in progress.
   */
  setThinkEnabled(enabled: boolean): void {
    this.#thinkEnabled = enabled
    if (!enabled) this.#thinkStartedAt = undefined
  }

  /**
   * Aim the cursor at a point, choosing an arc or a scoot by distance.
   *
   * The move itself is driven by {@link step}.
   * @param x - target x coordinate in CSS pixels.
   * @param y - target y coordinate in CSS pixels.
   * @param bounds - measured drawing region for path selection.
   * @returns the move's expected duration in milliseconds, so a caller can decide whether to wait; 0 when already there.
   */
  travelTo(x: number, y: number, bounds?: MotionBounds): number {
    this.#thinkStartedAt = undefined
    const destination = this.#path?.end ?? this.#scootTo
    if (destination?.x === x && destination.y === y) return this.#path === undefined ? 420 : 700
    const from: PathPoint = { x: this.positionX.value, y: this.positionY.value, tangent: 0 }
    const distance = Math.hypot(x - from.x, y - from.y)
    if (distance < ARRIVAL_EPSILON_PX) {
      this.positionX.target = x
      this.positionY.target = y
      return 0
    }
    if (distance >= LONG_MOVE_PX) {
      this.#path = createArcPath(from, { x, y, tangent: 0 }, bounds)
      const response = pathResponse(this.#path)
      this.progress.config = { response, dampingFraction: 0.9 }
      jumpSpring(this.progress, 0)
      this.progress.target = 1
      this.positionX.config = this.positionY.config = { response: clamp(response * 0.18, 0.035, 0.12), dampingFraction: 0.9 }
      this.scootAxis.target = 0
      this.scootRotation.target = 0
      this.scootStretch.target = 1
    } else {
      this.#path = undefined
      this.positionX.config = this.positionY.config = CURSOR_SPRINGS.position
      this.progress.config = { response: 0.19, dampingFraction: 0.94 }
      jumpSpring(this.progress, 0)
      this.progress.target = 1
      this.#scootFrom = from
      this.#scootTo = { x, y, tangent: 0 }
      /* v8 ignore next -- unreachable: the ARRIVAL_EPSILON_PX early return above already holds distance >= 0.5. */
      const axis = distance < 0.001 ? 0 : Math.atan2(y - from.y, x - from.x) * 180 / Math.PI
      this.#scootAxisTarget = axis
      // Small overshoot whose direction depends on which way the move leans.
      this.#scootRotationTarget = clamp(((x - from.x) * 0.75 - (y - from.y) * 0.62) / Math.hypot(x - from.x, y - from.y), -1, 1) * MAX_LEAN_DEG
      this.scootAxis.target = this.#scootAxisTarget
      this.scootRotation.target = this.#scootRotationTarget
      this.positionX.target = x
      this.positionY.target = y
    }
    return distance >= LONG_MOVE_PX ? 700 : 420
  }

  /**
   * Advance every spring by `seconds`.
   * @param seconds - elapsed time since the previous step, in seconds.
   * @returns true while the cursor still needs another frame.
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
    this.rotation.target = this.rotation.value + shortestAngleDelta(this.rotation.value, at.tangent)
    this.scootAxis.target = 0
    this.scootRotation.target = 0
    this.scootStretch.target = 1
    const previous = this.point
    stepSpring(this.positionX, seconds)
    stepSpring(this.positionY, seconds)
    stepSpring(this.rotation, seconds)
    const speed = Math.hypot(this.positionX.value - previous.x, this.positionY.value - previous.y) / Math.max(seconds, 1 / 240)
    this.stretch.target = clamp(1 - speed / STRETCH_SPEED_PX_PER_SECOND, MIN_STRETCH, 1)
    stepSpring(this.stretch, seconds)
    if (t >= 0.999 && Math.abs(this.progress.velocity) < 0.01 && this.#near(at)) {
      const end = samplePath(path, 1)
      this.jumpTo(end.x, end.y)
      jumpSpring(this.rotation, end.tangent)
      this.#path = undefined
      this.#thinkStartedAt = performance.now()
    }
  }

  #stepScoot(seconds: number): void {
    const from = this.#scootFrom
    const to = this.#scootTo
    /* v8 ignore next -- narrowing only: the sole call site tests #scootFrom, and the pair is written and cleared together. */
    if (from === undefined || to === undefined) return
    stepSpring(this.progress, seconds)
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
    this.scootStretch.target = 1 - 0.15 * bell
    if (travelled >= 0.999 && Math.abs(this.progress.velocity) < 0.01 && this.#near(to)) {
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

  #near(target: PathPoint): boolean {
    return Math.hypot(this.positionX.value - target.x, this.positionY.value - target.y) <= 0.85
      && Math.abs(this.positionX.velocity) <= 12 && Math.abs(this.positionY.velocity) <= 12
  }

  /**
   * The rotation to draw, including the idle wobble.
   *
   * The wobble is a decaying oscillation added on top of the settled rotation, so
   * it never changes where the cursor points for more than a moment.
   * @param now - current time in milliseconds.
   * @returns the rotation to draw in degrees, with the wobble folded in.
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
 * @returns the offset in degrees, to be added to the settled rotation.
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
 * @param motion - the motion model to read.
 * @param now - current time in milliseconds.
 * @returns the model's current rotation in degrees, including any idle wobble.
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
 * @param input - the point to place, the rotations to compose, and the
 *   appearance scale the visibility spring drives.
 * @returns the transform value, with every angle and offset rounded to three decimals.
 */
export function cursorTransform(input: {
  point: { x: number; y: number }
  rotation: number
  scootAxisRotation: number
  scootRotation: number
  scootStretch: number
  stretch: number
  appearance: number
  boxSize: number
}): string {
  const half = input.boxSize / 2
  const parts = [`translate3d(${round(input.point.x - half)}px, ${round(input.point.y - half)}px, 0)`]
  const total = normalizeDegrees(input.rotation + input.scootRotation)
  const scoot = clamp(input.scootStretch, 0, 1)
  if (Math.abs(shortestAngleDelta(0, input.scootAxisRotation)) > 0.001 || Math.abs(scoot - 1) > 0.001) {
    parts.push(`rotate(${round(input.scootAxisRotation)}deg)`, `scale(1, ${round(scoot)})`, `rotate(${round(-input.scootAxisRotation)}deg)`)
  }
  parts.push(`rotate(${round(total)}deg)`, `scale(${round(input.stretch * input.appearance)}, ${round(input.appearance)})`)
  return parts.join(' ')
}

/** Round to three decimals, matching the reference's emitted precision. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Blur, opacity, and scale driven by the visibility spring: the pointer zooms
 * in as it appears and shrinks as it fades, so resuming activity reads as the
 * pointer growing back into place instead of a sprite blinking on.
 * @param visibility - the spring's value, from 0 hidden to 1 shown.
 * @returns the opacity, the blur radius in CSS pixels, and the scale to apply;
 *   all three settle at full size and zero blur once the pointer is shown.
 */
export function visibilityStyles(visibility: number): { opacity: number; blurPx: number; scale: number } {
  const clamped = clamp(visibility, 0, 1)
  return {
    opacity: clamped,
    blurPx: (1 - clamped) * 5,
    scale: APPEAR_SCALE + (1 - APPEAR_SCALE) * clamped,
  }
}
