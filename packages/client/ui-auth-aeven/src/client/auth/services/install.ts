/**
 * Installing Aeven to a phone's home screen.
 *
 * Chromium browsers on Android fire `beforeinstallprompt` once the page is
 * installable and let a page open their install dialog from that event. iOS
 * has no such API: every iOS browser installs through Share → Add to Home
 * Screen, which only the reader can press. This module captures the event as
 * early as the gate loads, so the menus that offer installing later can open
 * the real dialog where one exists and show the steps where none does.
 * @module
 */

/** The Chromium event that carries the install dialog. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>
}

/**
 * What installing means on this page.
 *
 * `prompt` opens the browser's install dialog; `ios` and `android` show that
 * platform's manual steps.
 */
export type InstallOffer = 'prompt' | 'ios' | 'android'

/** What pressing Install did: the dialog's answer, or manual steps to show. */
export type InstallOutcome = 'accepted' | 'dismissed' | 'ios' | 'android'

/** The captured install dialog, until it is used or the app is installed. */
let deferred: BeforeInstallPromptEvent | undefined

/** Whether this page saw the app installed. */
let installedHere = false

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Kept for the Install menu item rather than Chrome's own mini-infobar.
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    deferred = undefined
    installedHere = true
  })
}

/**
 * The phone platform this page runs on.
 * @returns `ios` or `android`, or undefined on any other device.
 */
function phonePlatform(): 'ios' | 'android' | undefined {
  const agent = navigator.userAgent
  // iPadOS reports a desktop Mac agent; touch points tell the two apart.
  if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(agent)) return 'android'
  return undefined
}

/**
 * Whether this page already runs as the installed app.
 * @returns true in a home-screen window.
 */
function runningInstalled(): boolean {
  const standalone = (navigator as { readonly standalone?: boolean }).standalone === true
  return standalone || matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches
}

/**
 * What an Install item would do on this page.
 * @returns the offer, or undefined off a phone and inside the installed app, where no item is shown.
 */
export function installOffer(): InstallOffer | undefined {
  if (typeof window === 'undefined' || installedHere || runningInstalled()) return undefined
  const platform = phonePlatform()
  if (platform === undefined) return undefined
  return deferred === undefined ? platform : 'prompt'
}

/**
 * Install the app: open the browser's dialog where it offers one, otherwise
 * name the platform whose steps the caller shows.
 * @returns the dialog's answer, or the platform whose manual steps to show.
 */
export async function installApp(): Promise<InstallOutcome> {
  const prompt = deferred
  if (prompt === undefined) return phonePlatform() ?? 'android'
  // Chromium honours one prompt per event; a dismissed dialog waits for the next event.
  deferred = undefined
  await prompt.prompt()
  return (await prompt.userChoice).outcome
}
