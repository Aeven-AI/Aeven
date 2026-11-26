/**
 * A Motion film on its Artifacts card: the composition's first frame as a still, played silently on a loop
 * while the card is hovered or focused and back to the first frame when it is left. The film loads only
 * once its card scrolls near the page, and each film's document is fetched once per page visit.
 */
import { useEffect, useRef, useState } from 'react'
// Side-effect import: registers the `hyperframes-player` custom element.
import '@hyperframes/player'
import type { ClipMedia } from '@aeven/client-ui-primitives'
import type { Artifact } from '@aeven/host-artifacts/types'
import css from './ArtifactsPage.module.css'

/** The HyperFrames player element, driven through the same members as a video element. */
type PlayerElement = HTMLElement & ClipMedia

/** Distance from the viewport at which a card starts loading its film. */
const LOAD_MARGIN = '400px'

/**
 * Render a film's still, and its silent loop while `playing`.
 * @param props - the artifact, the loader for its film document, whether the card is hovered, and the ready callback.
 * @returns the player's stage, filling the card.
 */
export function MotionPreview({ artifact, load, playing, onReady, onFail }: {
  artifact: Artifact
  load: (artifact: Artifact, signal: AbortSignal) => Promise<string | undefined>
  playing: boolean
  onReady: () => void
  onFail: () => void
}) {
  const stage = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [html, setHtml] = useState<string | undefined>(undefined)
  const [player, setPlayer] = useState<PlayerElement | null>(null)

  useEffect(() => {
    const element = stage.current
    if (element === null || near) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) setNear(true)
    }, { rootMargin: LOAD_MARGIN })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [near])

  useEffect(() => {
    if (!near) return
    const controller = new AbortController()
    load(artifact, controller.signal).then((text) => {
      if (controller.signal.aborted) return
      if (text === undefined) onFail()
      else setHtml(text)
    }, () => { if (!controller.signal.aborted) onFail() })
    return () => { controller.abort() }
  }, [near, artifact, load, onFail])

  // Created here rather than in JSX, which has no type for the custom element. Its frame drops
  // `allow-same-origin`, so the composition's scripts run in an opaque origin, apart from the app.
  useEffect(() => {
    const container = stage.current
    if (html === undefined || container === null) return
    const element = document.createElement('hyperframes-player') as PlayerElement
    element.setAttribute('sandbox-origin', 'opaque')
    element.setAttribute('muted', '')
    element.setAttribute('loop', '')
    element.setAttribute('srcdoc', html)
    element.className = css.player ?? ''
    element.addEventListener('ready', () => { onReady() })
    element.addEventListener('error', () => { onFail() })
    container.append(element)
    setPlayer(element)
    return () => {
      element.remove()
      setPlayer(null)
    }
  }, [html, onReady, onFail])

  useEffect(() => {
    if (player === null) return
    if (playing) {
      const started = player.play()
      if (started !== undefined) void started.catch(() => {})
      return
    }
    player.pause()
    player.currentTime = 0
  }, [player, playing])

  return <div ref={stage} className={css.stage} aria-hidden="true" />
}
