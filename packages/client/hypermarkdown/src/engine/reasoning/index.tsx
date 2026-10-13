import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { defaultUi } from '../config.ts'
import type { UiConfig } from '../config.ts'

export interface ReasoningProps {
  /** The model's reasoning, already rendered as markdown. */
  children?: ReactNode
  /** True while the reasoning is still arriving. */
  stream?: boolean | undefined
  ui?: UiConfig | undefined
  renderer?: unknown
  scrollDown?: unknown
}

/**
 * A model's reasoning, kept apart from its answer.
 *
 * Open while it streams, so the reader can watch it think, and collapsed once
 * it finishes — the answer is what they came for. Anyone who wants to reread
 * the reasoning can open it again.
 *
 * Open state is derived during render, never corrected by an effect, and the
 * collapse is CSS on the mounted trace: a settled block therefore paints at its
 * final height on its first frame.
 */
function ReasoningComponent(props: ReasoningProps) {
  const { children, stream } = props

  const ui = props.ui ?? defaultUi
  const { translations, icons } = ui

  // Null until the reader toggles; until then the block follows the stream.
  const [readerOpen, setReaderOpen] = useState<boolean | null>(null)
  const open = readerOpen ?? stream === true
  const [seconds, setSeconds] = useState(0)
  const startedAt = useRef<number | null>(null)

  if (startedAt.current === null) {
    startedAt.current = Date.now()
  }

  useEffect(() => {
    const tick = () => {
      setSeconds(Math.round((Date.now() - startedAt.current!) / 1000))
    }

    tick()

    if (stream !== true) {
      return
    }

    const timer = setInterval(tick, 1000)

    return () => {
      clearInterval(timer)
    }
  }, [stream])

  const toggle = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()

    setReaderOpen(! open)
  }, [open])

  const label =
    stream === true
      ? translations.thinking
      : translations.thoughtFor.replace('{seconds}', String(seconds))

  return (
    <div
      className={
        'reasoning-wrapper' +
        (stream === true ? ' stream-active' : '') +
        (open ? ' open' : ' collapsed')
      }
    >
      <div className="reasoning-container">
        <button
          type="button"
          className="reasoning-header"
          onClick={toggle}
          aria-expanded={open}
        >
          <span className="reasoning-title">{label}</span>
          <span
            className="reasoning-chevron"
            dangerouslySetInnerHTML={{ __html: icons.chevron }}
          />
        </button>
        <div className="reasoning-content">{children}</div>
      </div>
    </div>
  )
}

const Reasoning = memo(ReasoningComponent)

Reasoning.displayName = 'Reasoning'

export default Reasoning
