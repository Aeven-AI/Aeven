/**
 * The live device screen, ported from t3code's DeviceStreamView.
 *
 * Pointer events map onto normalized coordinates in the displayed frame and go
 * to the device; keys are forwarded while the screen has focus. A hidden pane
 * (`visible` false) tears the stream down, so it decodes nothing.
 */
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconLucideSmartphone, Spinner } from '@aeven/client-ui-primitives'
import type { DevicePlatform } from '@aeven/device/types'
import type { DeviceTranslate } from './controls.tsx'
import type { DeviceHubAccess } from './hub-access.ts'
import { type DeviceAxElement, fetchDeviceAxTree } from './hub-api.ts'
import {
  createDeviceStreamClient,
  type DeviceHardwareButton, type DeviceScreenSize, type DeviceStreamClient, type DeviceStreamStatus,
} from './stream.ts'
import css from './DevicePane.module.css'

/** Accessibility tree poll interval while the overlay is on, in ms. */
const AX_POLL_INTERVAL_MS = 2_000

/** What the pane's control row drives on the open device. */
export interface DeviceStreamHandle {
  readonly pressButton: (button: DeviceHardwareButton) => void
  readonly rotate: () => void
  /** False while the input socket is down; controls disable. */
  readonly inputConnected: boolean
}

/**
 * The loading and failure card shared by opening and streaming.
 * @param props - the device, the stage reached, and the message.
 * @returns the card.
 */
