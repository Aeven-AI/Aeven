/**
 * Mechanisms, and who performs them.
 *
 * A recipe names a mechanism in the abstract — Apple Events, COM, D-Bus, the
 * filesystem. Actually performing one means owning a platform integration, and
 * this package deliberately owns exactly one: the filesystem, which is identical
 * everywhere and needs no application, no grant, and no UI.
 *
 * Everything else arrives as a **handler registered by a consumer**. That is not
 * a gap; it is the boundary. The executor decides *when* to run something and
 * *whether it worked*. The consumer decides *how*, because it is the one that
 * knows which application is installed on which host.
 *
 * @module @aeven/computer-use-executor/mechanism
 */

import { ComputerUseError } from '@aeven/computer-use-desktop'
import type { RecipeInvocation } from '@aeven/computer-use-router'

/** Everything a handler is told about the work it is being asked to do. */
export interface MechanismRequest {
  /** The invocation the router resolved, including its literal parameters. */
  invocation: RecipeInvocation
  /**
   * The resolved parameters for this call: the invocation's own defaults, with
   * the caller's arguments layered over them. A handler should not read
   * placeholders out of `invocation.operation`; it is a description.
   */
  parameters: Readonly<Record<string, string>>
  /** The application the recipe covers, when the task is application-specific. */
  app?: string
  /** Caller lifetime. */
  signal?: AbortSignal
}

/** What a handler reports back. */
export interface MechanismResult {
  /**
   * What the handler could observe. Advisory only: the executor's verdict comes
   * from its own verification, never from this field.
   */
  observed?: string
  /** Notes for the caller, such as which tool actually did the work. */
  notes?: readonly string[]
}

/** Performs one mechanism. */
export type MechanismHandler = (request: MechanismRequest) => Promise<MechanismResult>

/**
 * Reads and writes files.
 *
 * The only mechanism this package implements, and the one every platform shares,
 * so a task like reading a document needs no application integration at all.
 * @param request - the invocation to perform.
 * @returns what was observed.
 * @throws {ComputerUseError} `invalid-target` when a required parameter is absent.
 */
export async function filesystemHandler(request: MechanismRequest): Promise<MechanismResult> {
  const path = request.parameters.path
  if (path === undefined || path.length === 0) {
    throw new ComputerUseError('invalid-target', 'the filesystem mechanism requires a path parameter')
  }
  const { readFile, stat, writeFile } = await import('node:fs/promises')
  if (request.invocation.operation === 'readFile') {
    const content = await readFile(path, 'utf8')
    return { observed: `read ${String(content.length)} characters`, notes: [path] }
  }
  if (request.invocation.operation === 'stat') {
    await stat(path)
    return { observed: 'present', notes: [path] }
  }
  if (request.invocation.operation === 'writeFile') {
    const text = request.parameters.text
    if (text === undefined) {
      throw new ComputerUseError('invalid-target', 'writing a file requires a text parameter')
    }
    await writeFile(path, text, 'utf8')
    return { observed: `wrote ${String(text.length)} characters`, notes: [path] }
  }
  throw new ComputerUseError('capability-unavailable', `the filesystem mechanism does not implement "${request.invocation.operation}"`, {
    operation: request.invocation.operation,
  })
}

/** The mechanisms this package performs itself. */
export const BUILT_IN_HANDLERS: Readonly<Record<string, MechanismHandler>> = {
  filesystem: filesystemHandler,
}
