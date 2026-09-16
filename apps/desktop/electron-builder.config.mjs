import {
  DESKTOP_UNSIGNED_ENV,
  resolveDesktopAppId,
  resolveMacOSNotarizationEnvironment,
  resolveMacOSSigningEnvironment,
} from './scripts/desktop-release-environment.mjs'
import { notarizeMacOSDiskImageArtifact } from './scripts/notarize-macos-disk-images.mjs'
import { verifyMacOSSignatureAfterSign } from './scripts/verify-macos-signature.mjs'
import {
  createWindowsTokenSigner,
  installWindowsNsisBootstrapSigner,
} from './scripts/windows-sign.mjs'
import { resolveDesktopAutoUpdateConfig } from './scripts/desktop-auto-update-environment.mjs'
import { desktopTargetBuildPaths } from './scripts/desktop-build-paths.mjs'

/**
 * Create electron-builder configuration from one release environment.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no explicit target is present.
 * @param {string} hostArch - Build-host architecture used when no explicit target is present.
 * @returns {object} electron-builder configuration.
 */
export function createElectronBuilderConfig(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  const appId = resolveDesktopAppId(env)
  const targetPlatform = env.AVN_DESKTOP_TARGET_PLATFORM
  const resolvedPlatform = targetPlatform ?? hostPlatform
  const resolvedArch = env.AVN_DESKTOP_TARGET_ARCH ?? hostArch
  const packagesMacOS = targetPlatform === 'darwin' || (targetPlatform === undefined && hostPlatform === 'darwin')
  const packagesWindows = targetPlatform === 'win32'
  const unsigned = env[DESKTOP_UNSIGNED_ENV] === '1'
  const macOSRelease = packagesMacOS && !unsigned
  const macOSSigning = macOSRelease ? resolveMacOSSigningEnvironment(env) : undefined
  if (macOSRelease) resolveMacOSNotarizationEnvironment(env)
  const windowsSigner = packagesWindows && !unsigned
    ? createWindowsTokenSigner({
        certificateFile: env.AVN_DESKTOP_WINDOWS_CER_FILE,
        signTool: env.AVN_DESKTOP_WINDOWS_SIGNTOOL,
        tokenPin: env.AVN_DESKTOP_WINDOWS_TOKEN_PIN,
        keyContainer: env.AVN_DESKTOP_WINDOWS_KEY_CONTAINER,
      })
    : undefined
  if (windowsSigner !== undefined) {
    installWindowsNsisBootstrapSigner({ sign: windowsSigner })
  }
  const update = resolveDesktopAutoUpdateConfig(env, resolvedPlatform, resolvedArch)
  const buildPaths = desktopTargetBuildPaths(update.target)
  return {
    appId,
    productName: 'Aeven',
    artifactName: 'aeven-${version}-${os}-${arch}.${ext}',
    directories: { output: buildPaths.artifacts },
    asar: true,
    files: [
      'lib/*.js',
      'lib/*.cjs',
      'renderer/**/*',
      'package.json',
    ],
    extraResources: [
      { from: buildPaths.runtime, to: 'runtime' },
      { from: buildPaths.seed, to: 'seed' },
    ],
    mac: {
      category: 'public.app-category.developer-tools',
      // Apple Silicon refuses to launch code without a signature, so an unsigned build is
      // ad-hoc signed; hardened runtime would then reject the seed's unsigned native addons.
      identity: unsigned ? '-' : macOSSigning?.signingIdentity,
      forceCodeSigning: !unsigned,
      hardenedRuntime: !unsigned,
      notarize: !unsigned,
      target: ['dmg', 'zip'],
    },
    dmg: {
      sign: !unsigned,
      writeUpdateInfo: false,
    },
    afterSign: context => {
      if (context.electronPlatformName !== 'darwin' || unsigned) return
      verifyMacOSSignatureAfterSign(context, macOSSigning ?? resolveMacOSSigningEnvironment(env))
    },
    artifactBuildCompleted: artifact => {
      if (!artifact.file.endsWith('.dmg') || unsigned) return
      return notarizeMacOSDiskImageArtifact(
        artifact,
        env,
        macOSSigning ?? resolveMacOSSigningEnvironment(env),
      )
    },
    win: {
      forceCodeSigning: !unsigned,
      signtoolOptions: {
        sign: windowsSigner,
        signingHashAlgorithms: ['sha256'],
      },
      target: ['nsis'],
    },
    linux: {
      category: 'Development',
      executableName: 'aeven',
      // The deb installs Chromium's setuid sandbox helper, which distributions that restrict
      // unprivileged user namespaces require before an AppImage can start.
      target: ['AppImage', 'deb'],
      maintainer: 'Aeven',
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      differentialPackage: true,
    },
    publish: [{ provider: 'generic', url: update.publicUrl }],
  }
}

export default createElectronBuilderConfig()
