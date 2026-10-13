/** Service-principal credentials the Azure SDK reads from the environment. */
export const AZURE_CREDENTIAL_ENV_NAMES: readonly string[]

/** Every environment name a signed Windows build needs. */
export const WINDOWS_SIGNING_ENV_NAMES: readonly string[]

/** electron-builder's `win.azureSignOptions` value. */
export interface WindowsAzureSignOptions {
  readonly endpoint: string
  readonly codeSigningAccountName: string
  readonly certificateProfileName: string
  readonly publisherName: string
}

/**
 * Whether the environment carries a complete Azure Trusted Signing configuration.
 * @param env - Packaging environment.
 * @returns True when every signing name has a value.
 */
export function hasWindowsAzureSigning(env: NodeJS.ProcessEnv): boolean

/**
 * Resolve electron-builder's Azure Trusted Signing options for a signed Windows build.
 * @param env - Packaging environment.
 * @returns The `win.azureSignOptions` value.
 */
export function resolveWindowsAzureSigning(env: NodeJS.ProcessEnv): WindowsAzureSignOptions
