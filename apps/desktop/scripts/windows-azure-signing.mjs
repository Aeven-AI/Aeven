/**
 * Windows release signing through Azure Trusted Signing.
 *
 * electron-builder signs every executable, the installer and its uninstaller
 * with `win.azureSignOptions`; the Azure SDK it runs authenticates the service
 * principal from AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET. No
 * certificate or token lives on the build host.
 */

/** Service-principal credentials the Azure SDK reads from the environment. */
export const AZURE_CREDENTIAL_ENV_NAMES = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']

/** The Trusted Signing account and profile, by the electron-builder option each one fills. */
const AZURE_SIGNING_ENV = {
  endpoint: 'AZURE_TRUSTED_SIGNING_ENDPOINT',
  codeSigningAccountName: 'AZURE_TRUSTED_SIGNING_ACCOUNT_NAME',
  certificateProfileName: 'AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME',
  publisherName: 'AZURE_TRUSTED_SIGNING_PUBLISHER_NAME',
}

/** Every environment name a signed Windows build needs. */
export const WINDOWS_SIGNING_ENV_NAMES = [...AZURE_CREDENTIAL_ENV_NAMES, ...Object.values(AZURE_SIGNING_ENV)]

/**
 * Whether the environment carries a complete Azure Trusted Signing configuration.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {boolean} True when every signing name has a value.
 */
export function hasWindowsAzureSigning(env) {
  return WINDOWS_SIGNING_ENV_NAMES.every(name => (env[name]?.trim() ?? '') !== '')
}

/**
 * Resolve electron-builder's Azure Trusted Signing options for a signed Windows build.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {{ endpoint: string, codeSigningAccountName: string, certificateProfileName: string, publisherName: string }} The `win.azureSignOptions` value.
 * @throws {Error} When any credential or signing name is missing.
 */
export function resolveWindowsAzureSigning(env) {
  const missing = WINDOWS_SIGNING_ENV_NAMES.filter(name => (env[name]?.trim() ?? '') === '')
  if (missing.length > 0) {
    throw new Error(
      `Windows release signing uses Azure Trusted Signing and needs ${missing.join(', ')}; `
      + 'build with --unsigned to skip signing',
    )
  }
  return /** @type {{ endpoint: string, codeSigningAccountName: string, certificateProfileName: string, publisherName: string }} */ (
    Object.fromEntries(Object.entries(AZURE_SIGNING_ENV).map(([option, name]) => [option, env[name]?.trim()]))
  )
}
