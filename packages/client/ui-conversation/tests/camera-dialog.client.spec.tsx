// @vitest-environment jsdom
// The composer camera popup: stream lifecycle (one camera per open, released on
// close and on flip), the two refusal sentences, the still path into the draft,
// and a clip's sampled frames with their review. The camera, the canvas, and the
// object-URL table are stubs; jsdom has no capture or encoder of its own.

import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@aeven/client-test-runtime'
import { zh as commonZh } from '@aeven/client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { CameraDialog } from '../src/client/input/camera/CameraDialog.tsx'
import { COUNTDOWN_SECONDS, MAX_CLIP_MS } from '../src/client/input/camera/capture.ts'

const t = makeTranslate(zh, commonZh)

/**
 * jsdom has no MediaRecorder: this one records a fixed WebM chunk, so the
 * dialog's own start/stop choreography is what the cases observe.
 */
class FakeRecorder {
  static isTypeSupported = (type: string): boolean => type === 'video/webm'

  static instances: FakeRecorder[] = []

  state = 'inactive'

  private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly stream: MediaStream, readonly options: { mimeType: string }) {
    FakeRecorder.instances.push(this)
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener])
  }

  start(): void { this.state = 'recording' }

  stop(): void {
    this.state = 'inactive'
    this.emit('dataavailable', { data: new Blob(['clip-bytes'], { type: 'video/webm' }) })
    this.emit('stop', {})
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

/** One fake camera track: the dialog must stop it when the stream leaves. */
function tracks(): { stop: ReturnType<typeof vi.fn> }[] {
  return [{ stop: vi.fn() }]
}

function stream(live = tracks()): MediaStream {
  return { getTracks: () => live } as unknown as MediaStream
}

/** The capture call the camera path makes, so its spies record typed constraints. */
type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>

function provideCamera(getUserMedia: GetUserMedia): Mock<GetUserMedia> {
  const spy = vi.fn<GetUserMedia>(getUserMedia)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: spy } })
  return spy
}

/** The canvas face the encoder draws through; jsdom implements none of it. */
function drawingContext(): CanvasRenderingContext2D {
  return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
}

/** Serve a JPEG encoder the capture path can await; null makes encoding fail. */
function encode(blob: Blob | null = new Blob(['frame'], { type: 'image/jpeg' })): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(drawingContext())
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => { callback(blob) })
}

function frameSize(width: number, height: number): void {
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => width })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => height })
}

beforeEach(() => {
  // jsdom's media surface: an assignment target for `srcObject`, a resolved
  // `play`, and an object-URL table the review thumbnails can cite.
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, writable: true, value: null })
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  URL.createObjectURL = vi.fn(() => 'blob:sample')
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  FakeRecorder.instances = []
  URL.revokeObjectURL = vi.fn()
  frameSize(640, 480)
  encode()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'mediaDevices')
})

function renderDialog(over: Partial<ComponentProps<typeof CameraDialog>> = {}) {
  const onCapture = vi.fn()
  const onClose = vi.fn()
  const props = { open: true, onClose, onCapture, onCaptureClip: vi.fn(), canRecordClip: true, t, ...over }
  const view = render(<CameraDialog {...props} />)
  return { view, props, onCapture, onClose }
}

/** Let the camera request settle inside React's act window. */
async function settle(): Promise<void> {
  await act(async () => {})
}

/** Advance the popup's own timers by `seconds`, one act per second. */
async function wait(seconds: number): Promise<void> {
  for (let index = 0; index < seconds; index++) {
    await act(async () => { vi.advanceTimersByTime(1000) })
  }
}

async function openCameraWith(over: Partial<ComponentProps<typeof CameraDialog>> = {}) {
  const harness = renderDialog(over)
  await settle()
  return harness
}

