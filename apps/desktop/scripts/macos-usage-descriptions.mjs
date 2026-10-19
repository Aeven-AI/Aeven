/**
 * macOS Info.plist keys shared by the packaged application and the development
 * bundle. macOS withholds a protected resource from an application whose
 * Info.plist names no reason for it, without a prompt or an error: the
 * renderer's Geolocation API then only times out.
 */

/** Info.plist privacy usage descriptions the Desktop shell adds on macOS. */
export const MACOS_USAGE_DESCRIPTIONS = Object.freeze({
  NSMicrophoneUsageDescription: 'Aeven uses your microphone when you dictate a message or record a clip.',
  NSCameraUsageDescription: 'Aeven uses your camera when you take a photo or record a clip from the composer.',
  NSLocationWhenInUseUsageDescription: 'Aeven uses your location when you ask about things near you.',
  NSLocationUsageDescription: 'Aeven uses your location when you ask about things near you.',
  NSScreenCaptureUsageDescription: 'Aeven sees your screen when you ask it to operate apps on your computer.',
  NSAppleEventsUsageDescription: 'Aeven controls other apps when you ask it to operate them for you.',
})

/**
 * Info.plist text-input settings the Desktop shell adds on macOS. macOS 26 offers verification codes from
 * Messages and Mail in every text field unless the application limits that AutoFill to fields marked as
 * one-time-code inputs.
 */
export const MACOS_TEXT_INPUT_SETTINGS = Object.freeze({
  NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac: true,
})
