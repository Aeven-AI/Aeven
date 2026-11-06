/** Clip playback helpers: the gestures the player's chrome runs against the element. @module */

/**
 * A refused playback or full-screen promise needs no recovery: a blocked
 * gesture, a clip that failed to load, or a browser that denies the request
 * leaves the element's own events as the controls' truth.
 */
const refusalNeedsNoRecovery = (): void => {}

/**
 * The playback surface the player chrome drives: a `<video>` element, or any element exposing the same
 * members, such as a live composition player. A media without `volume` offers mute alone.
 */
export interface ClipMedia {
  readonly paused: boolean
  currentTime: number
  readonly duration: number
  muted: boolean
  volume?: number
  play(): Promise<void> | void
  pause(): void
}

/**
 * Start or hold one clip. The element's own state decides which way the
 * gesture goes, so a fast second press pauses rather than replaying.
 * @param video - the clip's own element.
 */
export function toggleClip(video: ClipMedia): void {
  if (!video.paused) {
    video.pause()
    return
  }
  const started = video.play()
  if (started !== undefined) void started.catch(refusalNeedsNoRecovery)
}

/**
 * Move one clip to a position in seconds.
 * @param video - the clip's own element.
 * @param seconds - the requested playback position.
 */
export function seekClip(video: ClipMedia, seconds: number): void {
  video.currentTime = seconds
}

/**
 * Enter full screen on the element the clip plays in, or leave it when that
 * element already holds it — the element's own children carry the controls, so
 * the chrome stays with the clip on the full-screen surface.
 * @param player - the element the clip plays in.
 */
export function toggleFullscreen(player: HTMLElement): void {
  if (document.fullscreenElement === player) void document.exitFullscreen().catch(refusalNeedsNoRecovery)
  else void player.requestFullscreen().catch(refusalNeedsNoRecovery)
}

/**
 * Save one clip under its own name. Both the clip and the page share an origin,
 * so the anchor's own download carries the stored bytes without a second copy
 * in memory.
 * @param src - the stored clip's URL.
 * @param name - the file name the clip is saved under.
 */
export function saveClip(src: string, name: string): void {
  const link = document.createElement('a')
  link.href = src
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
}
