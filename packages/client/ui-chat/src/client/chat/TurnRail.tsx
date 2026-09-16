import { memo, useId, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
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
/** Floor: one tick's own height, where neighbouring ticks just touch. */
const MIN_PITCH_PX = 2

type RailStyle = CSSProperties & {
  readonly '--dsh-turn-pitch': string
  readonly '--dsh-turn-band': string
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
 * Mark under a pointer position.
 *
 * The rail owns pointer input for its whole column: a 2px tick is not a
 * pointer target, so the index is computed from the pointer's offset rather
 * than hit-tested against the ticks, which stay `pointer-events: none`. One
 * rect read per gesture, never per frame.
 * @param marks - the rendered ladder.
 * @param rail - the element the pointer event landed on.
 * @param clientY - the pointer's viewport y.
 * @returns the nearest mark, or undefined when the ladder is empty.
 */
function markAtPointer(
  marks: readonly TurnRailMark[],
  rail: HTMLElement,
  clientY: number,
): TurnRailMark | undefined {
  const rect = rail.getBoundingClientRect()
  // The same pitch the ticks are placed with, so a click resolves to the tick
  // under the pointer rather than to a neighbour.
  const index = Math.round((clientY - rect.top) / pitchFor(marks.length))
  return marks[Math.max(0, Math.min(marks.length - 1, index))]
}

function TurnRailLadder({ marks, activeTurn, onNavigate, t }: TurnRailProps) {
  const [previewTurn, setPreviewTurn] = useState<number | null>(null)
  const previewId = useId()

  // One mark is the whole session: there is nothing to navigate between.
  if (marks.length < 2) return null

  const pitch = pitchFor(marks.length)
  const style: RailStyle = {
    '--dsh-turn-pitch': `${String(pitch)}px`,
    '--dsh-turn-band': `${String((marks.length - 1) * pitch)}px`,
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
          const mark = markAtPointer(marks, event.currentTarget, event.clientY)
          if (mark !== undefined) onNavigate(mark)
        }}
        onPointerMove={(event: PointerEvent<HTMLElement>) => {
          const mark = markAtPointer(marks, event.currentTarget, event.clientY)
          setPreviewTurn(mark?.turn ?? null)
        }}
        onPointerLeave={() => { setPreviewTurn(null) }}
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
              style={{ top: `${String(index * pitch)}px` }}
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
            style={{ top: `${String(previewIndex * pitch)}px` }}
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
