/**
 * The Æven mark on the black half of the authentication screens.
 *
 * The picture and its motion are the Aeven website's sign-in graphic, carried
 * over as it stands: the mark drawn out of the dark it sits on, arriving from
 * under the paper beside it and left standing in its own light, with a light
 * inside it that answers the pointer and walks on its own whenever the pointer
 * rests. The timelines, offsets and curves below are that screen's, run on the
 * same GSAP, so the two surfaces move identically.
 *
 * The stylesheet holds the settled picture for `prefers-reduced-motion`; this
 * component then sets the same picture and starts nothing.
 * @module
 */

import { useEffect, useRef, type RefObject } from 'react'
import gsap from 'gsap'

/** How long the pointer rests before the light wanders on its own. */
const IDLE_AFTER_MS = 2600

/**
 * The black half's mark, arriving and then standing in its own light.
 * @returns the mark's layers, in the order they catch the light.
 */
export function MarkBackdrop(): React.JSX.Element {
  const corner: RefObject<HTMLSpanElement> = useRef(null)
  const graphic: RefObject<HTMLSpanElement> = useRef(null)
  const wide: RefObject<HTMLSpanElement> = useRef(null)
  const tight: RefObject<HTMLSpanElement> = useRef(null)
  const mark: RefObject<HTMLSpanElement> = useRef(null)
  const torch: RefObject<HTMLSpanElement> = useRef(null)
  const core: RefObject<HTMLElement> = useRef(null)

  useEffect(() => {
    const cornerEl = corner.current
    const graphicEl = graphic.current
    const wideEl = wide.current
    const tightEl = tight.current
    const markEl = mark.current
    const torchEl = torch.current
    const coreEl = core.current
    if (cornerEl === null || graphicEl === null || wideEl === null || tightEl === null
      || markEl === null || torchEl === null || coreEl === null) return

    /** The breathing the arrival hands over to. */
    let life: gsap.core.Tween[] | undefined
    /** The walk the light takes while no pointer is moving. */
    let idle: gsap.core.Timeline | undefined
    /** When the resting pointer's walk is due to start. */
    let idleTimer: number | undefined
    /** Where the light is sent, once the arrival has parked it. */
    let move: { readonly x: ReturnType<typeof gsap.quickTo>; readonly y: ReturnType<typeof gsap.quickTo> } | undefined
    /** Whether the pointer has taken the light over from where it was waiting. */
    let active = false

    /**
     * The pointer's light starts where the mark's own light comes from, and follows the
     * pointer from there.
     */
    const parkTorch = (): void => {
      move = {
        x: gsap.quickTo(coreEl, 'x', { duration: 0.3, ease: 'power3' }),
        y: gsap.quickTo(coreEl, 'y', { duration: 0.34, ease: 'power3' }),
      }

      gsap.set(coreEl, {
        x: -graphicEl.offsetWidth * 0.24,
        y: -graphicEl.offsetHeight * 0.28,
      })
    }

    /**
     * A phone has no pointer to answer, and a mouse that stops should not leave a dead
     * spotlight behind: the light wanders instead.
     */
    const armIdle = (): void => {
      const width = graphicEl.offsetWidth
      const height = graphicEl.offsetHeight

      if (width < 1 || height < 1 || idle !== undefined) return

      idle = gsap
        .timeline({
          repeat: -1,
          yoyo: true,
          defaults: { duration: 8.5, ease: 'sine.inOut' },
        })
        .to(coreEl, { x: width * 0.05, y: -height * 0.1 }, 0)
        .to(coreEl, { x: -width * 0.18, y: height * 0.05 }, 0)
    }

    /**
     * The light walks with the pointer wherever it is on the page, and never leaves the
     * mark it lights: past the mark's edge it waits at the edge rather than sliding away.
     */
    const follow = (event: PointerEvent): void => {
      if (move === undefined) return

      const rect = graphicEl.getBoundingClientRect()
      let x = event.clientX - rect.left - rect.width / 2
      let y = event.clientY - rect.top - rect.height / 2

      if (idle !== undefined) {
        idle.kill()
        idle = undefined
      }

      if (idleTimer !== undefined) clearTimeout(idleTimer)

      idleTimer = window.setTimeout(() => { armIdle() }, IDLE_AFTER_MS)

      x = Math.max(-rect.width / 2, Math.min(rect.width / 2, x))
      y = Math.max(-rect.height / 2, Math.min(rect.height / 2, y))

      // The first move puts the light where the pointer already is, instead of letting it
      // travel there from where it was waiting.
      if (!active) {
        active = true

        gsap.killTweensOf(coreEl)
        gsap.set(coreEl, { x, y })

        return
      }

      move.x(x)
      move.y(y)
    }

    gsap.set(graphicEl, { xPercent: -92, opacity: 0 })
    gsap.set([markEl, tightEl, wideEl, cornerEl], { opacity: 0 })

    // The pointer's light is there from the first frame, waiting where the mark's own
    // light comes from, and it answers the pointer anywhere on the page rather than only
    // over the black half.
    gsap.set(torchEl, { opacity: 1 })

    parkTorch()
    armIdle()

    window.addEventListener('pointermove', follow)

    // A host without the query — jsdom in this package's specs — starts nothing, the same
    // settled picture a reader who asks for reduced motion sees.
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduceMotion) {
      gsap.set(graphicEl, { xPercent: 0, opacity: 1 })
      gsap.set(markEl, { opacity: 1 })
      gsap.set(tightEl, { opacity: 0.62 })
      gsap.set(wideEl, { opacity: 0.4 })
      gsap.set(cornerEl, { opacity: 0.9 })

      return () => { window.removeEventListener('pointermove', follow) }
    }

    /**
     * What is left after the arrival only breathes in scale: the glow layers hold the
     * opacity they reached, because a slow change of opacity on a wide gradient is exactly
     * what shows the bands that sit inside it.
     */
    const startLife = (): void => {
      life = [
        gsap.to(graphicEl, {
          scale: 1.014,
          duration: 17,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut',
          transformOrigin: '62% 38%',
        }),
      ]

      armIdle()
    }

    /** The arrival timeline, from under the paper to the mark standing in its light. */
    const arrival = gsap.timeline({ defaults: { ease: 'power3.out' } })

    arrival
      // The light in the far corner first, so the black is never quite empty.
      .to(cornerEl, { opacity: 0.9, duration: 2.6, ease: 'sine.inOut' }, 0)
      // The mark itself, carried out of the white while it is still barely there.
      .to(graphicEl, { xPercent: 0, duration: 1.9, ease: 'power3.out' }, 0.12)
      .to(graphicEl, { opacity: 1, duration: 1.7, ease: 'power1.inOut' }, 0.12)
      // Its own light, and the air around it, come up with it and then stay put: moving a
      // long soft gradient over black is what makes it break into bands.
      .to(markEl, { opacity: 1, duration: 1.5, ease: 'power1.inOut' }, 0.55)
      .to(tightEl, { opacity: 0.62, duration: 2, ease: 'power1.inOut' }, 0.6)
      .to(wideEl, { opacity: 0.4, duration: 2.2, ease: 'power1.inOut' }, 0.7)
      .add(() => { startLife() }, 2.8)

    return () => {
      window.removeEventListener('pointermove', follow)

      arrival.kill()
      for (const tween of life ?? []) tween.kill()
      idle?.kill()

      if (idleTimer !== undefined) clearTimeout(idleTimer)
    }
  }, [])

  return (
    <>
      <span className="auth-corner" ref={corner} aria-hidden="true" />
      <span className="auth-graphic" ref={graphic} aria-hidden="true">
        <span className="auth-glow wide" ref={wide}><span /></span>
        <span className="auth-glow tight" ref={tight}><span /></span>
        <span className="auth-mark" ref={mark}>
          <span className="auth-torch" ref={torch}><i ref={core} /></span>
        </span>
      </span>
    </>
  )
}

export default MarkBackdrop
