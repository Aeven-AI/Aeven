/** Typed task-board failures. */

import { HarnessError } from '@aeven/llm'

/** Stable failure raised by the shared task board. */
export class TeamError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'TeamError'
  }
}
