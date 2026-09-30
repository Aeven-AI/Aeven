/** Pure display helpers for the provider cards' sign-in buttons. */

import type { GrokBuildSettingsInjected, LoginMethod, ProviderCardDefinition } from './types.ts'

/**
 * The sign-in method a card leads with. On a remote page the local callback
 * would reach the wrong machine, so the card's remote recommendation wins.
 * @param definition - the provider card.
 * @param remote - whether the browser is not on the harness host.
 * @returns the method for the primary button.
 */
export function preferredLoginMethod(definition: ProviderCardDefinition, remote: boolean): LoginMethod {
  if (
    remote
    && definition.remoteRecommended !== undefined
    && definition.methods.includes(definition.remoteRecommended)
  ) {
    return definition.remoteRecommended
  }
  return definition.recommended
}

/**
 * The card's methods with the preferred one first, so the primary button is unambiguous.
 * @param definition - the provider card.
 * @param remote - whether the browser is not on the harness host.
 * @returns every method the card offers, preferred first.
 */
export function orderedLoginMethods(definition: ProviderCardDefinition, remote: boolean): LoginMethod[] {
  const preferred = preferredLoginMethod(definition, remote)
  const rest = definition.methods.filter(method => method !== preferred)
  return definition.methods.includes(preferred) ? [preferred, ...rest] : [...definition.methods]
}

/**
 * Name a sign-in button by what it asks of the user. A browser flow completes
 * on its own through the local callback, so it is the plain Sign in; the
 * device flow hands the user a code to enter.
 * @param method - the button's sign-in method.
 * @param t - the settings translator.
 * @returns the button label.
 */
export function methodLabel(method: LoginMethod, t: GrokBuildSettingsInjected['t']): string {
  return method === 'device' ? t('codeLogin') : t('signIn')
}
