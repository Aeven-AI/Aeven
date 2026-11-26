/**
 * Turns for card pictures: at most a few load at once, cards on screen first, so a picture the Host draws for the
 * first time never holds the page's other requests behind it. A card waits for a turn only while it is near the
 * page; one scrolled away before its turn gives its place up.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/** Pictures loading at once; the browser holds only a few connections to the Host, and the list and text share them. */
const PICTURES_AT_ONCE = 4

/** Distance from the viewport at which a card asks for a turn. */
const NEAR_MARGIN = '300px'

/** A queue of turns, handed out in arrival order. */
export class TurnQueue {
  private running = 0
  private readonly waiting: Array<() => void> = []

  /** @param limit - the most turns held at once. */
  constructor(private readonly limit: number) {}

  /**
   * Ask for a turn.
   * @param start - called once the turn is granted.
   * @returns withdraws the request while waiting, or ends the turn once granted; calling it twice does nothing more.
   */
  request(start: () => void): () => void {
    let state: 'waiting' | 'running' | 'done' = 'waiting'
    const grant = (): void => {
      state = 'running'
      this.running += 1
      start()
    }
    if (this.running < this.limit) grant()
    else this.waiting.push(grant)
    return () => {
      if (state === 'waiting') {
        const at = this.waiting.indexOf(grant)
        if (at >= 0) this.waiting.splice(at, 1)
      } else if (state === 'running') {
        this.running -= 1
        this.waiting.shift()?.()
      }
      state = 'done'
    }
  }
}

/** The page's one queue for card pictures. */
export const pictureTurns = new TurnQueue(PICTURES_AT_ONCE)

/**
 * Hold a turn for an element's picture while the element is near the page.
 * @param element - the card.
 * @param wanted - whether the card has a picture to load at all.
 * @returns whether the card holds its turn, and `done`, which ends the turn once the picture loaded or failed.
 */
export function usePictureTurn(element: RefObject<HTMLElement | null>, wanted: boolean): { granted: boolean; done: () => void } {
  const [near, setNear] = useState(false)
  const [granted, setGranted] = useState(false)
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    const node = element.current
    if (!wanted || node === null) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      setNear(entries.some(entry => entry.isIntersecting))
    }, { rootMargin: NEAR_MARGIN })
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [element, wanted])

  // A granted turn is kept until the picture settles, even if the card scrolls away; a waiting one is given up.
  const release = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    if (!wanted || finished || granted || !near) return
    let got = false
    const end = pictureTurns.request(() => {
      got = true
      setGranted(true)
    })
    release.current = end
    return () => {
      if (got) return
      end()
      release.current = undefined
    }
  }, [wanted, finished, granted, near])
  useEffect(() => () => { release.current?.() }, [])
  const done = useCallback(() => {
    setFinished(true)
    release.current?.()
    release.current = undefined
  }, [])

  return { granted, done }
}
