/** Notarize and verify the macOS application before electron-builder builds its installers. */

import { resolve } from 'node:path'
import { resolveMacOSNotarizationEnvironment } from './desktop-release-environment.mjs'
import { notarizeMacOSArtifact, validateMacOSTicket } from './macos-notarization.mjs'
import { verifyMacOSSignature } from './verify-macos-signature.mjs'

/**
 * Submit the signed application to Apple, staple its ticket, and verify what the installers will carry.
 *
 * electron-builder's own notarization option staples in one unretried call, so this hook owns the
 * application instead: it repeats a dropped ticket lookup, requires the ticket the stapled
 * application carries, and rejects a signature by any other release authority.
 * It runs before the DMG and ZIP targets are built from the application.
 * @param {{ electronPlatformName: string, appOutDir: string, packager: { appInfo: { productFilename: string } } }} context - electron-builder after-sign context.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {{ signingIdentity: string, teamId: string }} expected - Public release identity.
 * @param {{ notarize?: (path: string, credentials: object, options: object) => Promise<void>, validate?: (path: string) => Promise<unknown>, verify?: (path: string, expected: object) => void }} [options] - Notarization, ticket check, and signature verification implementations.
 * @returns {Promise<void>} Resolves after the application carries its ticket and the release identity.
 */
export async function notarizeMacOSApplicationAfterSign(
  context,
  env,
  expected,
  options = {},
) {
  if (context.electronPlatformName !== 'darwin') return
  const { notarize = notarizeMacOSArtifact, validate = validateMacOSTicket, verify = verifyMacOSSignature } = options
  const appPath = resolve(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  await notarize(appPath, resolveMacOSNotarizationEnvironment(env), {})
  await validate(appPath)
  verify(appPath, expected)
  process.stdout.write(`desktop macOS notarization: qualified ${appPath} as Developer ID Application: ${expected.signingIdentity} (${expected.teamId})\n`)
}
