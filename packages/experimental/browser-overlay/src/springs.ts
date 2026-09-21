/**
 * A spring integrator and the cursor's tuning table.
 *
 * The cursor's motion is spring-driven rather than eased, which is what makes it
 * read as a physical object: it overshoots slightly, settles, and can be pushed
 * again mid-flight without restarting from rest. Easing curves cannot do that,
 * because they are functions of time rather than of current velocity.
 *
 * The update is the standard semi-implicit form: integrate velocity, then
 * position, in that order. It is stable at the frame steps a page actually gets
 * because the step is clamped.
 * @module
 */

/**
 * A spring's feel, in the terms used across this package.
 *
 * `response` is roughly the time in seconds the spring takes to reach the target,
 * so smaller is snappier. `dampingFraction` below 1 overshoots; 1 is critical.
 * These names and their meaning come from React Spring, whose solver is what the
 * reference cursor uses.
 */
export interface SpringConfig {
  readonly dampingFraction: number
  readonly response: number
}

/**
 * One animated scalar.
 *
 * `force` and the two clocks exist because this is a port of React Spring's
 * solver rather than a textbook spring: it integrates force first and velocity
 * second, and it advances a simulation clock in fixed steps so that a frame drop
 * cannot change the result.
 */
export interface Spring {
  value: number
  target: number
  velocity: number
  force: number
  simulationTime: number
  scriptTime: number
  readonly config: SpringConfig
}

/**
 * The fixed integration step, in seconds.
 *
 * Fixed rather than per-frame on purpose: the same motion has to come out of a
 * 60Hz and a 120Hz display, and an input-driven step would not do that.
 */
export const STEP_SECONDS = 1 / 240

/**
 * The stiffness ceiling, in 1/s^2.
 *
 * Present in React Spring to stop a very small `response` from producing a spring
 * stiff enough to go unstable at the fixed step.
 */
const MAX_STIFFNESS = 1 / (2 * STEP_SECONDS ** 2)

/** Velocity and force below this count as stopped, in 1/60 s-scaled units. */
const REST_VELOCITY = 0.001 * 60

/**
 * Most simulated time one call may add, in seconds.
 *
 * A frame longer than this is truncated rather than integrated, because the
 * stiffest configured spring is only stable below roughly 2/omega — about 48ms —
 * and integrating past that makes a dropped frame change the motion instead of
 * merely delaying it. Truncating loses a little distance on that frame and keeps
 * the trajectory identical to a finely stepped one.
 */
const MAX_ADVANCE_SECONDS = 0.05

/** Create a spring already at `value`, so nothing animates on first paint. */
export function createSpring(value: number, config: SpringConfig): Spring {
  return {
    value,
    target: value,
    velocity: 0,
    force: 0,
    simulationTime: 0,
    scriptTime: 0,
    config,
  }
}

/**
 * Advance one spring by `seconds`.
 *
 * The strategy is React Spring's: track time on a `scriptTime` clock, and run the
 * simulation in fixed `STEP_SECONDS` steps until it catches up. When the two
 * clocks drift by more than a step — which is what a dropped frame looks like —
 * the simulation clock is pulled back one step rather than asked to catch up,
 * so a stall cannot produce a visible jump.
 * @param spring - mutated in place.
 * @param seconds - elapsed wall time; values <= 0 are ignored.
 */
export function stepSpring(spring: Spring, seconds: number): void {
  if (!(seconds > 0)) return
  const response = Math.max(0.001, spring.config.response)
  const stiffness = Math.min((Math.PI * 2) ** 2 / response ** 2, MAX_STIFFNESS)
  const damping = Math.sqrt(stiffness) * 2 * spring.config.dampingFraction

  spring.scriptTime += Math.min(seconds, MAX_ADVANCE_SECONDS)
  if (spring.scriptTime - spring.simulationTime > 1) spring.simulationTime = spring.scriptTime - STEP_SECONDS
  while (spring.simulationTime < spring.scriptTime) {
    integrate(spring, stiffness, damping)
    spring.simulationTime += STEP_SECONDS
  }
  if (hasSettled(spring)) {
    spring.value = spring.target
    spring.velocity = 0
    spring.force = 0
  }
}

/**
 * One fixed step: half-step velocity from the current force, advance position,
 * then rebuild the force. This is the semi-implicit ordering React Spring uses,
 * and it is why a spring here settles the way it does rather than ringing.
 */
function integrate(spring: Spring, stiffness: number, damping: number): void {
  const half = STEP_SECONDS / 2
  const velocity = spring.velocity + spring.force * half
  spring.value += velocity * STEP_SECONDS
  spring.force = velocity * -damping + (spring.target - spring.value) * stiffness
  spring.velocity = velocity + spring.force * half
}

/**
 * React Spring's rest test.
 *
 * Both the velocity and the force must be small, and the remaining distance must
 * be inside a tolerance proportional to the target. A spring passing through its
 * target at speed is therefore not at rest even though its offset is briefly zero.
 */
function hasSettled(spring: Spring): boolean {
  if (Math.max(spring.velocity ** 2, spring.force ** 2) > REST_VELOCITY ** 2) return false
  const tolerance = spring.target * 0.01
  const remaining = spring.target - spring.value
  return tolerance === 0 || remaining ** 2 <= tolerance ** 2
}

/** Whether a spring has arrived and stopped. */
export function isAtRest(spring: Spring): boolean {
  return hasSettled(spring)
}

/**
 * Redirect a spring toward `target` while preserving its velocity.
 *
 * Only the target changes, so a spring already moving toward the new point keeps
 * its speed — which is what makes a redirected cursor look continuous.
 */
export function retargetSpring(spring: Spring, target: number): void {
  spring.target = target
}

/** Move a spring without animating, as the reference does when it teleports. */
export function jumpSpring(spring: Spring, value: number): void {
  spring.force = 0
  spring.simulationTime = 0
  spring.scriptTime = 0
  spring.target = value
  spring.value = value
  spring.velocity = 0
}


/**
 * The cursor's spring tuning, copied from the reference implementation.
 *
 * Each is a separate spring there, with its own feel; together they are what make
 * a long glide settle differently from a short scoot. `response` is the arrival
 * time constant and `dampingFraction` the overshoot, both in React Spring's terms.
 */
export const CURSOR_SPRINGS = {
  /** Travel springs: identical on both axes so a diagonal move stays straight. */
  position: { dampingFraction: 0.9, response: 0.19 },
  /** Rotation tracks a curve's tangent, so it is the snappiest spring present. */
  rotation: { dampingFraction: 0.9, response: 0.12 },
  /** The idle fade is the slowest, so the cursor appears rather than pops. */
  visibility: { dampingFraction: 0.86, response: 0.42 },
  /** A short hop splits into an axis-aligned scoot plus a small overshoot. */
  scootAxis: { dampingFraction: 0.9, response: 0.12 },
  scootRotation: { dampingFraction: 0.82, response: 0.055 },
  scootStretch: { dampingFraction: 0.86, response: 0.12 },
  /** Speed-driven lengthwise stretch during a glide. */
  stretch: { dampingFraction: 0.85, response: 0.2 },
} as const satisfies Record<string, SpringConfig>
