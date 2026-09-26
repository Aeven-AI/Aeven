/** Scrolling bar waveform of the live microphone level, drawn right to left on a canvas. */
import { useEffect, useRef } from 'react'

const BAR_WIDTH = 2
const GAP = 2
const BARS_PER_SECOND = 30
const GROWTH_MS = 120
const MIN_BAR = 2
const MAX_BAR_RATIO = 0.96
const VOLUME_SMOOTHING = 0.2

interface Bar { hFinal: number; hNow: number; bornAt: number }

/** Props: the analyser of the running capture, sampled once per new bar. */
export interface WaveformProps {
  readonly analyser: AnalyserNode | undefined
  readonly className?: string | undefined
}

/**
 * Render the recorder waveform. Bars take the element's `color` over its `background-color`, so the
 * pill's theme tokens paint the canvas; a disconnected analyser reads silence and draws minimum bars.
 * @param props - analyser and class.
 * @returns the canvas inside its sizing wrapper.
 */
export function Waveform({ analyser, className }: WaveformProps) {
  const wrapper = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const source = useRef(analyser)
  source.current = analyser

  useEffect(() => {
    const box = wrapper.current, element = canvas.current
    if (!box || !element) return
    let width = 0, height = 0, context: CanvasRenderingContext2D | null = null
    let background = 'transparent', foreground = 'currentColor'
    const fit = (): void => {
      const rect = box.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      width = Math.max(1, Math.floor(rect.width))
      height = Math.max(1, Math.floor(rect.height))
      element.width = Math.floor(width * dpr)
      element.height = Math.floor(height * dpr)
      element.style.width = `${String(width)}px`
      element.style.height = `${String(height)}px`
      context = element.getContext('2d')
      context?.setTransform(dpr, 0, 0, dpr, 0, 0)
      const style = getComputedStyle(box)
      background = style.backgroundColor
      foreground = style.color
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(box)

    const bars: Bar[] = []
    const data = new Uint8Array(1024)
    let smoothed = 0, lastSpawn = performance.now(), frame = 0
    const measure = (): number => {
      const node = source.current
      if (!node) return 0
      node.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < node.fftSize; i++) {
        const v = (data[i]! - 128) / 128
        sum += v * v
      }
      smoothed = smoothed * VOLUME_SMOOTHING + Math.sqrt(sum / node.fftSize) * (1 - VOLUME_SMOOTHING)
      return smoothed
    }
    // Nonlinear boost (gamma < 1) so quiet speech still grows visible bars.
    const barHeight = (volume: number): number => {
      const maxH = height * MAX_BAR_RATIO
      return Math.max(MIN_BAR, Math.min(maxH, Math.pow(Math.min(1, volume / 0.6), 0.55) * maxH))
    }
    const tick = (ts: number): void => {
      frame = requestAnimationFrame(tick)
      if (!context || !width || !height) return
      context.fillStyle = background
      context.clearRect(0, 0, width, height)
      context.fillRect(0, 0, width, height)
      const pitch = BAR_WIDTH + GAP
      if (ts - lastSpawn >= 1000 / BARS_PER_SECOND) {
        lastSpawn = ts
        bars.push({ hFinal: barHeight(measure()), hNow: MIN_BAR, bornAt: ts })
        const maxBars = Math.ceil(width / pitch) + 12
        if (bars.length > maxBars) bars.splice(0, bars.length - maxBars)
      }
      context.fillStyle = foreground
      const startX = width - BAR_WIDTH
      for (let i = bars.length - 1; i >= 0; i--) {
        const bar = bars[i]!
        const x = startX - (bars.length - 1 - i) * pitch
        if (x + BAR_WIDTH < 0) continue
        const age = ts - bar.bornAt
        if (age < GROWTH_MS) {
          const eased = 1 - Math.pow(1 - Math.min(1, age / GROWTH_MS), 3)
          bar.hNow += (bar.hFinal - bar.hNow) * eased
        } else {
          bar.hNow = bar.hFinal
        }
        context.fillRect(x, (height - bar.hNow) / 2, BAR_WIDTH, bar.hNow)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return <div ref={wrapper} className={className}><canvas ref={canvas} /></div>
}
