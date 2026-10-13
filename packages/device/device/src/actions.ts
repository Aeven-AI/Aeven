/**
 * Device settings and one-shot actions, run against the host's toolchain.
 *
 * serve-sim's own preview drives its settings panel by sending shell commands
 * over a token-gated socket. Proxying that would hand every browser session
 * arbitrary command execution on the Host, so this module runs the same
 * underlying commands itself, typed per action: `xcrun simctl ui` and
 * `simctl privacy` for iOS, serve-sim's bundled accessibility helper for the
 * iOS toggles, and `adb shell` for Android.
 *
 * Each platform advertises the actions it supports; the pane hides the rest.
 *
 * @module @aeven/device/actions
 */
import { RemoteError } from '@aeven/typert-protocol'
import type { DeviceCommandResult, DeviceHostReady } from './host.ts'
import type {
  DeviceActionBody, DeviceActionType, DeviceColorFilter, DeviceForegroundApp, DeviceOrientation, DevicePlatform,
  DeviceSettings, DeviceTextSize, DeviceToggleSetting,
} from './types.ts'

const IOS_ACTIONS: ReadonlySet<DeviceActionType> = new Set<DeviceActionType>([
  'setAppearance', 'setTextSize', 'setToggle', 'setLiquidGlass', 'setColorFilter', 'setLocation', 'clearLocation',
  'setPermission', 'openUrl', 'launchApp', 'terminateApp', 'sendPush',
])

const ANDROID_ACTIONS: ReadonlySet<DeviceActionType> = new Set<DeviceActionType>([
  'setAppearance', 'setTextSize', 'setToggle', 'setOrientation', 'setLocation', 'clearLocation', 'setPermission',
  'openUrl', 'launchApp', 'terminateApp',
])

const IOS_TOGGLES: ReadonlySet<DeviceToggleSetting> = new Set<DeviceToggleSetting>([
  'reduceMotion', 'increaseContrast', 'reduceTransparency', 'showBorders', 'voiceOver',
])
const ANDROID_TOGGLES: ReadonlySet<DeviceToggleSetting> = new Set<DeviceToggleSetting>(['reduceMotion', 'networkEnabled'])

/**
 * Whether a platform can run an action.
 * @param platform - the device's platform.
 * @param action - the action to check.
 * @returns true when the action is implemented for that platform.
 */
export function supportsAction(platform: DevicePlatform, action: DeviceActionBody): boolean {
  if (!(platform === 'ios' ? IOS_ACTIONS : ANDROID_ACTIONS).has(action.type)) return false
  if (action.type === 'setToggle') return (platform === 'ios' ? IOS_TOGGLES : ANDROID_TOGGLES).has(action.setting)
  return true
}

function unavailable(operation: string, platform: DevicePlatform, reason: 'unsupported' | 'helper_missing'): RemoteError<'device/action-unavailable'> {
  const message = reason === 'helper_missing'
    ? `Device ${operation} needs a helper missing from this install. Set up device support again.`
    : `Device ${operation} is not supported on ${platform}.`
  return new RemoteError('device/action-unavailable', message, { operation, platform, reason })
}

/**
 * Require a zero exit status.
 * @param operation - names the action in the failure.
 * @param result - the command's outcome.
 * @returns the command's stdout.
 */
function ok(operation: string, result: DeviceCommandResult): string {
  if (result.code === 0) return result.stdout
  const detail = result.stderr.trim() || result.stdout.trim()
  throw new RemoteError(
    'device/operation-failed',
    `Device ${operation} failed (exit code ${String(result.code)})${detail === '' ? '.' : `: ${detail}`}`,
    { operation },
  )
}

// iOS content-size categories the four shared steps map onto. `default` is
// what a fresh simulator reports ("large").
const IOS_TEXT_SIZES: Record<DeviceTextSize, string> = {
  small: 'small',
  default: 'large',
  large: 'extra-extra-large',
  'extra-large': 'accessibility-large',
}
const ANDROID_TEXT_SIZES: Record<DeviceTextSize, string> = {
  small: '0.85',
  default: '1.0',
  large: '1.15',
  'extra-large': '1.3',
}

/**
 * Map an iOS content-size category onto the shared steps.
 * @param category - `simctl ui content_size` output.
 * @returns the nearest shared step.
 */
export function textSizeFromIos(category: string): DeviceTextSize {
  const exact = (Object.entries(IOS_TEXT_SIZES) as [DeviceTextSize, string][]).find(([, value]) => value === category)
  if (exact !== undefined) return exact[0]
  if (category.startsWith('accessibility')) return 'extra-large'
  if (category.includes('extra')) return 'large'
  return category === 'extra-small' || category === 'small' || category === 'medium' ? 'small' : 'default'
}

