import { describe, expect, it } from 'vitest'
import { createSpring, isAtRest, stepSpring, CURSOR_SPRINGS } from '../src/springs.ts'
import { BASE_ROTATION_DEG } from '../src/styles.ts'
import {
  ARRIVAL_EPSILON_PX,
  createArcPath,
  CursorMotion,
  cursorTransform,
  displayRotationFor,
  LONG_MOVE_PX,
  samplePath,
  shortestAngleDelta,
  normalizeDegrees,
  visibilityStyles,
} from '../src/motion.ts'

/** Advance a motion model by `ms` at 60fps, returning the final frame's values. */
function runMotion(motion: CursorMotion, ms: number): void {
  const frames = Math.round(ms / (1000 / 60))
  for (let i = 0; i < frames; i += 1) motion.step(1 / 60)
}

describe('springs', () => {
  it('arrives sooner for a smaller response', () => {
    // Compared as time-to-95% rather than value-at-an-instant: a spring with more
    // overshoot can be momentarily *above* a snappier one, so sampling a single
    // time would make this assertion depend on where the overshoot happens to be.
    const framesTo95 = (config: { dampingFraction: number; response: number }): number => {
      const spring = createSpring(0, config)
      spring.target = 1
      for (let i = 1; i < 600; i += 1) {
        stepSpring(spring, 1 / 60)
        if (spring.value >= 0.95) return i
      }
      return Number.POSITIVE_INFINITY
    }
    expect(framesTo95(CURSOR_SPRINGS.position)).toBeLessThan(framesTo95(CURSOR_SPRINGS.visibility))
  })

  it('settles to exactly its target and stays there', () => {
    const spring = createSpring(0, CURSOR_SPRINGS.position)
    spring.target = 1
    for (let i = 0; i < 120; i += 1) stepSpring(spring, 1 / 60)
    expect(spring.value).toBe(1)
    expect(spring.velocity).toBe(0)
    expect(isAtRest(spring)).toBe(true)
  })

  it('is stable across a wide range of damping fractions and responses', () => {
    // A spring stiff enough to go unstable at a fixed step is the classic failure
    // here, so every configured spring is run to completion and checked.
    for (const config of Object.values(CURSOR_SPRINGS)) {
      const spring = createSpring(0, config)
      spring.target = 1
      for (let i = 0; i < 240; i += 1) {
        stepSpring(spring, 1 / 60)
        expect(Number.isFinite(spring.value)).toBe(true)
      }
      expect(spring.value).toBeCloseTo(1, 6)
    }
  })

  it('keeps a long frame inside the same trajectory rather than overshooting it', () => {
    // A frame longer than the cap is truncated, so it deliberately advances less
    // than the wall time it was given. What must never happen is diverging: the
    // value has to stay between where it started and the target.
    const coarse = createSpring(0, CURSOR_SPRINGS.position)
    coarse.target = 1
    stepSpring(coarse, 0.1)
    expect(coarse.value).toBeGreaterThan(0)
    expect(coarse.value).toBeLessThanOrEqual(1)
    // A second long frame keeps moving in the same direction.
    const first = coarse.value
    stepSpring(coarse, 0.1)
    expect(coarse.value).toBeGreaterThan(first)
  })

  it('truncates a frame past the stability limit rather than diverging', () => {
    const spring = createSpring(0, CURSOR_SPRINGS.position)
    spring.target = 1
    stepSpring(spring, 5)
    expect(Number.isFinite(spring.value)).toBe(true)
    expect(spring.value).toBeLessThanOrEqual(1.5)
  })

  it('ignores a non-positive step', () => {
    const spring = createSpring(0, CURSOR_SPRINGS.position)
    spring.target = 1
    stepSpring(spring, 0)
    stepSpring(spring, -1)
    expect(spring.value).toBe(0)
  })
})

describe('angle helpers', () => {
  it('takes the short way around the circle', () => {
    expect(shortestAngleDelta(170, -170)).toBe(20)
    expect(shortestAngleDelta(-170, 170)).toBe(-20)
    expect(shortestAngleDelta(0, 90)).toBe(90)
  })

  it('normalizes a rotation into [0, 360)', () => {
    expect(normalizeDegrees(-44)).toBeCloseTo(316)
    expect(normalizeDegrees(0)).toBe(0)
    expect(normalizeDegrees(360)).toBe(0)
    expect(normalizeDegrees(-360)).toBe(0)
  })
})