describe('CameraDialog', () => {
  it('asks for no camera while it is closed', async () => {
    const getUserMedia = provideCamera(() => Promise.resolve(stream()))
    renderDialog({ open: false })
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('opens the front camera and releases it when the popup closes', async () => {
    const live = tracks()
    const getUserMedia = provideCamera(() => Promise.resolve(stream(live)))
    const { view, props } = await openCameraWith()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia.mock.calls[0]?.[0]).toMatchObject({ video: { facingMode: 'user' }, audio: true })
    expect(screen.getByRole('dialog', { name: '相机' })).toBeTruthy()
    view.rerender(<CameraDialog {...props} open={false} />)
    expect(live[0]?.stop).toHaveBeenCalledOnce()
  })

  it('says it is waiting until the stream plays', async () => {
    let start: () => void = () => {}
    HTMLMediaElement.prototype.play = vi.fn(() => new Promise<void>((resolve) => { start = resolve }))
    provideCamera(() => Promise.resolve(stream()))
    await openCameraWith()
    expect(screen.getByRole('status').textContent).toContain('正在等待摄像头')
    await act(async () => { start() })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('releases the previous stream and asks for the other camera when flipped', async () => {
    const live = tracks()
    const getUserMedia = provideCamera(() => Promise.resolve(stream(live)))
    await openCameraWith()
    fireEvent.click(screen.getByLabelText('切换摄像头'))
    await settle()
    expect(live[0]?.stop).toHaveBeenCalled()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(getUserMedia.mock.calls[1]?.[0]).toMatchObject({ video: { facingMode: 'environment' }, audio: true })
  })

  it('surfaces a denied permission and asks again on retry', async () => {
    const getUserMedia = provideCamera(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
    await openCameraWith()
    expect(screen.getByRole('alert').textContent).toContain('摄像头权限被拒绝')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await settle()
    // Each open asks with sound, then retries silent after the refusal.
    expect(getUserMedia).toHaveBeenCalledTimes(4)
  })

  it('surfaces a browser without a camera', async () => {
    Reflect.deleteProperty(navigator, 'mediaDevices')
    await openCameraWith()
    expect(screen.getByRole('alert').textContent).toContain('当前浏览器没有可用的摄像头')
  })

  it('counts down from three, reviews the still, and keeps the popup open', async () => {
    vi.useFakeTimers()
    provideCamera(() => Promise.resolve(stream()))
    const { onCapture, onClose } = await openCameraWith()
    fireEvent.click(screen.getByLabelText('拍照'))
    expect(screen.getByText('3')).toBeTruthy()
    await wait(1)
    expect(screen.getByText('2')).toBeTruthy()
    // The shutter now offers the way out of the count instead of the capture.
    fireEvent.click(screen.getByLabelText('取消倒计时'))
    expect(screen.queryByText('2')).toBeNull()
    fireEvent.click(screen.getByLabelText('拍照'))
    await wait(COUNTDOWN_SECONDS)
    // The still waits for Use; nothing reaches the draft on its own, and the
    // review wears the preview's own framing and mirror.
    const review = screen.getByRole('img', { name: '拍摄预览' })
    expect(review.getAttribute('data-mirrored')).toBe('')
    expect(onCapture).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '使用' }))
    expect(onCapture).toHaveBeenCalledExactlyOnceWith([expect.any(File)])
    const [files] = onCapture.mock.calls[0] as [File[]]
    expect(files[0]?.type).toBe('image/jpeg')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('takes the still at once when the countdown is turned off', async () => {
    provideCamera(() => Promise.resolve(stream()))
    const { onCapture } = await openCameraWith()
    expect(screen.getByLabelText('倒计时').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByLabelText('倒计时'))
    expect(screen.getByLabelText('倒计时').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByLabelText('拍照'))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: '使用' }))
    expect(onCapture).toHaveBeenCalledExactlyOnceWith([expect.any(File)])
  })

  it('reports a still the browser could not encode', async () => {
    provideCamera(() => Promise.resolve(stream()))
    frameSize(0, 0)
    const { onCapture } = await openCameraWith()
    fireEvent.click(screen.getByLabelText('倒计时'))
    fireEvent.click(screen.getByLabelText('拍照'))
    await settle()
    expect(screen.getByRole('alert').textContent).toContain('画面拍摄失败')
    expect(onCapture).not.toHaveBeenCalled()
  })

  it('records the clip itself and hands the video file over on Use', async () => {
    provideCamera(() => Promise.resolve(stream()))
    const onCaptureClip = vi.fn()
    const { onCapture, onClose } = await openCameraWith({ onCaptureClip })
    fireEvent.click(screen.getByRole('button', { name: '视频' }))
    fireEvent.click(screen.getByLabelText('录制视频'))
    expect(FakeRecorder.instances.at(-1)?.options.mimeType).toBe('video/webm')
    expect(screen.getByRole('status').textContent).toContain('0:00')
    fireEvent.click(screen.getByLabelText('停止录制'))
    await settle()
    // The review plays the recorded bytes under the preview's crop and mirror.
    const review = screen.getByLabelText('拍摄预览')
    expect(review.getAttribute('data-mirrored')).toBe('')
    expect(review.getAttribute('data-fit')).toBe('cover')
    fireEvent.click(screen.getByRole('button', { name: '使用' }))
    const [file] = onCaptureClip.mock.calls[0] as [File]
    expect(file.name.endsWith('.webm')).toBe(true)
    expect(file.type).toBe('video/webm')
    expect(onCapture).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('stops a clip by itself at the recording cap', async () => {
    vi.useFakeTimers()
    provideCamera(() => Promise.resolve(stream()))
    await openCameraWith()
    fireEvent.click(screen.getByRole('button', { name: '视频' }))
    fireEvent.click(screen.getByLabelText('录制视频'))
    await act(async () => { vi.advanceTimersByTime(MAX_CLIP_MS) })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: '使用' })).toBeTruthy()
  })

  it('retakes a reviewed clip, clearing it', async () => {
    provideCamera(() => Promise.resolve(stream()))
    await openCameraWith()
    fireEvent.click(screen.getByRole('button', { name: '视频' }))
    fireEvent.click(screen.getByLabelText('录制视频'))
    fireEvent.click(screen.getByLabelText('停止录制'))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: '重拍' }))
    expect(screen.queryByRole('button', { name: '使用' })).toBeNull()
    expect(screen.getByLabelText('录制视频')).toBeTruthy()
  })

  it('offers no clip mode where the draft cannot carry a video', async () => {
    provideCamera(() => Promise.resolve(stream()))
    await openCameraWith({ canRecordClip: false })
    expect(screen.getByRole('button', { name: '视频' }).getAttribute('disabled')).not.toBeNull()
  })

  it('leaves without capturing through the close disc', async () => {
    provideCamera(() => Promise.resolve(stream()))
    const { onCapture, onClose } = await openCameraWith()
    fireEvent.click(screen.getByRole('button', { name: '关闭相机' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onCapture).not.toHaveBeenCalled()
  })

  it('reopens on the photo mode with an empty clip', async () => {
    vi.useFakeTimers()
    provideCamera(() => Promise.resolve(stream()))
    const { view, props } = await openCameraWith()
    fireEvent.click(screen.getByRole('button', { name: '视频' }))
    expect(screen.getByLabelText('录制视频')).toBeTruthy()
    view.rerender(<CameraDialog {...props} open={false} />)
    view.rerender(<CameraDialog {...props} open />)
    await settle()
    expect(screen.getByLabelText('拍照')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '使用' })).toBeNull()
  })
})