/**
 * Map an Android `font_scale` onto the shared steps.
 * @param scale - the system font scale.
 * @returns the nearest shared step.
 */
export function textSizeFromAndroid(scale: number): DeviceTextSize {
  if (scale <= 0.9) return 'small'
  if (scale >= 1.25) return 'extra-large'
  if (scale >= 1.1) return 'large'
  return 'default'
}

const IOS_TOGGLE_OPTIONS: Partial<Record<DeviceToggleSetting, string>> = {
  reduceMotion: 'reduce-motion',
  reduceTransparency: 'reduce-transparency',
  showBorders: 'show-borders',
  voiceOver: 'voiceover',
}

// Permission names -> the `simctl privacy` service.
const IOS_PRIVACY_SERVICES: Partial<Record<string, string>> = {
  camera: 'camera',
  microphone: 'microphone',
  photos: 'photos',
  contacts: 'contacts',
  calendar: 'calendar',
  reminders: 'reminders',
  location: 'location',
  motion: 'motion',
  'media-library': 'media-library',
  faceid: 'faceid',
}

const ANDROID_PERMISSIONS: Partial<Record<string, readonly string[]>> = {
  camera: ['android.permission.CAMERA'],
  microphone: ['android.permission.RECORD_AUDIO'],
  photos: ['android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_EXTERNAL_STORAGE'],
  contacts: ['android.permission.READ_CONTACTS', 'android.permission.WRITE_CONTACTS'],
  calendar: ['android.permission.READ_CALENDAR', 'android.permission.WRITE_CALENDAR'],
  location: ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION'],
  notifications: ['android.permission.POST_NOTIFICATIONS'],
  motion: ['android.permission.ACTIVITY_RECOGNITION'],
}

// Gravity vector (x:y:z) that makes the emulator report each orientation, and
// the window-manager rotation index for the same.
const ANDROID_GRAVITY: Record<DeviceOrientation, string> = {
  portrait: '0:9.81:0',
  landscape_left: '9.81:0:0',
  portrait_upside_down: '0:-9.81:0',
  landscape_right: '-9.81:0:0',
}
const ANDROID_ROTATION: Record<DeviceOrientation, string> = {
  portrait: '0',
  landscape_left: '1',
  portrait_upside_down: '2',
  landscape_right: '3',
}

/**
 * Run one action on a device.
 * @param ready - the device's host.
 * @param platform - the device's platform.
 * @param deviceId - simulator udid or adb serial.
 * @param action - what to do.
 * @returns after the device accepted the change.
 */
export async function runDeviceAction(
  ready: DeviceHostReady,
  platform: DevicePlatform,
  deviceId: string,
  action: DeviceActionBody,
): Promise<void> {
  if (!supportsAction(platform, action)) throw unavailable(action.type, platform, 'unsupported')
  if (platform === 'ios') await runIos(ready, deviceId, action)
  else await runAndroid(ready, deviceId, action)
}

async function simctl(ready: DeviceHostReady, udid: string, args: readonly string[], operation: string): Promise<string> {
  const [verb, ...rest] = args
  return ok(operation, await ready.run('xcrun', ['simctl', verb as string, udid, ...rest]))
}

async function axSettings(ready: DeviceHostReady, udid: string, args: readonly string[]): Promise<string> {
  const helper = ready.helpers.axSettings
  if (helper === null) throw unavailable('accessibility', 'ios', 'helper_missing')
  return ok('accessibility', await ready.run('xcrun', ['simctl', 'spawn', udid, helper, ...args]))
}