describe('travel paths', () => {
  it('bows a long move off the straight line', () => {
    const path = createArcPath({ x: 0, y: 0, tangent: 0 }, { x: 400, y: 0, tangent: 0 })
    const mid = samplePath(path, 0.5)
    // The midpoint of a straight line would be (200, 0); an arc must differ.
    expect(Math.abs(mid.y)).toBeGreaterThan(1)
  })

  it('keeps a straight move straight', () => {
    // A degenerate span must not divide by zero when building the perpendicular.
    const path = createArcPath({ x: 10, y: 10, tangent: 0 }, { x: 10, y: 10, tangent: 0 })
    expect(Number.isFinite(path.control.x)).toBe(true)
    expect(Number.isFinite(path.control.y)).toBe(true)
  })

  it('starts and ends exactly on the requested points', () => {
    const path = createArcPath({ x: 5, y: 7, tangent: 0 }, { x: 305, y: 207, tangent: 0 })
    expect(samplePath(path, 0)).toMatchObject({ x: 5, y: 7 })
    const end = samplePath(path, 1)
    expect(end.x).toBeCloseTo(305, 6)
    expect(end.y).toBeCloseTo(207, 6)
  })

  it('reports the tangent as the direction of travel', () => {
    // A straight 45deg move still leaves the tangent short of 45deg at the end,
    // because the arc's control point damps the final approach. The direction is
    // what matters, and the angle must stay on the same side of the travel line.
    const path = createArcPath({ x: 0, y: 0, tangent: 0 }, { x: 400, y: 400, tangent: 0 })
    const tangent = samplePath(path, 1).tangent
    expect(tangent).toBeGreaterThan(0)
    expect(tangent).toBeLessThan(45)
    expect(samplePath(path, 0.5).tangent).toBeCloseTo(45, 6)
  })
})

describe('cursor motion', () => {
  it('rests at the base rotation', () => {
    const motion = new CursorMotion()
    motion.jumpTo(100, 100)
    expect(motion.rotation.value).toBe(BASE_ROTATION_DEG)
    expect(motion.isResting).toBe(true)
  })

  it('arrives on a long move and settles back to the base rotation', () => {
    const motion = new CursorMotion()
    motion.jumpTo(0, 0)
    motion.setVisible(true)
    const distance = LONG_MOVE_PX + 100
    motion.travelTo(distance, 0)
    // Banked through the arc, so rotation must leave the base during the move.
    runMotion(motion, 120)
    const banked = Math.abs(motion.rotation.value - BASE_ROTATION_DEG)
    runMotion(motion, 1600)
    const at = motion.point
    expect(at.x).toBeCloseTo(distance, 0)
    expect(at.y).toBeCloseTo(0, 0)
    expect(motion.rotation.value).toBeCloseTo(BASE_ROTATION_DEG, 3)
    // `isResting` stays false through the post-arrival think window, so arrival is
    // asserted on position and rotation rather than on that flag.
    expect(banked).toBeGreaterThan(0)
  })

  it('arrives on a short move', () => {
    const motion = new CursorMotion()
    motion.jumpTo(0, 0)
    motion.setVisible(true)
    motion.travelTo(60, 30)
    runMotion(motion, 1200)
    expect(motion.point.x).toBeCloseTo(60, 0)
    expect(motion.point.y).toBeCloseTo(30, 0)
    expect(motion.rotation.value).toBeCloseTo(BASE_ROTATION_DEG, 3)
  })

  it('redirects mid-flight instead of restarting from rest', () => {
    // This is the property a CSS transition cannot express, and the reason the
    // motion is spring-driven: velocity carries into the new target.
    const motion = new CursorMotion()
    motion.jumpTo(0, 0)
    motion.setVisible(true)
    motion.travelTo(400, 0)
    runMotion(motion, 100)
    const movingX = motion.positionX.velocity
    expect(Math.abs(movingX)).toBeGreaterThan(1)
    motion.travelTo(0, 400)
    // The velocity must survive the redirect rather than being zeroed.
    expect(motion.positionX.velocity).toBe(movingX)
    runMotion(motion, 1600)
    expect(motion.point.x).toBeCloseTo(0, 0)
    expect(motion.point.y).toBeCloseTo(400, 0)
  })

  it('treats a move within the arrival epsilon as a no-op', () => {
    const motion = new CursorMotion()
    motion.jumpTo(50, 50)
    expect(motion.travelTo(50.1, 50.1)).toBe(0)
  })

  it('fades in and out through the visibility spring', () => {
    const motion = new CursorMotion()
    motion.setVisible(true)
    runMotion(motion, 1200)
    expect(motion.visibility.value).toBe(1)
    motion.setVisible(false)
    runMotion(motion, 1200)
    expect(motion.visibility.value).toBe(0)
  })

  it('stops wobbling after the think window', () => {
    const motion = new CursorMotion()
    motion.jumpTo(10, 10)
    motion.setVisible(true)
    runMotion(motion, 40)
    // Mid-window the displayed rotation wanders from the settled value.
    const displayed = [
      displayRotationFor(motion, performance.now()),
      displayRotationFor(motion, performance.now() + 300),
      displayRotationFor(motion, performance.now() + 600),
    ]
    expect(new Set(displayed.map(value => value.toFixed(3))).size).toBeGreaterThan(1)
    // Past the window it must return to exactly the settled rotation.
    expect(displayRotationFor(motion, performance.now() + 5000)).toBeCloseTo(BASE_ROTATION_DEG, 6)
  })
})

