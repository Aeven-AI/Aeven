import {
  DESKTOP_UNSIGNED_ENV,
  resolveDesktopAppId,
  resolveMacOSNotarizationEnvironment,
  resolveMacOSSigningEnvironment,
} from './desktop-release-environment.mjs'
import { notarizeMacOSDiskImageArtifact } from './notarize-macos-disk-images.mjs'
import { verifyMacOSSignatureAfterSign } from './verify-macos-signature.mjs'
import { resolveWindowsAzureSigning } from './windows-azure-signing.mjs'
import { desktopTargetBuildPaths, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'
import { MACOS_USAGE_DESCRIPTIONS } from './macos-usage-descriptions.mjs'

/** GitHub repository whose Releases carry the installers and the update feed. */
export const DESKTOP_RELEASE_REPOSITORY = { owner: 'Aeven-AI', repo: 'Aeven' }

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
  const packagesMacOS = targetPlatform === 'darwin' || (targetPlatform === undefined && hostPlatform === 'darwin')
  const packagesWindows = targetPlatform === 'win32'
  const unsigned = env[DESKTOP_UNSIGNED_ENV] === '1'
  const macOSRelease = packagesMacOS && !unsigned
  const macOSSigning = macOSRelease ? resolveMacOSSigningEnvironment(env) : undefined
  if (macOSRelease) resolveMacOSNotarizationEnvironment(env)
  // A signed Windows build signs every executable through Azure Trusted Signing;
  // electron-builder reads the service principal from AZURE_TENANT_ID,
  // AZURE_CLIENT_ID and AZURE_CLIENT_SECRET.
  const azureSignOptions = packagesWindows && !unsigned ? resolveWindowsAzureSigning(env) : undefined
  const buildPaths = desktopTargetBuildPaths(resolveDesktopBuildTarget(env, hostPlatform, hostArch))
  return {
    appId,
    productName: 'Aeven',
    // An unsigned build shares the artifacts directory, so its name says so: it cannot be mistaken for a release
    // installer, and the upload plan, which looks up the release names exactly, never picks one up.
    artifactName: `aeven-\${version}-\${os}-\${arch}${unsigned ? '-unsigned' : ''}.\${ext}`,
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
      ...azureSignOptions === undefined ? {} : { azureSignOptions },
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
    // Installers and the update feed are GitHub Release assets; the installed
    // application's updater reads the newest release of this repository.
    publish: [{ provider: 'github', ...DESKTOP_RELEASE_REPOSITORY }],
  }
}