async function runIos(ready: DeviceHostReady, udid: string, action: DeviceActionBody): Promise<void> {
  switch (action.type) {
    case 'setAppearance':
      await simctl(ready, udid, ['ui', 'appearance', action.value], 'appearance')
      return
    case 'setTextSize':
      await simctl(ready, udid, ['ui', 'content_size', IOS_TEXT_SIZES[action.value]], 'text size')
      return
    case 'setToggle':
      if (action.setting === 'increaseContrast') {
        await simctl(ready, udid, ['ui', 'increase_contrast', action.value ? 'enabled' : 'disabled'], 'increase contrast')
        return
      }
      await axSettings(ready, udid, ['set', IOS_TOGGLE_OPTIONS[action.setting] as string, action.value ? 'on' : 'off'])
      return
    case 'setLiquidGlass':
      await axSettings(ready, udid, ['set', 'liquid-glass', action.value])
      return
    case 'setColorFilter':
      await axSettings(ready, udid, ['set', 'color-filter', action.value])
      return
    case 'setLocation':
      await simctl(ready, udid, ['location', 'set', `${String(action.latitude)},${String(action.longitude)}`], 'location')
      return
    case 'clearLocation':
      await simctl(ready, udid, ['location', 'clear'], 'location')
      return
    case 'setPermission': {
      if (action.permission === 'notifications') {
        // simctl has no notification verb; serve-sim's CLI edits the
        // BulletinBoard plist for it.
        const cli = ready.helpers.serveSimCli
        if (cli === null) throw unavailable('permission', 'ios', 'helper_missing')
        ok('permission', await ready.run(ready.nodePath, [cli, 'permissions', action.decision, action.permission, action.appId, '-d', udid]))
        return
      }
      const service = IOS_PRIVACY_SERVICES[action.permission]
      if (service === undefined) throw unavailable('permission', 'ios', 'unsupported')
      await simctl(ready, udid, ['privacy', action.decision, service, action.appId], 'permission')
      return
    }
    case 'openUrl':
      await simctl(ready, udid, ['openurl', action.url], 'open url')
      return
    case 'launchApp':
      await simctl(ready, udid, ['launch', action.appId], 'launch')
      return
    case 'terminateApp':
      await simctl(ready, udid, ['terminate', action.appId], 'terminate')
      return
    case 'sendPush':
      ok('push', await ready.run('xcrun', ['simctl', 'push', udid, action.appId, '-'], {
        stdin: JSON.stringify({ aps: { alert: action.payload } }),
      }))
      return
    case 'setOrientation':
      throw unavailable(action.type, 'ios', 'unsupported')
  }
}

async function runAndroid(ready: DeviceHostReady, serial: string, action: DeviceActionBody): Promise<void> {
  const adb = async (args: readonly string[], operation: string) => ok(operation, await ready.run('adb', ['-s', serial, ...args]))
  const shell = (args: readonly string[], operation: string) => adb(['shell', ...args], operation)
  switch (action.type) {
    case 'setAppearance':
      await shell(['cmd', 'uimode', 'night', action.value === 'dark' ? 'yes' : 'no'], 'appearance')
      return
    case 'setTextSize':
      await shell(['settings', 'put', 'system', 'font_scale', ANDROID_TEXT_SIZES[action.value]], 'text size')
      return
    case 'setToggle':
      if (action.setting === 'networkEnabled') {
        const state = action.value ? 'enable' : 'disable'
        await shell(['svc', 'wifi', state], 'network')
        await shell(['svc', 'data', state], 'network')
        return
      }
      for (const key of ['animator_duration_scale', 'transition_animation_scale', 'window_animation_scale']) {
        await shell(['settings', 'put', 'global', key, action.value ? '0' : '1'], 'reduce motion')
      }
      return
    case 'setOrientation':
      // `user-rotation lock` only rotates window content on recent images; the
      // display the encoder captures stays put. Tilting an emulator's
      // accelerometer rotates it for real. Physical devices get the lock.
      if (serial.startsWith('emulator-')) {
        await shell(['settings', 'put', 'system', 'accelerometer_rotation', '1'], 'orientation')
        await shell(['cmd', 'window', 'user-rotation', 'free'], 'orientation')
        await adb(['emu', 'sensor', 'set', 'acceleration', ANDROID_GRAVITY[action.value]], 'orientation')
        return
      }
      await shell(['cmd', 'window', 'user-rotation', 'lock', ANDROID_ROTATION[action.value]], 'orientation')
      return
    case 'setLocation':
      await adb(['emu', 'geo', 'fix', String(action.longitude), String(action.latitude)], 'location')
      return
    case 'clearLocation':
      // The emulator has no "clear"; the last fix stays in place.
      return
    case 'setPermission': {
      const permissions = ANDROID_PERMISSIONS[action.permission]
      if (permissions === undefined) throw unavailable('permission', 'android', 'unsupported')
      const verb = action.decision === 'grant' ? 'grant' : 'revoke'
      for (const permission of permissions) {
        // Not every app declares every permission of a group; pm refuses those.
        await ready.run('adb', ['-s', serial, 'shell', 'pm', verb, action.appId, permission])
      }
      return
    }
    case 'openUrl':
      await shell(['am', 'start', '-a', 'android.intent.action.VIEW', '-d', action.url], 'open url')
      return
    case 'launchApp':
      await shell(['monkey', '-p', action.appId, '-c', 'android.intent.category.LAUNCHER', '1'], 'launch')
      return
    case 'terminateApp':
      await shell(['am', 'force-stop', action.appId], 'terminate')
      return
    case 'setLiquidGlass':
    case 'setColorFilter':
    case 'sendPush':
      throw unavailable(action.type, 'android', 'unsupported')
  }
}

/**
 * Read a device's current settings and foreground app. A read that fails
 * leaves its field absent rather than failing the whole detail.
 * @param ready - the device's host.
 * @param platform - the device's platform.
 * @param deviceId - simulator udid or adb serial.
 * @returns what could be read.
 */
