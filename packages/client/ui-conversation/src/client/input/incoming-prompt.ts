/**
 * The first message a link handed the chat. `@aeven/client-web`'s boot kernel moves a `#q=` fragment into this tab's
 * `sessionStorage` under {@link INCOMING_PROMPT_KEY} before the authentication gate; the blank Session's composer
 * takes it once and sends it.
 * @module @aeven/client-ui-conversation/client/input/incoming-prompt
 */

/** `sessionStorage` key written by `@aeven/client-web`'s `stashIncomingPrompt`. */
export const INCOMING_PROMPT_KEY = 'avn:incoming-prompt'

/**
 * Remove and return the message a link left for this tab.
 * @returns the message, or undefined when there is none or storage is unavailable.
 */
export function takeIncomingPrompt(): string | undefined {
  let prompt: string | null
  try {
    prompt = window.sessionStorage.getItem(INCOMING_PROMPT_KEY)
  } catch {
    // Storage refused by the browser (blocked site data): stashIncomingPrompt could not have written either.
    return undefined
  }
  if (prompt === null) return undefined
  window.sessionStorage.removeItem(INCOMING_PROMPT_KEY)
  return prompt
}
