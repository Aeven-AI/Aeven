/**
 * Camera capture for the composer: open one user-facing video stream, turn a
 * live frame into a draft image, and record the stream into one video file.
 * Every helper is DOM-only; the dialog owns React state and the caller owns the
 * stream's tracks.
 */

/** Facing direction requested from the device. */
export type CameraFacing = 'user' | 'environment'

/** Why the camera could not be opened, as a key the caller localizes. */
export type CameraFailure = 'unavailable' | 'permission'

/** Refused camera access; `kind` names the sentence the dialog shows. */
export class CameraError extends Error {
  /** @param kind - which localized reason describes the refusal. */
  constructor(readonly kind: CameraFailure) {
    super(kind)
    this.name = 'CameraError'
  }
}

/** Seconds the shutter waits before taking a still while its countdown is on. */
export const COUNTDOWN_SECONDS = 3

/** Longest clip one shutter press records before it stops by itself. */
export const MAX_CLIP_MS = 30_000

/** JPEG quality for stills. */
const FRAME_QUALITY = 0.9

/**
 * Report whether a refused `getUserMedia` came from the user or the platform
 * denying access rather than from missing hardware.
 * @param error - the rejection reason from `getUserMedia`.
 * @returns true for a denial the dialog describes as a permission problem.
 */
function isDenial(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
}

/**
 * Open the preferred camera, with the microphone when one is granted.
 * @param facing - which physical camera the browser should prefer.
 * @returns the live stream; the caller stops its tracks when the dialog closes.
 * @throws {CameraError} `unavailable` without a camera API or a usable device,
 * `permission` when access was denied.
 */
export async function openCamera(facing: CameraFacing): Promise<MediaStream> {
  // Insecure contexts and older browsers omit the capture API entirely.
  const media = navigator.mediaDevices as MediaDevices | undefined
  if (media === undefined) throw new CameraError('unavailable')
  // Without constraints Chrome answers 640×480, which the viewfinder then
  // upscales to its own width and the still inherits at that size.
  const video: MediaTrackConstraints = {
    facingMode: facing,
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    aspectRatio: { ideal: 16 / 9 },
    frameRate: { ideal: 30 },
  }
  try {
    return await media.getUserMedia({ video, audio: true })
  } catch {
    // A missing or denied microphone must not cost the camera: the clip is then
    // recorded silent rather than not at all.
    try {
      return await media.getUserMedia({ video, audio: false })
    } catch (error: unknown) {
      throw new CameraError(isDenial(error) ? 'permission' : 'unavailable')
    }
  }
}

/**
 * Encode the frame the video element currently shows as one JPEG draft image.
 * @param video - playing video element bound to the live stream.
 * @param name - display name of the produced file; never a path.
 * @returns the encoded image, sized to the stream's own frame.
 * @throws {Error} while the stream has delivered no frame yet, or when the
 * browser cannot encode it.
 */
export function grabFrame(video: HTMLVideoElement, name: string): Promise<File> {
  const width = video.videoWidth
  const height = video.videoHeight
  if (width === 0 || height === 0) return Promise.reject(new Error('camera: no frame yet'))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) return Promise.reject(new Error('camera: no 2d context'))
  context.drawImage(video, 0, 0, width, height)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error('camera: unencoded frame'))
        return
      }
      resolve(new File([blob], name, { type: 'image/jpeg' }))
    }, 'image/jpeg', FRAME_QUALITY)
  })
}

/** One running clip recording; stopping it yields the encoded file. */
export interface ClipRecorder {
  /** Encoded media type the browser chose for this clip. */
  readonly mediaType: string
  /** Stop the recording and resolve its bytes. */
  stop(): Promise<File>
}

/**
 * The first container this browser can record, preferring WebM's VP9 then VP8
 * and falling back to MP4 where Safari only offers that.
 * @returns the media type handed to `MediaRecorder`, or null when the browser
 * records no video at all.
 */
export function clipMediaType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const candidate of [
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4',
  ]) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate
  }
  return null
}

/**
 * Start recording the live stream into one video file.
 * @param stream - the camera stream the dialog already holds.
 * @param name - display name of the produced file; the extension follows the
 * container the browser records.
 * @returns the running recorder; its `stop()` resolves the encoded clip.
 * @throws {CameraError} `unavailable` when this browser records no video.
 */
export function startClipRecorder(stream: MediaStream, name: string): ClipRecorder {
  const mediaType = clipMediaType()
  if (mediaType === null) throw new CameraError('unavailable')
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream, { mimeType: mediaType })
  recorder.addEventListener('dataavailable', (event: BlobEvent) => {
    if (event.data.size > 0) chunks.push(event.data)
  })
  const stopped = new Promise<File>((resolve) => {
    recorder.addEventListener('stop', () => {
      const type = mediaType.split(';', 1)[0] ?? 'video/webm'
      const extension = type === 'video/mp4' ? 'mp4' : 'webm'
      resolve(new File(chunks, `${name}.${extension}`, { type }))
    })
  })
  recorder.start()
  return {
    mediaType,
    stop: () => {
      recorder.stop()
      return stopped
    },
  }
}

/**
 * Format elapsed recording time as `m:ss`.
 * @param ms - elapsed milliseconds.
 * @returns the clock reading shown inside the recording pill.
 */
export function elapsedLabel(ms: number): string {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