export async function readDeviceDetail(
  ready: DeviceHostReady,
  platform: DevicePlatform,
  deviceId: string,
): Promise<{ settings: DeviceSettings; foregroundApp: DeviceForegroundApp | null }> {
  return platform === 'ios' ? await readIos(ready, deviceId) : await readAndroid(ready, deviceId)
}

async function quiet<T>(read: Promise<T>): Promise<T | undefined> {
  return await read.catch(() => undefined)
}

const onOff = (value: string | undefined): boolean | undefined => value === 'on' ? true : value === 'off' ? false : undefined

const COLOR_FILTERS: ReadonlySet<string> = new Set<DeviceColorFilter>(['none', 'grayscale', 'red-green', 'green-red', 'blue-yellow'])

async function readIos(ready: DeviceHostReady, udid: string): Promise<{ settings: DeviceSettings; foregroundApp: null }> {
  const uiValue = (option: string) => quiet(simctl(ready, udid, ['ui', option], option).then(out => out.trim().toLowerCase()))
  const [appearance, contentSize, contrast, axRaw] = await Promise.all([
    uiValue('appearance'),
    uiValue('content_size'),
    uiValue('increase_contrast'),
    quiet(axSettings(ready, udid, ['status'])),
  ])
  let ax: Record<string, unknown> | undefined
  try {
    const parsed: unknown = axRaw === undefined ? undefined : JSON.parse(axRaw)
    if (typeof parsed === 'object' && parsed !== null) ax = parsed as Record<string, unknown>
  } catch {
    // A helper that printed something other than its JSON status reports nothing.
    ax = undefined
  }
  const axString = (key: string) => typeof ax?.[key] === 'string' ? ax[key] : undefined
  const settings: {
    -readonly [K in keyof DeviceSettings]: DeviceSettings[K]
  } = {}
  if (appearance === 'light' || appearance === 'dark') settings.appearance = appearance
  if (contentSize !== undefined && contentSize !== '') settings.textSize = textSizeFromIos(contentSize)
  if (contrast !== undefined && contrast !== '') settings.increaseContrast = contrast === 'enabled'
  const reduceMotion = onOff(axString('reduce-motion'))
  if (reduceMotion !== undefined) settings.reduceMotion = reduceMotion
  const reduceTransparency = onOff(axString('reduce-transparency'))
  if (reduceTransparency !== undefined) settings.reduceTransparency = reduceTransparency
  const showBorders = onOff(axString('show-borders'))
  if (showBorders !== undefined) settings.showBorders = showBorders
  const voiceOver = onOff(axString('voiceover'))
  if (voiceOver !== undefined) settings.voiceOver = voiceOver
  const liquidGlass = axString('liquid-glass')
  if (liquidGlass === 'clear' || liquidGlass === 'tinted') settings.liquidGlass = liquidGlass
  const colorFilter = axString('color-filter')
  if (colorFilter !== undefined && COLOR_FILTERS.has(colorFilter)) settings.colorFilter = colorFilter as DeviceColorFilter
  return { settings, foregroundApp: null }
}

async function readAndroid(ready: DeviceHostReady, serial: string): Promise<{ settings: DeviceSettings; foregroundApp: DeviceForegroundApp | null }> {
  const shell = (args: readonly string[]) =>
    quiet(ready.run('adb', ['-s', serial, 'shell', ...args]).then(result => ok(args[0] ?? 'shell', result).trim()))
  const [night, fontScale, animator, wifi, focus] = await Promise.all([
    shell(['cmd', 'uimode', 'night']),
    shell(['settings', 'get', 'system', 'font_scale']),
    shell(['settings', 'get', 'global', 'animator_duration_scale']),
    shell(['settings', 'get', 'global', 'wifi_on']),
    // `dumpsys window windows` stopped printing the focus on API 36; the
    // unfiltered dump still does.
    shell(['dumpsys', 'window']),
  ])
  const scale = fontScale !== undefined && fontScale !== 'null' ? Number(fontScale) : Number.NaN
  const focused = focus?.match(/m(?:CurrentFocus|FocusedApp)=\w+\{[^ ]+ u\d+ ([^/ ]+)\//u)
  const settings: {
    -readonly [K in keyof DeviceSettings]: DeviceSettings[K]
  } = {}
  if (night?.includes('yes') === true) settings.appearance = 'dark'
  else if (night?.includes('no') === true) settings.appearance = 'light'
  if (Number.isFinite(scale)) settings.textSize = textSizeFromAndroid(scale)
  if (animator !== undefined && animator !== 'null' && animator !== '') settings.reduceMotion = Number(animator) === 0
  if (wifi === '1' || wifi === '0') settings.networkEnabled = wifi === '1'
  return { settings, foregroundApp: focused?.[1] === undefined ? null : { id: focused[1] } }
}
