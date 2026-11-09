/**
 * Decides which Hosts of an account run a definition. The decision reads only the definition's declared
 * requirements, its owner's choice, and each Host's profile, so every Host of the account reaches the same answer.
 */
import type { AutomationDefinition, AutomationPlacement, HostProfile } from './types.ts'

/** The definition fields placement reads. */
export type PlacementInput = Pick<AutomationDefinition, 'requires' | 'runOn'>

/**
 * What one Host may do with a definition's runs: `preferred` Hosts admit them at the scheduled instant,
 * a `fallback` Host admits a scheduled run only when no preferred Host did, and `never` refuses every run.
 */
export type Eligibility = 'preferred' | 'fallback' | 'never'

/**
 * Where a definition's requirements and its owner's choice place it.
 * @param definition - the declared requirements and the owner's choice.
 * @returns `cloud` when the task needs nothing from a computer and its owner allows it, `device` when it needs
 * a computer or its owner keeps it on one, and `any` while its requirements are undeclared.
 */
export function placementMode(definition: PlacementInput): AutomationPlacement['runsOn'] {
  if (definition.runOn === 'device') return 'device'
  if (definition.requires === undefined) return 'any'
  return definition.requires.length === 0 ? 'cloud' : 'device'
}

/**
 * What one Host may do with a definition's runs.
 * @param definition - the declared requirements and the owner's choice.
 * @param host - the Host that asks.
 * @returns the Host's part in running the definition.
 */
export function eligibility(definition: PlacementInput, host: HostProfile): Eligibility {
  const mode = placementMode(definition)
  switch (mode) {
    case 'any': return 'preferred'
    case 'cloud': return host.kind === 'cloud' ? 'preferred' : 'fallback'
    case 'device': {
      if (host.kind !== 'device') return 'never'
      return (definition.requires ?? []).every(need => host.provides.includes(need)) ? 'preferred' : 'never'
    }
  }
}

/**
 * Where a definition runs given the Hosts its account has registered.
 * @param definition - the declared requirements and the owner's choice.
 * @param hosts - every registered Host of the account, the answering one included.
 * @returns the placement to show; a `cloud` definition of an account without a cloud Host runs on a device.
 */
export function resolvePlacement(definition: PlacementInput, hosts: readonly HostProfile[]): AutomationPlacement {
  const mode = placementMode(definition)
  const available = hosts.some(host => eligibility(definition, host) !== 'never')
  if (mode !== 'cloud') return { runsOn: mode, available }
  return { runsOn: hosts.some(host => host.kind === 'cloud') ? 'cloud' : 'device', available }
}
