/** Static shell-preloader control shared by the Web entry and worker preview. */

/** Root element id hardcoded in apps/web/index.html. */
export const PRELOADER_ELEMENT_ID = 'avn-preloader'

/** Fade duration shared with the index stylesheet. */
export const FADE_MS = 400

/**
 * Hold before the fade out starts, shared with the index stylesheet.
 *
 * The sheet holds the opaque cover for this long before fading it out, and
 * `settle`'s fallback timer waits it out with the fade; a shorter hold here
 * would drop `.screen-hidden` in while the cover is still fading.
 */
export const FADE_DELAY_MS = 500

/** Fade-in duration, shared with the index stylesheet; the fade in has no hold. */
export const FADE_IN_MS = 300

let settleCleanup: (() => void) | undefined
let operation = 0

/** Read the optional static preloader root. */
function root(): HTMLElement | undefined {
  return document.getElementById(PRELOADER_ELEMENT_ID) ?? undefined
}

/** Cancel an outstanding transition listener and fallback timer. */
function cancelSettle(): void {
  settleCleanup?.()
  settleCleanup = undefined
}

/**
 * Complete an opacity transition even when the document stays hidden.
 * @param el - the preloader root.
 * @param done - runs once the transition ends or its fallback timer fires.
 * @param windowMs - how long the transition takes, hold included.
 */
function settle(el: HTMLElement, done: () => void, windowMs = FADE_DELAY_MS + FADE_MS): void {
  let complete = false
  const finish = (): void => {
    if (complete) return
    complete = true
    cancelSettle()
    done()
  }
  // The window includes any hold before the transition, so the fallback waits out both.
  const timer = setTimeout(finish, windowMs + 100)
  const cleanup = (): void => {
    clearTimeout(timer)
    el.removeEventListener('transitionend', finish)
  }
  settleCleanup = cleanup
  el.addEventListener('transitionend', finish)
}

/**
 * Dismiss the static shell preloader.
 * @param animation - Fade before taking the element out of the layout.
 */
export function hidePreloader(animation = true): void {
  const el = root()
  if (el === undefined || el.classList.contains('screen-hidden')) return
  const spinner = el.querySelector('.spinner')
  const ticket = ++operation
  cancelSettle()
  if (!animation) {
    el.classList.remove('animate')
    el.classList.add('hide', 'screen-hidden')
    spinner?.classList.remove('active')
    return
  }
  el.classList.remove('entering')
  el.classList.add('animate')
  requestAnimationFrame(() => {
    if (ticket !== operation) return
    el.classList.add('hide')
    settle(el, () => {
      if (ticket !== operation) return
      el.classList.remove('animate')
      el.classList.add('screen-hidden')
      spinner?.classList.remove('active')
    })
  })
}

/**
 * Restore the static shell preloader. The fade in starts at once, with no hold,
 * so the cover can rise over a screen that is still on the page.
 * @param animation - Fade the element in after restoring it to the layout.
 * @returns Resolves once the cover is opaque: at once without animation, or
 * when the fade in ends (or a later show or hide supersedes it).
 */
export function showPreloader(animation = true): Promise<void> {
  const el = root()
  if (el === undefined) return Promise.resolve()
  const ticket = ++operation
  cancelSettle()
  const spinner = el.querySelector('.spinner')
  el.classList.remove('screen-hidden')
  spinner?.classList.add('active')
  if (!animation || !el.classList.contains('hide')) {
    el.classList.remove('animate', 'entering', 'hide')
    return Promise.resolve()
  }
  el.classList.add('animate', 'entering')
  // Commit the transparent, laid-out state before the fade starts: back in the
  // layout and still transparent, so removing `hide` transitions from there.
  void el.getBoundingClientRect()
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      if (ticket !== operation) { resolve(); return }
      el.classList.remove('hide')
      settle(el, () => {
        if (ticket === operation) el.classList.remove('animate', 'entering')
        resolve()
      }, FADE_IN_MS)
    })
  })
}
