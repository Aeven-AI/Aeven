/**
 * A first message handed to the chat by a link, such as the aeven.io landing page's composer opening
 * `https://chat.aeven.io/#q=Plan%20my%20week`. The message rides in the fragment, which the browser never sends to a
 * server. The boot kernel moves it into this tab's `sessionStorage` before the authentication gate runs, so it outlives
 * the sign-in screens and a provider redirect, and removes it from the address bar. The chat composer sends it on a
 * blank Session (`@aeven/client-ui-conversation`'s `takeIncomingPrompt` reads {@link INCOMING_PROMPT_KEY}).
 * @module @aeven/client-web/src/incoming-prompt
 */

/** Fragment parameter that carries the message. */
const FRAGMENT_PARAM = 'q'

/** `sessionStorage` key shared with `@aeven/client-ui-conversation`'s `takeIncomingPrompt`. */
export const INCOMING_PROMPT_KEY = 'avn:incoming-prompt'

/**
 * Move a `#q=` message from the address bar into this tab's `sessionStorage`. Other fragment parameters stay in the
 * address; a blank message is removed from the address and not kept.
 */
export function stashIncomingPrompt(): void {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const prompt = params.get(FRAGMENT_PARAM)
  if (prompt === null) return
  params.delete(FRAGMENT_PARAM)
  const rest = params.toString()
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search + (rest === '' ? '' : `#${rest}`),
  )
  if (prompt.trim() === '') return
  try {
    window.sessionStorage.setItem(INCOMING_PROMPT_KEY, prompt)
  } catch {
    // Storage refused by the browser (blocked site data, quota): the chat opens with an empty composer instead.
  }
}
