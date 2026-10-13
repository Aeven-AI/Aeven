/**
 * Which simulator toolchains this machine has, and the environment its device
 * commands run with.
 *
 * @module @aeven/device-local/platforms
 */
import { access, realpath } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import type { DevicePlatform } from '@aeven/device'

/** The Android SDK found on this machine and which of its parts are installed. */
export interface AndroidSdk {
  readonly root: string | undefined
  readonly adb: boolean
  readonly emulator: boolean
  readonly avdmanager: boolean
  /** An `avdmanager` only in the retired `tools/bin`, which current system images reject. */
  readonly legacyAvdmanager: boolean
}

const exists = (file: string): Promise<boolean> => access(file).then(() => true, () => false)
const exe = (name: string, suffix: string): string => process.platform === 'win32' ? `${name}${suffix}` : name

/**
 * Find the Android SDK: `ANDROID_HOME` or `ANDROID_SDK_ROOT` when set, else
 * the Android Studio default locations and the SDK behind an `adb` on PATH.
 * @param env - the Host's environment.
 * @returns the SDK and its installed parts.
 */
export async function findAndroidSdk(env: NodeJS.ProcessEnv): Promise<AndroidSdk> {
  const home = env.HOME ?? env.USERPROFILE ?? ''
  const explicit = env.ANDROID_HOME?.trim() || env.ANDROID_SDK_ROOT?.trim()
  const candidates = explicit
    ? [explicit]
    : [
      join(home, 'Library', 'Android', 'sdk'),
      join(home, 'Android', 'Sdk'),
      join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Android', 'Sdk'),
    ]
  if (!explicit) {
    for (const directory of (env.PATH ?? '').split(delimiter)) {
      if (directory === '') continue
      const adb = await realpath(join(directory, exe('adb', '.exe'))).catch(() => undefined)
      if (adb !== undefined) candidates.push(dirname(dirname(adb)))
    }
  }
  for (const root of candidates) {
    const adb = await exists(join(root, 'platform-tools', exe('adb', '.exe')))
    const emulator = await exists(join(root, 'emulator', exe('emulator', '.exe')))
    if (!explicit && !adb && !emulator) continue
    const avdmanager = await exists(join(root, 'cmdline-tools', 'latest', 'bin', exe('avdmanager', '.bat')))
    const legacyAvdmanager = !avdmanager && await exists(join(root, 'tools', 'bin', exe('avdmanager', '.bat')))
    return { root, adb, emulator, avdmanager, legacyAvdmanager }
  }
  return { root: undefined, adb: false, emulator: false, avdmanager: false, legacyAvdmanager: false }
}

/**
 * Whether a command resolves on PATH.
 * @param command - executable name.
 * @param env - the environment whose PATH is searched.
 * @returns true when an entry exists.
 */
async function onPath(command: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  for (const directory of (env.PATH ?? '').split(delimiter)) {
    if (directory !== '' && await exists(join(directory, command))) return true
  }
  return false
}

/**
 * Why a platform cannot run here.
 * @param platform - the platform.
 * @param sdk - the Android SDK found at startup.
 * @param env - the Host's environment.
 * @returns the reason, or undefined when the toolchain is present.
 */
export async function platformReason(platform: DevicePlatform, sdk: AndroidSdk, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  if (platform === 'ios') {
    if (process.platform !== 'darwin') return 'iOS Simulators need macOS with Xcode.'
    if (!await onPath('xcrun', env)) return 'Xcode command line tools were not found.'
    return undefined
  }
  if (sdk.root === undefined) {
    return 'Android SDK was not found. Install it with Android Studio or set ANDROID_HOME to your SDK directory.'
  }
  if (!sdk.adb) return `Android SDK Platform-Tools are missing from ${sdk.root}. Install them in Android Studio's SDK Manager.`
  if (!sdk.emulator) return `Android Emulator is missing from ${sdk.root}. Install it in Android Studio's SDK Manager.`
  if (env.JAVA_HOME === undefined) {
    return 'No Java runtime was found for the Android SDK tools. Install Android Studio, which bundles one, or set JAVA_HOME.'
  }
  if (!sdk.avdmanager) {
    return sdk.legacyAvdmanager
      ? `The Android SDK command-line tools in ${sdk.root} are an older, unsupported version. Install Android SDK Command-line Tools (latest) in Android Studio's SDK Manager under SDK Tools.`
      : `Android SDK Command-line Tools (latest) are missing from ${sdk.root}. Install them in Android Studio's SDK Manager.`
  }
  return undefined
}

/**
 * The Java runtime the SDK's command-line tools run on: `JAVA_HOME` when set,
 * else the runtime Android Studio bundles. Without one, `avdmanager` fails and
 * the hub can neither list AVDs nor allocate an emulator port.
 * @param env - the Host's environment.
 * @returns the Java home, or undefined when none is found.
 */
export async function findJavaHome(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const explicit = env.JAVA_HOME?.trim()
  if (explicit) return explicit
  const home = env.HOME ?? env.USERPROFILE ?? ''
  const candidates = process.platform === 'darwin'
    ? [
      '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
      join(home, 'Applications', 'Android Studio.app', 'Contents', 'jbr', 'Contents', 'Home'),
    ]
    : process.platform === 'win32'
      ? [join(env.ProgramFiles ?? 'C:\\Program Files', 'Android', 'Android Studio', 'jbr')]
      : ['/opt/android-studio/jbr', join(home, 'android-studio', 'jbr')]
  for (const candidate of candidates) {
    if (await exists(join(candidate, 'bin', exe('java', '.exe')))) return candidate
  }
  return undefined
}

/**
 * The environment device commands and helpers run with: the SDK's
 * platform-tools and emulator directories ahead of PATH, and a Java home for
 * the SDK's command-line tools.
 * @param env - the Host's environment.
 * @param sdkRoot - the Android SDK, when found.
 * @param javaHome - the Java runtime, when found.
 * @returns the command environment.
 */
export function deviceEnvironment(env: NodeJS.ProcessEnv, sdkRoot: string | undefined, javaHome: string | undefined): NodeJS.ProcessEnv {
  if (sdkRoot === undefined) return env
  return {
    ...env,
    ANDROID_HOME: sdkRoot,
    ...javaHome === undefined ? {} : { JAVA_HOME: javaHome },
    PATH: [
      join(sdkRoot, 'platform-tools'), join(sdkRoot, 'emulator'),
      ...javaHome === undefined ? [] : [join(javaHome, 'bin')],
      env.PATH ?? env.Path ?? '',
    ].join(delimiter),
  }
}
