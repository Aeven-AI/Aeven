// @vitest-environment jsdom
// Capture helpers: the two camera-open failure kinds, frame encoding, and the
// recording clock. Canvas and camera are stubs — jsdom has neither — so these
// cases assert the helper contracts, not the browser's device behavior.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CameraError, clipMediaType, elapsedLabel, grabFrame, openCamera, startClipRecorder,
} from '../src/client/input/camera/capture.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'mediaDevices')
})

/** A recorder the capture path constructs, driven by the test. */
class StubMediaRecorder {
  static supported: string[] = []

  static isTypeSupported = (type: string): boolean => StubMediaRecorder.supported.includes(type)

  private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly stream: MediaStream, readonly options: { mimeType: string }) {}

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener])
  }

  start(): void {}

  stop(): void {
    for (const data of [new Blob(['one'], { type: 'video/webm' }), new Blob([])]) {
      for (const listener of this.listeners.get('dataavailable') ?? []) listener({ data })
    }
    for (const listener of this.listeners.get('stop') ?? []) listener({})
  }
}

function videoWith(width: number, height: number): HTMLVideoElement {
  const element = document.createElement('video')
  Object.defineProperty(element, 'videoWidth', { value: width })
  Object.defineProperty(element, 'videoHeight', { value: height })
  return element
}

/** The capture call the camera path makes, so its mocks record typed constraints. */
type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>

function cameraDevices(getUserMedia: GetUserMedia): void {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
}

function canvasYielding(blob: Blob | null, context: CanvasRenderingContext2D | null): {
  toBlob: ReturnType<typeof vi.fn>
} {
  const toBlob = vi.fn((callback: BlobCallback) => { callback(blob) })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob)
  return { toBlob }
}

function drawingContext(drawImage: ReturnType<typeof vi.fn>): CanvasRenderingContext2D {
  return { drawImage } as unknown as CanvasRenderingContext2D
}

describe('openCamera', () => {
  it('reports an unavailable camera when the browser exposes no capture API', async () => {
    Reflect.deleteProperty(navigator, 'mediaDevices')
    await expect(openCamera('user')).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('asks for the requested facing direction with sound and hands back the live stream', async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream
    const getUserMedia = vi.fn<GetUserMedia>(() => Promise.resolve(stream))
    cameraDevices(getUserMedia)
    await expect(openCamera('environment')).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia.mock.calls[0]?.[0]).toMatchObject({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: true,
    })
  })

  it('records silent rather than not at all when the microphone is refused', async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream
    const getUserMedia = vi.fn<GetUserMedia>()
      .mockRejectedValueOnce(new DOMException('no mic', 'NotFoundError'))
      .mockResolvedValueOnce(stream)
    cameraDevices(getUserMedia)
    await expect(openCamera('user')).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(getUserMedia.mock.calls[1]?.[0]).toMatchObject({ video: { facingMode: 'user' }, audio: false })
  })

  it('separates a denied permission from a missing device', async () => {
    cameraDevices(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
    await expect(openCamera('user')).rejects.toMatchObject({ kind: 'permission' })
    cameraDevices(() => Promise.reject(new Error('no camera at all')))
    await expect(openCamera('user')).rejects.toMatchObject({ kind: 'unavailable' })
    cameraDevices(() => Promise.reject(new DOMException('insecure', 'SecurityError')))
    await expect(openCamera('user')).rejects.toMatchObject({ kind: 'permission' })
    cameraDevices(() => Promise.reject(new DOMException('no device', 'NotFoundError')))
    await expect(openCamera('user')).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('treats a non-DOM rejection as an unavailable camera', async () => {
    cameraDevices(() => Promise.reject(new Error('not a DOMException')))
    const failure = await openCamera('user').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CameraError)
    expect(failure).toMatchObject({ kind: 'unavailable' })
  })
})

describe('grabFrame', () => {
  it('refuses before the stream has delivered a frame', async () => {
    canvasYielding(null, null)
    await expect(grabFrame(videoWith(0, 0), 'photo.jpg')).rejects.toThrow('no frame yet')
  })

  it('refuses when the canvas has no 2d context', async () => {
    canvasYielding(null, null)
    await expect(grabFrame(videoWith(640, 480), 'photo.jpg')).rejects.toThrow('no 2d context')
  })

  it('refuses when the browser cannot encode the frame', async () => {
    canvasYielding(null, drawingContext(vi.fn()))
    await expect(grabFrame(videoWith(640, 480), 'photo.jpg')).rejects.toThrow('unencoded frame')
  })

  it('draws the frame at its own size and hands back a JPEG file', async () => {
    const drawImage = vi.fn()
    const { toBlob } = canvasYielding(new Blob(['pixels'], { type: 'image/jpeg' }), drawingContext(drawImage))
    const video = videoWith(640, 480)
    const file = await grabFrame(video, 'clip-frame-1.jpg')
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('clip-frame-1.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(video, 0, 0, 640, 480)
    expect(toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'image/jpeg', 0.9)
  })
})

describe('startClipRecorder', () => {
  const stream = { getTracks: () => [] } as unknown as MediaStream

  it('reports no recordable container when the browser has no MediaRecorder', () => {
    vi.stubGlobal('MediaRecorder', undefined)
    expect(clipMediaType()).toBeNull()
  })

  it('prefers VP9 and falls back through the recordable containers', () => {
    vi.stubGlobal('MediaRecorder', StubMediaRecorder)
    StubMediaRecorder.supported = ['video/mp4']
    expect(clipMediaType()).toBe('video/mp4')
    StubMediaRecorder.supported = ['video/webm;codecs=vp8,opus', 'video/webm']
    expect(clipMediaType()).toBe('video/webm;codecs=vp8,opus')
    StubMediaRecorder.supported = []
    expect(clipMediaType()).toBeNull()
  })

  it('refuses to record where the browser records no video', () => {
    StubMediaRecorder.supported = []
    vi.stubGlobal('MediaRecorder', StubMediaRecorder)
    expect(() => startClipRecorder(stream, 'clip')).toThrow(CameraError)
  })

  it('encodes the recorded chunks as one MP4 file', async () => {
    StubMediaRecorder.supported = ['video/mp4']
    vi.stubGlobal('MediaRecorder', StubMediaRecorder)
    const recorder = startClipRecorder(stream, 'clip-1')
    expect(recorder.mediaType).toBe('video/mp4')
    const file = await recorder.stop()
    expect(file.name).toBe('clip-1.mp4')
    expect(file.type).toBe('video/mp4')
    // The empty chunk stop() emits is dropped; the clip keeps its one payload.
    expect(file.size).toBe(3)
  })

  it('names a WebM clip after its container', async () => {
    StubMediaRecorder.supported = ['video/webm;codecs=vp9,opus']
    vi.stubGlobal('MediaRecorder', StubMediaRecorder)
    const file = await startClipRecorder(stream, 'clip-2').stop()
    expect(file.name).toBe('clip-2.webm')
    expect(file.type).toBe('video/webm')
  })
})

describe('elapsedLabel', () => {
  it('reads as a minutes-and-seconds clock', () => {
    expect(elapsedLabel(0)).toBe('0:00')
    expect(elapsedLabel(5_400)).toBe('0:05')
    expect(elapsedLabel(65_000)).toBe('1:05')
    expect(elapsedLabel(3_599_999)).toBe('59:59')
  })
})
