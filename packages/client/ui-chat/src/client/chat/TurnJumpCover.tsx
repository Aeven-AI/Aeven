/** Content-column cover for a rail jump that is still paging history in. */
import { Spinner } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './TurnJumpCover.module.css'

/**
 * How long a jump may page before it is worth covering the transcript. One
 * round trip to the window head lands inside this window, and the busy mark's
 * own pulse already reports that wait; only a jump that outlives it — a far
 * target paging many chunks — pays for the cover.
 */
export const JUMP_COVER_DELAY_MS = 160

/** Shared with `.coverHide`: the Session-switch content loader's own fade. */
export const JUMP_COVER_FADE_MS = 400

/**
 * Cover the transcript while an unloaded Turn's jump pages history in, with the
 * same full-column plate, spinner, and fade the Session-switch content loader
 * uses: both are the same wait — the reader asked for content that is not
 * resident yet — so they read as one thing.
 *
 * Pure over the two flags. The jump's own lifecycle owns them (delay, paging,
 * settle, supersession), so this renders what that state says and nothing else:
 * `active` mounts the plate at full opacity, `hiding` fades it, and neither
 * means the reader is done.
 * @param props.active - True while the transcript should stay covered.
 * @param props.hiding - True while the cover fades out before unmounting.
 * @param props.label - Localized accessible status text.
 */
export function TurnJumpCover({ active, hiding, label }: {
  /** True while the transcript should stay covered. */
  active: boolean
  /** True while the cover fades out before unmounting. */
  hiding: boolean
  /** Localized accessible status text. */
  label: string
}) {
  if (!active && !hiding) return null
  return (
    <div
      className={hiding ? `${css.cover} ${css.coverHide}` : css.cover}
      data-turn-jump-cover=""
      data-hiding={hiding || undefined}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <Spinner className={css.coverSpinner} />
      <div className={css.coverBackground} aria-hidden="true" />
    </div>
  )
}
