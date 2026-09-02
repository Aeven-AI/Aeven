/**
 * Preloader rows for the browser's pre-plugin interval. The markup and its
 * stylesheet reach the document through the index response, so the first paint
 * already carries the brand mark and spinner — before the entry bundle, the
 * module loader, or React exist. The rows also publish
 * `globalThis.__DSH_PRELOADER__`, the only way to dismiss the page: the web
 * boot kernel calls `hide()` once the application owns the mount point, and
 * calls it without animation before rendering a boot failure.
 *
 * Colors are literal rather than `--dsw-*` because the token sheets ship
 * inside the client bundle and resolve only after the plugin tree activates.
 * The theme bootstrap row (boot-theme.ts) runs first and sets
 * `body[data-ds-dark-theme]`, so the dark override below applies on that same
 * first paint.
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'

/** Root element id owned by the preloader rows. */
export const PRELOADER_ELEMENT_ID = 'dsh-preloader'

/** Global the boot kernel reads to dismiss the preloader. */
export const PRELOADER_GLOBAL = '__DSH_PRELOADER__'

/** Fade duration in ms; the transition-end fallback timer must outlast it. */
const FADE_MS = 400

/** Spinner revolution period in ms. */
const SPIN_MS = 900

/**
 * Brand mark, 671x581 viewBox, painted through `currentColor` so the palette
 * override reaches it.
 */
const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 671 581"><g fill="currentColor" fill-rule="evenodd"><path d="m225.301 0 305.5 529.142-43.301 25L182 25z" /><path d="M140 529.141 445.5 0l43.302 25-305.5 529.141z" /><path d="M167.901 530.059h335v50h-335z" /><path d="m43.302 264.5 167.5 290.119-43.302 25L0 289.5zM503.302 0l167.5 290.119-43.302 25L460 25z" /><path d="M460 554.618 627.5 264.5l43.301 25-167.5 290.118zM0 290.118 167.5 0 210.8 25l-167.5 290.118z" /><path d="M167.5 0h57.8v50h-57.8zM445.5 0h57.8v50h-57.8zM72.5 405.3 306.5 0l43.302 25-234 405.3z" /><path d="m364.301 0 234 405.3-43.3 25L321 25z" /><path d="M306.5 0h57.8v50h-57.8z" /></g></svg>'

/**
 * Spinner glyph. The source art hardcodes `stroke="#000000"`; `currentColor`
 * here is what lets the dark override repaint it.
 */
const SPINNER_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 16L19 19M18 12H22M8 8L5 5M16 8L19 5M8 16L5 19M2 12H6M12 2V6M12 18V22" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>'

/** Preloader stylesheet, scoped to the root id so no utility class leaks out. */
const PRELOADER_CSS = `
#${PRELOADER_ELEMENT_ID} {
  --dsh-preloader-bg: rgb(242, 242, 242);
  --dsh-preloader-fg: rgb(10, 10, 10);

  display: flex;
  position: fixed;
  opacity: 1;
  z-index: 100;
  width: 100vw;
  height: 100%;
  max-width: 100%;
  align-items: center;
  justify-content: center;
}

body[data-ds-dark-theme] #${PRELOADER_ELEMENT_ID} {
  --dsh-preloader-bg: rgb(21, 21, 23);
  --dsh-preloader-fg: rgb(249, 250, 251);
}

#${PRELOADER_ELEMENT_ID} .container {
  display: flex;
  position: relative;
  z-index: 1;
  width: 100%;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}

#${PRELOADER_ELEMENT_ID} .container .logo {
  display: flex;
  position: relative;
  width: 50px;
  height: 50px;
  color: var(--dsh-preloader-fg);
  margin-bottom: 4px;
  filter: blur(0px);
}

#${PRELOADER_ELEMENT_ID} .container .logo svg {
  display: flex;
  width: 50px;
  height: 50px;
}

#${PRELOADER_ELEMENT_ID} .container .spinner {
  display: block;
  position: relative;
  width: 16px;
  height: 16px;
}

#${PRELOADER_ELEMENT_ID} .container .spinner svg {
  color: var(--dsh-preloader-fg);
  display: block;
  position: relative;
  width: 16px;
  height: 16px;
}

#${PRELOADER_ELEMENT_ID} .container .spinner.active {
  animation: ${String(SPIN_MS)}ms linear 0s infinite normal none running dsh-preloader-spin;
}

#${PRELOADER_ELEMENT_ID} .background {
  display: block;
  position: fixed;
  top: 0px;
  left: 0px;
  width: 100vw;
  height: 120%;
  max-width: 100%;
  background-color: var(--dsh-preloader-bg);
}

#${PRELOADER_ELEMENT_ID}.hide {
  opacity: 0;
}

#${PRELOADER_ELEMENT_ID}.hide .container .logo {
  filter: blur(1px);
}

#${PRELOADER_ELEMENT_ID}.animate {
  transition: opacity ${String(FADE_MS)}ms linear;
}

#${PRELOADER_ELEMENT_ID}.animate .container .logo {
  transition: filter ${String(FADE_MS)}ms ease-out;
}

#${PRELOADER_ELEMENT_ID}.screen-hidden {
  width: 0;
  height: 0;
  visibility: hidden;
}

@keyframes dsh-preloader-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`

