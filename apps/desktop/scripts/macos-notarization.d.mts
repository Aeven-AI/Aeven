import type { NotarizeOptions } from '@electron/notarize'
import type { MacOSNotarizationEnvironment } from './desktop-release-environment.mjs'

/**
 * Report whether a failed Apple call failed at ticket delivery rather than at signing or notarization.
 * @param error - Thrown value from a notary or stapler command.
 * @returns True when repeating the command can succeed without another submission.
 */
export function isTransientNotaryTicketFailure(error: unknown): boolean

/** Retry policy and the Apple command a stapler action runs. */
export interface MacOSStaplerOptions {
  readonly attempts?: number
  readonly delayMs?: number
  readonly run?: (action: 'staple' | 'validate', path: string) => Promise<string>
}

/**
 * Staple the ticket Apple issued for one notarized artifact.
 * @param path - Notarized application bundle or disk image.
 * @param options - Retry policy and Apple command.
 * @returns Combined output of the successful staple.
 */
export function stapleMacOSArtifact(path: string, options?: MacOSStaplerOptions): Promise<string>

/**
 * Require one artifact to carry the ticket Apple issued for it.
 * @param path - Stapled application bundle or disk image.
 * @param options - Retry policy and Apple command.
 * @returns Combined output of the successful validation.
 */
export function validateMacOSTicket(path: string, options?: MacOSStaplerOptions): Promise<string>

/** Notary submission and ticket staple implementations a test can replace. */
export interface MacOSNotarizationOptions {
  readonly submit?: (options: NotarizeOptions) => Promise<void>
  readonly staple?: (path: string) => Promise<void>
}

/**
 * Submit one macOS artifact to Apple and staple the ticket its notarization produced.
 * @param path - Application bundle or disk image to notarize.
 * @param credentials - Notary credentials.
 * @param options - Notary submission and ticket staple implementations.
 * @returns Resolves after the artifact carries its ticket.
 */
export function notarizeMacOSArtifact(
  path: string,
  credentials: MacOSNotarizationEnvironment,
  options?: MacOSNotarizationOptions,
): Promise<void>
