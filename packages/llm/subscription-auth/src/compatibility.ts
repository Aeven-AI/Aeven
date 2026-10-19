/** Stable compatibility contracts for standalone and future co-installation. */

import type { DshHostCapability, OwnerAccessMode } from 'dsh-coding-oauth-core'

/** Avn compatibility diagnostic. */
export interface AvnCompatibilityDiagnostic {
  readonly id: string
  readonly component: 'host' | 'client' | 'owner-request' | 'runtime'
  readonly level: 'info' | 'warning' | 'error'
  readonly message: string
  readonly expected?: string
  readonly actual?: string
}

/** Coding oauth participant diagnostic source. */
export interface CodingOAuthParticipantDiagnosticSource {
  readonly participantId: 'coding-subscription-oauth'
  diagnostics(): readonly AvnCompatibilityDiagnostic[]
}

/** Avn compatibility. */
export interface AvnCompatibility {
  readonly coreAbi: string
  readonly avnVersion: string | null
  readonly status: 'healthy' | 'degraded' | 'incompatible'
  readonly uiOwner: 'hub' | 'standalone' | null
  readonly accessMode: OwnerAccessMode
  readonly capabilities: Readonly<Record<string, DshHostCapability>>
  readonly diagnostics: readonly string[]
}

/** Avn exact bom. */
export const AVN_EXACT_BOM = Object.freeze({
  '@deepseek-ai/cordis': '4.0.2',
  '@aeven/atomic-write': '0.3.7-alpha',
  '@aeven/attachment': '0.3.7-alpha',
  '@aeven/client-locale': '0.3.7-alpha',
  '@aeven/client-ui-primitives': '0.3.7-alpha',
  '@aeven/client-ui-renderer': '0.3.7-alpha',
  '@aeven/client-ui-settings': '0.3.7-alpha',
  '@aeven/client-ui-settings-models': '0.3.7-alpha',
  '@aeven/client-ui-slots': '0.3.7-alpha',
  '@aeven/client-web': '0.3.7-alpha',
  '@aeven/credentials': '0.3.7-alpha',
  '@aeven/home-paths': '0.3.7-alpha',
  '@aeven/host-webserver': '0.3.7-alpha',
  '@aeven/invariants': '0.3.7-alpha',
  '@aeven/llm': '0.3.7-alpha',
  '@aeven/llm-pi-ai': '0.3.7-alpha',
  '@aeven/media': '0.3.7-alpha',
  '@aeven/tools': '0.3.7-alpha',
  '@deepseek-ai/schemastery': '3.18.2',
  '@earendil-works/pi-ai': '0.84.2',
  react: '18.3.1',
  'react-dom': '18.3.1',
} as const)

/**
 * Incompatible diagnostics.
 * @param diagnostics - Diagnostics value.
 * @returns The resulting incompatible diagnostics.
 */
export function incompatibleDiagnostics(
  diagnostics: readonly AvnCompatibilityDiagnostic[],
): AvnCompatibilityDiagnostic[] {
  return diagnostics.filter(diagnostic => diagnostic.level === 'error')
}
