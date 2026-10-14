/** Account-bound connector credential addresses and pending consents. */

import { createHash } from 'node:crypto'
import { credentialKey, type CredentialKey } from '@aeven/credentials'
import type { ConnectorId, ConnectorProvider } from './types.ts'

/**
 * Derive a private credential address from the immutable account and connector ids.
 * @param owner - authenticated account id.
 * @param id - connector id.
 * @returns account-owned credential address.
 */
export function connectorCredential(owner: string, id: ConnectorId): CredentialKey {
  const account = createHash('sha256').update(owner).digest('hex')
  return credentialKey('account-integrations', `u-${account}-${id}`)
}

/**
 * One consent the Aeven API started for the account that initiated it. The API keeps the PKCE
 * verifier and the provider's tokens; the Host keeps only what binds the outcome to its account.
 */
export interface PendingConsent {
  owner: string
  id: ConnectorId
  provider: ConnectorProvider
  expiresAt: number
  /** In-flight completion whose writes must settle before disconnect removes the account. */
  completion?: Promise<void>
}
