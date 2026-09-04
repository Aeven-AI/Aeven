/**
 * Types for the vendored js-confetti build.
 *
 * The implementation is carried over as it stands, so its shape is declared
 * here rather than by annotating a transpiled file.
 */

/** Options the sign-up celebration passes. */
export interface AddConfettiOptions {
  confettiRadius?: number
  confettiColors?: readonly string[]
  confettiNumber?: number
  emojis?: readonly string[]
}

export default class JSConfetti {
  addConfetti(options?: AddConfettiOptions): Promise<void>
}