describe('arrival epsilon boundary', () => {
  it('moves for a displacement of exactly the arrival epsilon', () => {
    // The epsilon check runs before the arc/scoot split, so the shortest move
    // that is still a move is exactly ARRIVAL_EPSILON_PX long.
    const motion = new CursorMotion()
    motion.jumpTo(0, 0)
    expect(motion.travelTo(ARRIVAL_EPSILON_PX, 0)).toBe(420)
    runMotion(motion, 2400)
    expect(motion.point.x).toBeCloseTo(ARRIVAL_EPSILON_PX, 3)
  })

  it('treats a displacement just inside the epsilon as an instant jump', () => {
    const motion = new CursorMotion()
    motion.jumpTo(0, 0)
    expect(motion.travelTo(ARRIVAL_EPSILON_PX / 2, 0)).toBe(0)
    // The target still moves, so the next frame's spring carries the cursor the
    // sub-epsilon distance without a travel path.
    expect(motion.positionX.target).toBe(ARRIVAL_EPSILON_PX / 2)
    expect(motion.isResting).toBe(false)
  })

  it('reports a wait budget for each travel regime', () => {
    // The budget is the caller's only signal for how long to wait, so each
    // regime is pinned at its own boundary: at or below the arrival epsilon the
    // move is instant, the scoot regime runs from that epsilon up to
    // LONG_MOVE_PX, and the arc regime from LONG_MOVE_PX on. Every scooter the
    // model builds therefore spans at least ARRIVAL_EPSILON_PX.
    const budget = (x: number): number => {
      const motion = new CursorMotion()
      motion.jumpTo(0, 0)
      return motion.travelTo(x, 0)
    }
    expect(budget(ARRIVAL_EPSILON_PX / 2)).toBe(0)
    expect(budget(ARRIVAL_EPSILON_PX)).toBe(420)
    expect(budget(LONG_MOVE_PX - 1)).toBe(420)
    expect(budget(LONG_MOVE_PX)).toBe(700)
  })
})

describe('idle wobble control', () => {
  it('draws the settled rotation until the cursor is first shown', () => {
    // Nothing arms the wobble before the first show, so the composed rotation is
    // the spring's own value rather than a value displaced by an offset.
    const motion = new CursorMotion()
    motion.jumpTo(12, 34)
    expect(displayRotationFor(motion, performance.now())).toBe(motion.rotation.value)
  })

  it('ignores a timestamp that predates the wobble', () => {
    // The window is measured from the show, so a `now` before it cannot be
    // inside the window.
    const motion = new CursorMotion()
    motion.setVisible(true)
    const armed = performance.now()
    expect(displayRotationFor(motion, armed - 1000)).toBe(motion.rotation.value)
  })

  it('stops drawing the wobble once it is disabled', () => {
    const motion = new CursorMotion()
    motion.setVisible(true)
    const armed = performance.now()
    // Mid-window the wobble displaces the drawn rotation from the settled value.
    expect(displayRotationFor(motion, armed + 200)).not.toBe(motion.rotation.value)
    motion.setThinkEnabled(false)
    expect(displayRotationFor(motion, armed + 200)).toBe(motion.rotation.value)
  })

  it('re-arms the wobble only on the next show', () => {
    // Disabling clears the window instead of pausing it, and enabling does not
    // reopen one: only a show does, so a re-enable under an already-visible
    // cursor draws nothing.
    const motion = new CursorMotion()
    motion.setVisible(true)
    motion.setThinkEnabled(false)
    motion.setThinkEnabled(true)
    expect(displayRotationFor(motion, performance.now() + 200)).toBe(motion.rotation.value)
    motion.setVisible(true)
    expect(Math.abs(displayRotationFor(motion, performance.now() + 200) - motion.rotation.value)).toBeGreaterThan(1)
  })
})

describe('transform composition', () => {
  const base = {
    point: { x: 100, y: 200 },
    rotation: BASE_ROTATION_DEG,
    scootAxisRotation: 0,
    scootRotation: 0,
    scootStretch: 1,
    stretch: 1,
    boxSize: 24,
  }

  it('centres the box on the point', () => {
    // The box is positioned so that its own origin lands on the point, which is
    // the anchor the tip is calibrated against.
    // Zero rotation is the resting state: the sprite is authored in the
    // orientation it should be seen in, so the model must not impose an angle.
    expect(cursorTransform(base)).toBe('translate3d(88px, 188px, 0) rotate(0deg) scale(1, 1)')
  })

  it('omits the scoot pair when the cursor is not scooting', () => {
    expect(cursorTransform(base)).not.toContain('rotate(0deg) scale(1, 1) rotate(-0deg)')
  })

  it('includes the axis-aligned pair while scooting', () => {
    const value = cursorTransform({ ...base, scootAxisRotation: 30, scootStretch: 0.9 })
    expect(value).toContain('rotate(30deg) scale(1, 0.9) rotate(-30deg)')
  })

  it('clamps scale inputs into a drawable range', () => {
    const value = cursorTransform({ ...base, stretch: 5, scootStretch: -1 })
    expect(value).toContain('scale(5, 1)')
    expect(value).toContain('scale(1, 0)')
  })

  it('emits a soft blur as the cursor fades in', () => {
    expect(visibilityStyles(1)).toEqual({ opacity: 1, blurPx: 0 })
    expect(visibilityStyles(0)).toEqual({ opacity: 0, blurPx: 5 })
  })
})
