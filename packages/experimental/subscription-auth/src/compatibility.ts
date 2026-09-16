/** Stable compatibility contracts for standalone and future co-installation. */

import type { DshHostCapability, OwnerAccessMode } from 'dsh-coding-oauth-core'

/** Dsh compatibility diagnostic. */
export interface DshCompatibilityDiagnostic {
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
  diagnostics(): readonly DshCompatibilityDiagnostic[]
}

/** Dsh compatibility. */
export interface DshCompatibility {
  readonly coreAbi: string
  readonly dshVersion: string | null
  readonly status: 'healthy' | 'degraded' | 'incompatible'
  readonly uiOwner: 'hub' | 'standalone' | null
  readonly accessMode: OwnerAccessMode
  readonly capabilities: Readonly<Record<string, DshHostCapability>>
  readonly diagnostics: readonly string[]
}

/** Dsh exact bom. */
export const AVN_EXACT_BOM = Object.freeze({
  '@deepseek-ai/cordis': '4.0.2',
  '@aeven/atomic-write': '0.1.2-alpha.5',
  '@aeven/attachment': '0.1.2-alpha.5',
  '@aeven/client-locale': '0.1.2-alpha.5',
  '@aeven/client-ui-renderer': '0.1.2-alpha.5',
  '@aeven/client-ui-settings': '0.1.2-alpha.5',
  '@aeven/client-ui-slots': '0.1.2-alpha.5',
  '@aeven/client-web': '0.1.2-alpha.5',
  '@aeven/credentials': '0.1.2-alpha.5',
  '@aeven/home-paths': '0.1.2-alpha.5',
  '@aeven/host-webserver': '0.1.2-alpha.5',
  '@aeven/invariants': '0.1.2-alpha.5',
  '@aeven/llm': '0.1.2-alpha.5',
  '@aeven/llm-pi-ai': '0.1.2-alpha.5',
  '@aeven/tools': '0.1.2-alpha.5',
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
  diagnostics: readonly DshCompatibilityDiagnostic[],
): DshCompatibilityDiagnostic[] {
  return diagnostics.filter(diagnostic => diagnostic.level === 'error')
}
