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
import { MACOS_USAGE_DESCRIPTIONS } from './scripts/macos-usage-descriptions.mjs'

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
    // Chromium's UI strings for the client's locales (`LOCALE_IDS` in @aeven/client-locale): macOS names
    // its bundles `en.lproj`/`zh_CN.lproj`, Windows and Linux `en-US.pak`/`zh-CN.pak`.
    electronLanguages: ['en-US', 'zh-CN', 'zh_CN'],
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
      // Each ICNS slot is rendered from resources/icon-macos.svg instead of downscaled from 1024 px.
      icon: 'resources/icon-macos.icns',
      category: 'public.app-category.developer-tools',
      // Apple Silicon refuses to launch code without a signature, so an unsigned build is
      // ad-hoc signed; hardened runtime would then reject the seed's unsigned native addons.
      identity: unsigned ? '-' : macOSSigning?.signingIdentity,
      forceCodeSigning: !unsigned,
      hardenedRuntime: !unsigned,
      // Replaces electron-builder's default template for the app executable only;
      // without the resource entitlements a signed build silently loses location,
      // the microphone, and the camera.
      entitlements: 'scripts/app-entitlements.plist',
      notarize: !unsigned,
      target: ['dmg', 'zip'],
      extendInfo: { ...MACOS_USAGE_DESCRIPTIONS },
    },
    dmg: {
      // Mounted-volume icon in Finder and on the desktop.
      icon: 'resources/icon-macos.icns',
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
      icon: 'resources/icon-windows.ico',
      forceCodeSigning: !unsigned,
      signtoolOptions: {
        sign: windowsSigner,
        signingHashAlgorithms: ['sha256'],
      },
      target: ['nsis'],
    },
    linux: {
      // Linux launchers draw icons unmasked on a padded grid, which the inset macOS tile matches.
      icon: 'resources/icon-macos.png',
      category: 'Development',
      executableName: 'aeven',
      // The deb installs Chromium's setuid sandbox helper, which distributions that restrict
      // unprivileged user namespaces require before an AppImage can start.
      target: ['AppImage', 'deb'],
      maintainer: 'Aeven',
    },
    nsis: {
      installerIcon: 'resources/icon-windows.ico',
      uninstallerIcon: 'resources/icon-windows.ico',
      // Welcome and finish pages of the assisted installer and uninstaller; makensis reads only 24-bit BMP.
      installerSidebar: 'installer/assets/installer-sidebar.bmp',
      uninstallerSidebar: 'installer/assets/installer-sidebar.bmp',
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      differentialPackage: true,
    },
    publish: [{ provider: 'generic', url: update.publicUrl }],
  }
}

export default createElectronBuilderConfig()
