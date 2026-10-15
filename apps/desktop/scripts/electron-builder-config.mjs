import {
  DESKTOP_UNSIGNED_ENV,
  resolveDesktopAppId,
  resolveDesktopDeployment,
  resolveMacOSNotarizationEnvironment,
  resolveMacOSSigningEnvironment,
} from './desktop-release-environment.mjs'
import { notarizeMacOSDiskImageArtifact } from './notarize-macos-disk-images.mjs'
import { verifyMacOSSignatureAfterSign } from './verify-macos-signature.mjs'
import { resolveWindowsAzureSigning } from './windows-azure-signing.mjs'
import { desktopTargetBuildPaths, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'
import { MACOS_TEXT_INPUT_SETTINGS, MACOS_USAGE_DESCRIPTIONS } from './macos-usage-descriptions.mjs'

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
  const deployment = resolveDesktopDeployment(env)
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
    // The shell hands these to its Host, whose profile rows read them; see DESKTOP_DEPLOYMENT_ENV_NAMES.
    extraMetadata: { aevenDeployment: deployment },
    // Chromium's UI strings for the client's locales (`LOCALE_IDS` in @aeven/client-locale): macOS names
    // its bundles `en.lproj`/`zh_CN.lproj`, Windows and Linux `en-US.pak`/`zh-CN.pak`.
    electronLanguages: ['en-US', 'zh-CN', 'zh_CN'],
    files: [
      'lib/*.js',
      'lib/*.cjs',
      'renderer/**/*',
      'resources/trayTemplate.png',
      'resources/trayTemplate@2x.png',
      'resources/tray-windows.ico',
      'resources/linux/icons/24x24.png',
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
      // The newest floor among the bundled binaries: onnxruntime-node's darwin-arm64 build requires macOS 14.
      minimumSystemVersion: '14.0',
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
      extendInfo: { ...MACOS_USAGE_DESCRIPTIONS, ...MACOS_TEXT_INPUT_SETTINGS },
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
      // Linux launchers draw icons unmasked on a padded grid, which the inset macOS tile matches. Each
      // icon-theme size is rendered from resources/icon-macos.svg instead of downscaled from one bitmap.
      icon: 'resources/linux/icons',
      category: 'Development',
      executableName: 'aeven',
      // Electron sets the window's app_id and WM_CLASS from package.json `desktopName`; the installed
      // `.desktop` file takes the same name, so docks and taskbars draw this entry's icon for the window.
      syncDesktopName: true,
      // The launcher Comment and the deb description; package.json `description` addresses maintainers.
      synopsis: 'Model-independent AI operating layer',
      description: 'Aeven is an open, model-independent AI operating layer for your digital life. It connects your files, apps, messages, browser, and tools so you can start with what you want to accomplish.',
      // The deb installs Chromium's setuid sandbox helper, which distributions that restrict
      // unprivileged user namespaces require before an AppImage can start.
      target: ['AppImage', 'deb'],
      maintainer: 'Aeven <hello@aeven.io>',
    },
    // electron-builder 26's default AppImage runtime loads the system libfuse2, which Ubuntu 22.04 and
    // later no longer install by default; the static runtime also starts where only FUSE 3 exists.
    toolsets: { appimage: '1.0.3' },
    deb: {
      // Electron's runtime libraries, ALSA included for microphone dictation. Debian 13 and Ubuntu 24.04
      // renamed several for 64-bit time; the old name is the fallback on older releases.
      depends: [
        'libasound2t64 | libasound2',
        'libatspi2.0-0t64 | libatspi2.0-0',
        'libgbm1',
        'libgtk-3-0t64 | libgtk-3-0',
        'libnotify4',
        'libnss3',
        'libsecret-1-0',
        'libuuid1',
        'libxss1',
        'libxtst6',
        'xdg-utils',
      ],
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

