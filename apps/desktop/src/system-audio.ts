/**
 * System audio capture for the meeting recorder: the app's own pages may call
 * `getDisplayMedia` and receive what the computer plays, without a screen.
 *
 * Chromium does the capture on every platform: a Core Audio process tap on
 * macOS 14.2+, WASAPI loopback on Windows, and the PulseAudio/PipeWire monitor
 * source on Linux. Only the macOS tap and the Linux monitor sit behind
 * features, and those must be enabled before the app is ready.
 */
import { desktopCapturer, type Session } from 'electron'

/**
 * Chromium features that route `audio: 'loopback'` to the platform's system
 * audio, plus the one that lets `echoCancellation: 'all'` cancel that system
 * audio out of the microphone.
 * @param platform - the running platform.
 * @returns feature names to add to `--enable-features`.
 */
export function systemAudioFeatures(platform: NodeJS.Platform): readonly string[] {
  const shared = ['SystemLoopbackAsAecReference']
  if (platform === 'darwin') return [...shared, 'MacCatapLoopbackAudioForScreenShare']
  if (platform === 'linux') return [...shared, 'PulseaudioLoopbackForScreenShare']
  return shared
}

/**
 * Answer `getDisplayMedia` from the app's own session. An audio-only request
 * gets system loopback audio and no picker; a request for video gets the
 * primary screen, with loopback audio when audio was asked for too.
 *
 * Installed on the app session only: browser guests use their own partitions,
 * so a page loaded in the sidebar browser cannot capture system audio.
 * @param target - the session the app's renderer runs in.
 */
export function allowSystemAudioCapture(target: Session): void {
  target.setDisplayMediaRequestHandler((request, callback) => {
    if (!request.videoRequested) {
      callback({ audio: 'loopback' })
      return
    }
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const screen = sources[0]
        if (screen === undefined) callback({})
        else callback({ video: screen, ...request.audioRequested ? { audio: 'loopback' as const } : {} })
      })
      .catch(() => {
        // No screen source (permission denied or none attached): an empty
        // answer rejects the page's request with NotAllowedError.
        callback({})
      })
  })
}
