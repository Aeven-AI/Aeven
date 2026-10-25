/** Submit and staple Apple notarization tickets, repeating the ticket lookups Apple drops. */

import { spawn } from 'node:child_process'
import { notarize } from '@electron/notarize'

/** Attempts one ticket-delivery command gets before the release fails, covering about eight minutes of Apple outages. */
const NOTARY_TICKET_ATTEMPTS = 6

/** Delay before a repeated attempt, multiplied by the number of attempts that already failed. */
const NOTARY_TICKET_RETRY_DELAY_MS = 30_000

/**
 * What Apple's ticket-delivery service reports when it drops a lookup for a ticket it has already
 * issued. `stapler` and `spctl` then report the network failure as exit code 68, which is why the
 * exit code alone does not identify the condition: an artifact whose ticket is genuinely missing
 * reports a record lookup failure instead and stays a build failure.
 */
const TICKET_DELIVERY_FAILURES = [
  /api\.apple-cloudkit\.com/u,
  /CloudKit's response is inconsistent/u,
  /NSURLErrorDomain/u,
  /The network connection was lost/u,
]

/**
 * Describe a failure and every failure it wraps.
 * @param {unknown} error - Thrown value, possibly an `Error` with a cause chain.
 * @returns {string} Messages joined by newlines.
 */
function describeFailure(error) {
  if (!(error instanceof Error)) return String(error)
  return error.cause === undefined ? error.message : `${error.message}\n${describeFailure(error.cause)}`
}

/**
 * Report whether a failed Apple call failed at ticket delivery rather than at signing or notarization.
 * @param {unknown} error - Thrown value from a notary or stapler command.
 * @returns {boolean} True when repeating the command can succeed without another submission.
 */
export function isTransientNotaryTicketFailure(error) {
  const diagnostic = describeFailure(error)
  return TICKET_DELIVERY_FAILURES.some(pattern => pattern.test(diagnostic))
}

/**
 * Wait for one retry delay.
 * @param {number} milliseconds - Delay in milliseconds.
 * @returns {Promise<void>} Resolves after the delay.
 */
function delay(milliseconds) {
  return new Promise(resolvePromise => {
    setTimeout(resolvePromise, milliseconds)
  })
}

/**
 * Execute one `xcrun stapler` action against a signed path.
 * @param {'staple' | 'validate'} action - Stapler action to run.
 * @param {string} path - Application bundle or disk image.
 * @returns {Promise<string>} Combined output of the successful action.
 */
function runStapler(action, path) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('/usr/bin/xcrun', ['stapler', action, '-v', path], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let spawnError
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.once('error', error => { spawnError = error })
    child.once('close', (code, signal) => {
      if (spawnError !== undefined) {
        reject(new Error(`desktop macOS signing: could not execute stapler ${action}: ${spawnError.message}`))
        return
      }
      if (signal !== null) {
        reject(new Error(`desktop macOS signing: stapler ${action} was terminated by ${signal}`))
        return
      }
      if (code !== 0) {
        reject(new Error(`desktop macOS signing: stapler ${action} exited with ${String(code)}: ${output.trim()}`))
        return
      }
      resolvePromise(output)
    })
  })
}

/**
 * Run one stapler action, repeating only the attempts that fail at ticket delivery.
 * @param {'staple' | 'validate'} action - Stapler action to run.
 * @param {string} path - Application bundle or disk image.
 * @param {{ attempts?: number, delayMs?: number, run?: (action: 'staple' | 'validate', path: string) => Promise<string> }} [options] - Retry policy and Apple command.
 * @returns {Promise<string>} Combined output of the successful action.
 */
async function runStaplerAction(action, path, options = {}) {
  const {
    attempts = NOTARY_TICKET_ATTEMPTS,
    delayMs = NOTARY_TICKET_RETRY_DELAY_MS,
    run = runStapler,
  } = options
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run(action, path)
    }
    catch (error) {
      if (attempt >= attempts || !isTransientNotaryTicketFailure(error)) throw error
      process.stdout.write(`desktop macOS signing: repeating stapler ${action} for ${path} (attempt ${String(attempt + 1)} of ${String(attempts)})\n`)
      await delay(delayMs * attempt)
    }
  }
}

/**
 * Staple the ticket Apple issued for one notarized artifact.
 * @param {string} path - Notarized application bundle or disk image.
 * @param {{ attempts?: number, delayMs?: number, run?: (action: 'staple' | 'validate', path: string) => Promise<string> }} [options] - Retry policy and Apple command.
 * @returns {Promise<string>} Combined output of the successful staple.
 */
export function stapleMacOSArtifact(path, options) {
  return runStaplerAction('staple', path, options)
}

/**
 * Require one artifact to carry the ticket Apple issued for it.
 * @param {string} path - Stapled application bundle or disk image.
 * @param {{ attempts?: number, delayMs?: number, run?: (action: 'staple' | 'validate', path: string) => Promise<string> }} [options] - Retry policy and Apple command.
 * @returns {Promise<string>} Combined output of the successful validation.
 */
export function validateMacOSTicket(path, options) {
  return runStaplerAction('validate', path, options)
}

/**
 * Submit one macOS artifact to Apple and staple the ticket its notarization produced.
 *
 * A ticket-delivery failure leaves an accepted submission behind, so the artifact is stapled again
 * instead of being submitted a second time; stapling the same artifact twice changes nothing.
 * @param {string} path - Application bundle or disk image to notarize.
 * @param {import('./desktop-release-environment.mjs').MacOSNotarizationEnvironment} credentials - Notary credentials.
 * @param {{ submit?: (options: object) => Promise<void>, staple?: (path: string) => Promise<void> }} [options] - Notary submission and ticket staple implementations.
 * @returns {Promise<void>} Resolves after the artifact carries its ticket.
 */
export async function notarizeMacOSArtifact(path, credentials, options = {}) {
  const { submit = notarize, staple = stapleMacOSArtifact } = options
  try {
    await submit({ appPath: path, ...credentials })
  }
  catch (error) {
    if (!isTransientNotaryTicketFailure(error)) throw error
    process.stdout.write(`desktop macOS notarization: Apple accepted ${path} without delivering its ticket; stapling again\n`)
    try {
      await staple(path)
    }
    catch (stapleError) {
      throw new AggregateError(
        [error, stapleError],
        `desktop macOS notarization: stapling ${path} failed after Apple accepted the submission`,
      )
    }
  }
}
