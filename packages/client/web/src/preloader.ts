/** Static shell-preloader control shared by the Web entry and worker preview. */

/** Root element id hardcoded in apps/web/index.html. */
export const PRELOADER_ELEMENT_ID = 'dsh-preloader'

/** Fade duration shared with the index stylesheet. */
export const FADE_MS = 400

/** Hold before the fade starts, shared with the index stylesheet. */
export const FADE_DELAY_MS = 500

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

/** Complete an opacity transition even when the document stays hidden. */
function settle(el: HTMLElement, done: () => void): void {
  let complete = false
  const finish = (): void => {
    if (complete) return
    complete = true
    cancelSettle()
    done()
  }
  // The delay runs before the transition does, so the fallback waits out both.
  const timer = setTimeout(finish, FADE_DELAY_MS + FADE_MS + 100)
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
 * Restore the static shell preloader.
 * @param animation - Fade the element in after restoring it to the layout.
 */
export function showPreloader(animation = true): void {
  const el = root()
  if (el === undefined) return
  const ticket = ++operation
  cancelSettle()
  const spinner = el.querySelector('.spinner')
  el.classList.remove('screen-hidden')
  spinner?.classList.add('active')
  if (!animation) {
    el.classList.remove('animate', 'hide')
    return
  }
  el.classList.add('animate')
  requestAnimationFrame(() => {
    if (ticket === operation) el.classList.remove('hide')
  })
}