/** Preloader markup: brand mark over spinner, above a full-viewport ground. */
const PRELOADER_HTML = `<div id="${PRELOADER_ELEMENT_ID}"><div class="container"><div class="logo">${LOGO_SVG}</div><div class="spinner active">${SPINNER_SVG}</div></div><div class="background"></div></div>`

/**
 * Controller script body. Element lookup is deferred into each call so the row
 * order between this script and the markup does not matter, and both entry
 * points tolerate a document that never received the markup.
 */
const PRELOADER_SCRIPT = `(() => {
  const id = ${JSON.stringify(PRELOADER_ELEMENT_ID)}
  const fadeMs = ${String(FADE_MS)}
  let timer
  const root = () => document.getElementById(id)
  const settle = (el, done) => {
    // transitionend fires per property; the timer also covers a document
    // hidden through the whole fade, where transitions never run.
    const finish = () => {
      clearTimeout(timer)
      el.removeEventListener('transitionend', finish)
      done()
    }
    el.addEventListener('transitionend', finish)
    timer = setTimeout(finish, fadeMs + 100)
  }
  globalThis[${JSON.stringify(PRELOADER_GLOBAL)}] = {
    hide(animation = true) {
      const el = root()
      if (el === null || el.classList.contains('screen-hidden')) return
      const spinner = el.querySelector('.spinner')
      if (!animation) {
        clearTimeout(timer)
        el.classList.remove('animate')
        el.classList.add('hide', 'screen-hidden')
        if (spinner !== null) spinner.classList.remove('active')
        return
      }
      el.classList.add('animate')
      // Own frame for the class add, or the browser has no start value to
      // transition the opacity from.
      requestAnimationFrame(() => {
        el.classList.add('hide')
        settle(el, () => {
          el.classList.remove('animate')
          el.classList.add('screen-hidden')
          if (spinner !== null) spinner.classList.remove('active')
        })
      })
    },
    show(animation = true) {
      const el = root()
      if (el === null) return
      const spinner = el.querySelector('.spinner')
      clearTimeout(timer)
      el.classList.remove('screen-hidden')
      if (spinner !== null) spinner.classList.add('active')
      if (!animation) {
        el.classList.remove('animate', 'hide')
        return
      }
      el.classList.add('animate')
      requestAnimationFrame(() => { el.classList.remove('hide') })
    },
  }
})()`

/**
 * The preloader as index injection rows, in render order: the stylesheet
 * (head), the markup and the controller (body, ahead of the shell mount).
 * @returns the style, html, and script rows.
 */
export function bootPreloaderInjections(): IndexInjection[] {
  return [
    { kind: 'style', text: PRELOADER_CSS },
    { kind: 'html', placement: 'body', html: PRELOADER_HTML },
    { kind: 'script', placement: 'body', text: PRELOADER_SCRIPT },
  ]
}
