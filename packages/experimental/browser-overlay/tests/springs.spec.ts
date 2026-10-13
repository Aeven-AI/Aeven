import { describe, expect, it } from 'vitest'
import {
  createSpring,
  isAtRest,
  jumpSpring,
  retargetSpring,
  stepSpring,
  CURSOR_SPRINGS,
  STEP_SECONDS,
} from '../src/springs.ts'

const FRAME = 1 / 60

describe('createSpring', () => {
  it('starts at rest on its value so nothing animates on first paint', () => {
    const spring = createSpring(7, CURSOR_SPRINGS.position)
    expect(spring).toMatchObject({
      value: 7,
      target: 7,
      velocity: 0,
      force: 0,
      simulationTime: 0,
      scriptTime: 0,
      config: CURSOR_SPRINGS.position,
    })
    expect(isAtRest(spring)).toBe(true)
  })
})

describe('retargetSpring', () => {
  it('aims a moving spring at a new target without dropping its speed', () => {
    // Preserving velocity is what makes a redirected cursor read as continuous
    // rather than as a fresh spring starting from rest.
    const spring = createSpring(0, CURSOR_SPRINGS.position)
    spring.target = 1
    for (let i = 0; i < 10; i += 1) stepSpring(spring, FRAME)
    const speed = spring.velocity
    expect(Math.abs(speed)).toBeGreaterThan(0)

    retargetSpring(spring, 5)

    expect(spring.target).toBe(5)
    expect(spring.velocity).toBe(speed)
    expect(spring.value).toBeLessThan(1)

    for (let i = 0; i < 30; i += 1) stepSpring(spring, FRAME)
    expect(spring.value).toBeGreaterThan(1)
  })
})

describe('jumpSpring', () => {
  it('moves a spring without animating and resets every clock', () => {
    const spring = createSpring(0, CURSOR_SPRINGS.position)
    spring.target = 1
    for (let i = 0; i < 30; i += 1) stepSpring(spring, FRAME)
    expect(spring.simulationTime).toBeGreaterThan(0)

    jumpSpring(spring, 42)

    expect(spring).toMatchObject({ value: 42, target: 42, velocity: 0, force: 0, simulationTime: 0, scriptTime: 0 })
    // A jump leaves nothing in flight: stepping again cannot move it away.
    stepSpring(spring, FRAME)
    expect(spring.value).toBe(42)
    expect(isAtRest(spring)).toBe(true)
  })
})

describe('a stalled simulation clock', () => {
  it('discards the backlog instead of replaying it as one giant step', () => {
    // `simulationTime` is public state, and falling far behind it is exactly what
    // a stall looks like: the guard exists so the solver replays at most one fixed
    // step rather than integrating the whole backlog at once.
    const stalled = createSpring(0, CURSOR_SPRINGS.position)
    stalled.target = 1
    stalled.simulationTime -= 10

    stepSpring(stalled, FRAME)

    expect(stalled.scriptTime - stalled.simulationTime).toBeLessThanOrEqual(STEP_SECONDS)
    // Ten seconds of integration would have converged on the target; one fixed
    // step has barely left the start.
    expect(stalled.value).toBeLessThan(0.01)
    expect(stalled.velocity).toBeGreaterThan(0)
  })
})
