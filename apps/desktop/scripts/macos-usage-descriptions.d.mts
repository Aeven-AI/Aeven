/** Info.plist privacy usage descriptions the Desktop shell adds on macOS. */
export declare const MACOS_USAGE_DESCRIPTIONS: Readonly<{
  NSMicrophoneUsageDescription: string
  NSLocationWhenInUseUsageDescription: string
  NSLocationUsageDescription: string
  NSScreenCaptureUsageDescription: string
  NSAppleEventsUsageDescription: string
  NSLocalNetworkUsageDescription: string
}>

/** Info.plist local-network settings the Desktop shell adds on macOS. */
export declare const MACOS_NETWORK_SETTINGS: Readonly<{
  NSBonjourServices: readonly string[]
}>

/** Info.plist text-input settings the Desktop shell adds on macOS. */
export declare const MACOS_TEXT_INPUT_SETTINGS: Readonly<{
  NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac: true
}>
