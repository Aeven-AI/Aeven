// Follows a custom-scheme link (such as `aeven://`) that the operating system hands to an installed app.

/** How long the page waits for an installed app to take focus after following its link, in milliseconds. */
const OPEN_GRACE_MS = 1500

/**
 * Follow a link an installed app handles and report whether the app took it. The page loses focus when the
 * operating system hands the link to an app; a page still focused after the grace period means no app opened.
 * @param href - the custom-scheme link.
 * @returns true when the page lost focus within the grace period, false when it kept focus.
 */
export function openAppLink(href: string): Promise<boolean> {
  return new Promise((resolve) => {
    let left = false
    const onBlur = (): void => { left = true }
    window.addEventListener('blur', onBlur, { once: true })
    window.setTimeout(() => {
      window.removeEventListener('blur', onBlur)
      resolve(left || !document.hasFocus())
    }, OPEN_GRACE_MS)
    window.location.href = href
  })
}
