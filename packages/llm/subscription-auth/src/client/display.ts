/** Pure display helpers for the provider cards. */

import type { LoginMethod, ProviderCardDefinition } from './types.ts'

/**
 * The sign-in method a card uses. On a remote page the Host's local callback
 * would reach the wrong machine, so the device-code method is used there.
 * @param definition - the provider card.
 * @param remote - whether the browser is not on the harness host.
 * @returns the method the Sign in button starts.
 */
export function signInMethod(definition: ProviderCardDefinition, remote: boolean): LoginMethod {
  return remote ? definition.remoteMethod : definition.localMethod
}
