/** Electron-builder fields asserted by the Desktop release tests. */
export interface DesktopElectronBuilderConfig {
  readonly appId: string
  readonly directories: {
    readonly output: string
  }
  readonly extraResources: readonly [
    { readonly from: string, readonly to: 'runtime' },
    { readonly from: string, readonly to: 'seed' },
  ]
  readonly mac: {
    readonly identity: string | undefined
    readonly forceCodeSigning: boolean
    readonly hardenedRuntime: boolean
    readonly notarize: boolean
  }
  readonly win: {
    readonly forceCodeSigning: boolean
    readonly azureSignOptions?: {
      readonly endpoint: string
      readonly codeSigningAccountName: string
      readonly certificateProfileName: string
      readonly publisherName: string
    }
  }
  readonly dmg: {
    readonly sign: boolean
    readonly writeUpdateInfo: boolean
  }
  readonly artifactBuildCompleted: (artifact: { readonly file: string }) => Promise<void> | undefined
  readonly publish: readonly [{ readonly provider: 'github', readonly owner: string, readonly repo: string }]
}

/** GitHub repository whose Releases carry the installers and the update feed. */
export const DESKTOP_RELEASE_REPOSITORY: { readonly owner: string, readonly repo: string }

/**
 * Create electron-builder configuration from one release environment.
 * @param env - Packaging environment.
 * @param hostPlatform - Build-host platform used when no explicit target is present.
 * @param hostArch - Build-host architecture used when no explicit target is present.
 * @returns electron-builder configuration.
 */
export function createElectronBuilderConfig(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): DesktopElectronBuilderConfig

