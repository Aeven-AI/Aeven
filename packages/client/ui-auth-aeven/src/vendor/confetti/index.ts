/**
 * The vendored js-confetti build, given a type.
 *
 * The implementation is a transpiled ES5 bundle carried over as it stands, so
 * it declares nothing about itself. This states the shape the sign-up
 * celebration uses, and is also what lets the package emit declarations: a
 * transpiled class expression has no name TypeScript can reference.
 * @module
 */

import JSConfettiImpl from './js-confetti.js'

/** Options the sign-up celebration passes. */
export interface AddConfettiOptions {
  confettiRadius?: number
  confettiColors?: readonly string[]
  confettiNumber?: number
  emojis?: readonly string[]
}

/** What the vendored build constructs. */
export interface ConfettiRunner {
  addConfetti(options?: AddConfettiOptions): Promise<void>
}

/** The vendored confetti constructor, typed to the slice these screens use. */
const JSConfetti: new () => ConfettiRunner = JSConfettiImpl

export default JSConfetti
