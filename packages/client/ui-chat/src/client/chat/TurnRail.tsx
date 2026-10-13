import { memo, useId, useMemo, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { TurnRailMark } from './turn-rail-marks.ts'
import css from './TurnRail.module.css'

interface TurnRailProps {
  readonly marks: readonly TurnRailMark[]
  /** Turn at the reader's line, from the parent's intersection tracking. */
  readonly activeTurn: number | null
  /** Jump to a mark: scroll locally when loaded, anchor a new window otherwise. */
  readonly onNavigate: (mark: TurnRailMark) => void
  readonly t: ChatViewSlotProps['t']
}

/** Rail band height; the ladder divides this, so the rail never scrolls itself. */
const BAND_PX = 420
/** Comfortable spacing, used until the ladder would outgrow the band. */
const MAX_PITCH_PX = 10
/** Floor: a 1px line and a 1px gap, where neighbouring ticks stay distinct. */
const MIN_PITCH_PX = 2
/**
 * Spacing the hover magnifier restores around the pointer when the ladder is
 * packed tighter: enough for a 1px line to read as one turn under the pointer.
 */
const LENS_PITCH_PX = 8
/** Largest magnification the lens applies, so a sparse ladder is never distorted. */
const MAX_LENS_GAIN = 8

type RailStyle = CSSProperties & {
  readonly '--avn-turn-pitch': string
  readonly '--avn-turn-band': string
}

/**
 * Pitch for a mark count: comfortable while the ladder fits, tightening to the
 * tick width before the band is full. Sampling caps the count, so the ladder
 * always fits and the rail needs no scrolling of its own.
 * @param count - marks the rail will render.
 * @returns pixels between neighbouring mark centres.
 */
function pitchFor(count: number): number {
  if (count < 2) return MAX_PITCH_PX
  return Math.max(MIN_PITCH_PX, Math.min(MAX_PITCH_PX, BAND_PX / (count - 1)))
}

/**
 * The pointer's place along the band, as a fraction from first to last mark.
 * @param rail - the element the pointer event landed on.
 * @param clientY - the pointer's viewport y.
 * @returns a fraction clamped to `[0, 1]`.
 */
function pointerFraction(rail: HTMLElement, clientY: number): number {
  const rect = rail.getBoundingClientRect()
  return rect.height <= 0 ? 0 : Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
}

/**
 * Mark at a band fraction.
 *
 * The rail owns pointer input for its whole column: a 1px line is not a
 * pointer target, so the mark comes from the pointer's place along the band
 * rather than from hit-testing the ticks, which stay `pointer-events: none`.
 * The magnifier keeps the band point under the pointer fixed, so this is also
 * the tick drawn under the pointer.
 * @param marks - the rendered ladder.
 * @param fraction - the pointer's band fraction.
 * @returns the nearest mark, or undefined when the ladder is empty.
 */
function markAtFraction(marks: readonly TurnRailMark[], fraction: number): TurnRailMark | undefined {
  return marks[Math.round(fraction * (marks.length - 1))]
}

/**
 * Sarkar–Brown fisheye over `[0, 1]`: the focus stays put, both ends stay put,
 * and the neighbourhood of the focus is stretched by `gain`.
 * @param x - the undistorted position.
 * @param focus - the fixed point, the pointer's band fraction.
 * @param gain - the extra magnification at the focus (0 is none).
 * @returns the distorted position.
 */
function fisheye(x: number, focus: number, gain: number): number {
  const stretch = (t: number): number => ((gain + 1) * t) / (gain * t + 1)
  if (x >= focus) return focus + (1 - focus) * (focus === 1 ? 0 : stretch((x - focus) / (1 - focus)))
  return focus - focus * stretch((focus - x) / focus)
}

/**
 * Tick offsets for the ladder: an even pitch at rest, and around the pointer a
 * magnifier that restores {@link LENS_PITCH_PX} when the ladder is packed
 * tighter, so a session with hundreds of turns still reads under the pointer.
 * @param count - marks the rail renders.
 * @param pitch - the resting pitch.
 * @param focus - the pointer's band fraction, or null when it is off the rail.
 * @returns each mark's offset from the top of the band, in pixels.
 */
function tickOffsets(count: number, pitch: number, focus: number | null): number[] {
  const band = (count - 1) * pitch
  const gain = focus === null || pitch >= LENS_PITCH_PX
    ? 0
    : Math.min(MAX_LENS_GAIN, LENS_PITCH_PX / pitch - 1)
  return Array.from({ length: count }, (_, index) => {
    const at = count < 2 ? 0 : index / (count - 1)
    return band * (gain === 0 || focus === null ? at : fisheye(at, focus, gain))
  })
}

function TurnRailLadder({ marks, activeTurn, onNavigate, t }: TurnRailProps) {
  const [previewTurn, setPreviewTurn] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const previewId = useId()
  const pitch = pitchFor(marks.length)
  const offsets = useMemo(() => tickOffsets(marks.length, pitch, focus), [marks.length, pitch, focus])

  // One mark is the whole session: there is nothing to navigate between.
  if (marks.length < 2) return null

  const style: RailStyle = {
    '--avn-turn-pitch': `${String(pitch)}px`,
    '--avn-turn-band': `${String((marks.length - 1) * pitch)}px`,
  }
  const preview = marks.find(mark => mark.turn === previewTurn)
  const previewIndex = preview === undefined ? -1 : marks.indexOf(preview)

  return (
    <div className={css.slot}>
      <nav
        className={css.rail}
        style={style}
        aria-label={t('chat.turnNavigation.label')}
        onClick={(event: MouseEvent<HTMLElement>) => {
          const mark = markAtFraction(marks, pointerFraction(event.currentTarget, event.clientY))
          if (mark !== undefined) onNavigate(mark)
        }}
        onPointerMove={(event: PointerEvent<HTMLElement>) => {
          const fraction = pointerFraction(event.currentTarget, event.clientY)
          setFocus(fraction)
          setPreviewTurn(markAtFraction(marks, fraction)?.turn ?? null)
        }}
        onPointerLeave={() => {
          setFocus(null)
          setPreviewTurn(null)
        }}
      >
        {marks.map((mark, index) => {
          const active = mark.turn === activeTurn
          const classes = [css.tick]
          if (active) classes.push(css.tickActive)
          else if (mark.turn === previewTurn) classes.push(css.tickPreview)
          if (!mark.loaded) classes.push(css.tickUnloaded)
          return (
            <button
              key={mark.seq}
              type="button"
              className={classes.join(' ')}
              style={{ top: `${String(offsets[index] ?? 0)}px` }}
              aria-label={t(mark.loaded ? 'chat.turnNavigation.jump' : 'chat.turnNavigation.jumpLoad', { turn: mark.turn })}
              aria-current={active ? 'true' : undefined}
              aria-describedby={mark.turn === previewTurn ? previewId : undefined}
              onClick={(event) => {
                event.stopPropagation()
                onNavigate(mark)
              }}
              onFocus={() => { setPreviewTurn(mark.turn) }}
              onBlur={() => { setPreviewTurn(null) }}
            />
          )
        })}
        {preview !== undefined && (
          <div
            id={previewId}
            role="tooltip"
            className={css.preview}
            style={{ top: `${String(offsets[previewIndex] ?? 0)}px` }}
          >
            <div className={css.previewPrompt}>
              {preview.prompt === ''
                ? t('chat.turnNavigation.turn', { turn: preview.turn })
                : preview.prompt}
            </div>
            {preview.response !== '' && (
              <div className={css.previewResponse}>{preview.response}</div>
            )}
          </div>
        )}
      </nav>
    </div>
  )
}

/**
 * Fixed-pitch tick ladder over every turn of the session: loaded turns scroll,
 * unloaded turns anchor a window on their `turn/start` seq first. Hovering or
 * focusing a tick shows that turn's prompt and response previews.
 *
 * Memoized because it renders one host element per mark while the enclosing
 * view re-renders on every streaming delta; its props must stay referentially
 * stable across those commits.
 */
export const TurnRail = memo(TurnRailLadder)