export function DeviceLoading(props: {
  readonly t: DeviceTranslate
  readonly name: string
  readonly description?: string | undefined
  readonly stage: 'opening' | 'stream'
  readonly message: string
  readonly error?: boolean
  readonly children?: ReactNode
}): ReactNode {
  return (
    <div className={css.loading} role={props.error === true ? 'alert' : 'status'}>
      <div className={css.loadingCard}>
        <span className={css.loadingGlyph}><IconLucideSmartphone /></span>
        <p className={css.loadingName}>{props.name}</p>
        {props.description !== undefined && props.description !== '' && <p className={css.loadingDescription}>{props.description}</p>}
        <p className={css.loadingMessage} data-error={props.error === true || undefined}>
          {props.error !== true && <Spinner />}
          <span>{props.message}</span>
        </p>
        {props.children}
        {props.error !== true && (
          <div className={css.steps} aria-label={props.stage === 'opening' ? props.t('stepOpen') : props.t('stepStream')}>
            <span className={css.step} data-done="" />
            <span className={css.step} data-done={props.stage === 'stream' || undefined} />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Render one device's live screen.
 * @param props - the device, its hub access, and callbacks.
 * @returns the screen.
 */
export function DeviceStream(props: {
  readonly t: DeviceTranslate
  readonly access: DeviceHubAccess
  readonly platform: DevicePlatform
  readonly deviceId: string
  readonly deviceName: string
  readonly deviceDescription: string
  readonly visible: boolean
  readonly axOverlay: boolean
  readonly onHandle: (handle: DeviceStreamHandle | null) => void
}): ReactNode {
  const { t, access, onHandle } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const clientRef = useRef<DeviceStreamClient | null>(null)
  const [status, setStatus] = useState<DeviceStreamStatus>('connecting')
  const [detail, setDetail] = useState<string | undefined>(undefined)
  const [unauthorized, setUnauthorized] = useState(false)
  const [screen, setScreen] = useState<DeviceScreenSize | null>(null)
  const [mjpegUrl, setMjpegUrl] = useState<string | null>(null)
  const [mjpegGeneration, setMjpegGeneration] = useState(0)
  const [inputConnected, setInputConnected] = useState(false)
  const attachMjpegImage = useCallback((image: HTMLImageElement | null) => {
    clientRef.current?.setMjpegImage(image)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || !props.visible) {
      setStatus('connecting')
      onHandle(null)
      return undefined
    }
    const client = createDeviceStreamClient({ platform: props.platform, deviceId: props.deviceId, access }, canvas, {
      onStatus: (next, nextDetail) => {
        setStatus(next)
        setDetail(nextDetail)
      },
      onScreen: setScreen,
      onUnauthorized: () => { setUnauthorized(true) },
      onMjpegFallback: (url) => {
        setMjpegUrl(url)
        setMjpegGeneration(generation => generation + 1)
      },
      onInputConnected: (connected) => {
        setInputConnected(connected)
        onHandle({ pressButton: client.pressButton, rotate: client.rotate, inputConnected: connected })
      },
    })
    clientRef.current = client
    setMjpegUrl(null)
    setUnauthorized(false)
    setInputConnected(false)
    client.start()
    onHandle({ pressButton: client.pressButton, rotate: client.rotate, inputConnected: false })
    return () => {
      client.stop()
      clientRef.current = null
      onHandle(null)
      setScreen(null)
    }
  }, [access, onHandle, props.deviceId, props.platform, props.visible])

  // Displayed aspect ratio (width / height) of the device as the user sees it.
  const aspect = useMemo(() => {
    if (screen === null) return props.platform === 'ios' ? 9 / 19.5 : 9 / 20
    const landscape = screen.orientation === 'landscape_left' || screen.orientation === 'landscape_right'
    const long = Math.max(screen.width, screen.height)
    const short = Math.min(screen.width, screen.height)
    return landscape ? long / short : short / long
  }, [props.platform, screen])

  // The frame is the largest box at `aspect` that fits the host, so a narrow
  // pane shows a smaller phone rather than a squeezed one.
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [host, setHost] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = hostRef.current
    if (element === null) return undefined
    const update = (): void => {
      const style = getComputedStyle(element)
      const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const height = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      setHost(current => current.width === width && current.height === height ? current : { width, height })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])
  const frame = useMemo(() => {
    if (host.width <= 0 || host.height <= 0) return { width: 0, height: 0 }
    const byHeight = { width: host.height * aspect, height: host.height }
    return byHeight.width <= host.width ? byHeight : { width: host.width, height: host.width / aspect }
  }, [aspect, host])

  // serve-sim streams the raw framebuffer; a device reporting landscape while
  // its frames stay portrait is rotated for display.
  const rotation = useMemo(() => {
    if (props.platform !== 'ios' || screen === null || screen.width > screen.height) return 0
    switch (screen.orientation) {
      case 'landscape_left': return 90
      case 'landscape_right': return -90
      case 'portrait_upside_down': return 180
      case 'portrait': return 0
    }
  }, [props.platform, screen])
  const sideways = rotation === 90 || rotation === -90
  const mediaStyle: CSSProperties = sideways
    ? {
      width: frame.height,
      height: frame.width,
      left: (frame.width - frame.height) / 2,
      top: (frame.height - frame.width) / 2,
      transform: `rotate(${String(rotation)}deg)`,
    }
    : { width: frame.width, height: frame.height, ...rotation === 0 ? {} : { transform: `rotate(${String(rotation)}deg)` } }

  // The accessibility tree is polled while the overlay is on; each poll is one
  // JSON fetch, so there is nothing to repaint between polls.
  const [axElements, setAxElements] = useState<readonly DeviceAxElement[]>([])
  useEffect(() => {
    if (!props.axOverlay || !props.visible) return undefined
    const target = { access, platform: props.platform, deviceId: props.deviceId }
    let controller: AbortController | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const poll = async (): Promise<void> => {
      controller = new AbortController()
      try {
        const tree = await fetchDeviceAxTree(target, controller.signal)
        if (!stopped) setAxElements(tree.elements)
      } catch {
        // Keep the last good tree; the next poll retries.
      }
      if (!stopped) timer = setTimeout(() => { void poll() }, AX_POLL_INTERVAL_MS)
    }
    void poll()
    return () => {
      stopped = true
      controller?.abort()
      if (timer !== null) clearTimeout(timer)
      setAxElements([])
    }
  }, [access, props.axOverlay, props.deviceId, props.platform, props.visible])

  const pointerActive = useRef(false)
  const point = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }
  const end = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!pointerActive.current) return
    pointerActive.current = false
    const { x, y } = point(event)
    clientRef.current?.sendTouch('end', x, y)
  }

  return (
    <div
      ref={hostRef}
      className={css.screenHost}
      tabIndex={0}
      role="application"
      aria-label={t(props.platform === 'ios' ? 'screen.ios' : 'screen.android')}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.metaKey && event.key !== 'r' && event.key !== 'R') return
        event.preventDefault()
        clientRef.current?.sendKey(event.nativeEvent, 'down')
      }}
      onKeyUp={(event) => {
        if (event.target !== event.currentTarget) return
        clientRef.current?.sendKey(event.nativeEvent, 'up')
      }}
    >
      <div
        className={css.frame}
        style={{ width: frame.width, height: frame.height }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          hostRef.current?.focus()
          pointerActive.current = true
          const { x, y } = point(event)
          clientRef.current?.sendTouch('begin', x, y)
        }}
        onPointerMove={(event) => {
          if (!pointerActive.current) return
          const { x, y } = point(event)
          clientRef.current?.sendTouch('move', x, y)
        }}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <canvas ref={canvasRef} className={css.media} hidden={mjpegUrl !== null} style={mediaStyle} />
        {props.visible && mjpegUrl !== null && (
          <img key={mjpegGeneration} ref={attachMjpegImage} alt="" draggable={false} className={css.media} style={mediaStyle} />
        )}
        {axElements.length > 0 && (
          <div className={css.axLayer} aria-hidden>
            {axElements.map(element => (
              <div
                key={element.id}
                className={css.axBox}
                style={{
                  left: `${String(element.x * 100)}%`,
                  top: `${String(element.y * 100)}%`,
                  width: `${String(element.width * 100)}%`,
                  height: `${String(element.height * 100)}%`,
                }}
              >
                {element.label !== '' && <span className={css.axLabel}>{element.label}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      {status === 'streaming' && !inputConnected && (
        <div className={css.inputBanner}><span>{t('inputDisconnected')}</span></div>
      )}
      {status !== 'streaming' && (
        <div className={css.overlay}>
          <DeviceLoading
            t={t}
            name={props.deviceName}
            description={props.deviceDescription}
            stage="stream"
            message={unauthorized ? t('signedOut') : status === 'error' ? detail ?? t('streamFailed') : t('connectingVideo')}
            error={unauthorized || status === 'error'}
          >
            {status === 'error' && !unauthorized && (
              <button
                type="button"
                className={css.chip}
                onClick={() => {
                  clientRef.current?.stop()
                  clientRef.current?.start()
                }}
              >
                {t('reconnect')}
              </button>
            )}
          </DeviceLoading>
        </div>
      )}
    </div>
  )
}
