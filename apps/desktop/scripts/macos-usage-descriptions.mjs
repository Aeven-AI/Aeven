/**
 * macOS privacy usage descriptions shared by the packaged application and the
 * development bundle. macOS withholds a protected resource from an application
 * whose Info.plist names no reason for it, without a prompt or an error: the
 * renderer's Geolocation API then only times out.
 */

/** Info.plist keys the Desktop shell adds on macOS. */
export const MACOS_USAGE_DESCRIPTIONS = Object.freeze({
  NSMicrophoneUsageDescription: 'Aeven uses your microphone when you dictate a message.',
  NSLocationWhenInUseUsageDescription: 'Aeven uses your location when you ask about things near you.',
  NSLocationUsageDescription: 'Aeven uses your location when you ask about things near you.',
})
