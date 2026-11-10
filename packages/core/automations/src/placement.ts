/**
 * Decides which Hosts of an account run a definition. The decision reads only the definition's declared
 * requirements, its owner's choice, and each Host's profile, so every Host of the account reaches the same answer.
 */
import type { AutomationDefinition, AutomationPlacement, HostProfile } from './types.ts'

/** The definition fields placement reads. */
export type PlacementInput = Pick<AutomationDefinition, 'requires' | 'runOn' | 'desktop'>

/**
 * What one Host may do with a definition's runs: `preferred` Hosts admit them at the scheduled instant,
 * a `fallback` Host admits a scheduled run only when no preferred Host did, and `never` refuses every run.
 */
export type Eligibility = 'preferred' | 'fallback' | 'never'

/**
 * Where a definition's requirements and its owner's choice place it.
 * @param definition - the declared requirements and the owner's choice.
 * @returns `cloud` when its owner chose Aeven Cloud, or when the task needs nothing from a computer and its owner
 * allows it; `device` when it needs a computer or its owner keeps it on one; `any` while its requirements are undeclared.
 */
export function placementMode(definition: PlacementInput): AutomationPlacement['runsOn'] {
  switch (definition.runOn) {
    case 'cloud': return 'cloud'
    case 'device': return 'device'
    case 'auto': break
  }
  if (definition.requires === undefined) return 'any'
  return definition.requires.length === 0 ? 'cloud' : 'device'
}

/**
 * What one Host may do with a definition's runs.
 * @param definition - the declared requirements and the owner's choice.
 * @param host - the Host that asks.
 * @returns the Host's part in running the definition. A device Host is a `fallback` for a cloud-placed definition
 * only while its owner left the choice to `auto`; a definition with a `desktop` runs on that desktop only.
 */
export function eligibility(definition: PlacementInput, host: HostProfile): Eligibility {
  const mode = placementMode(definition)
  switch (mode) {
    case 'any': return 'preferred'
    case 'cloud':
      if (host.kind === 'cloud') return 'preferred'
      return definition.runOn === 'cloud' ? 'never' : 'fallback'
    case 'device': {
      if (host.kind !== 'device') return 'never'
      if (definition.desktop !== undefined && host.device !== definition.desktop) return 'never'
      return (definition.requires ?? []).every(need => host.provides.includes(need)) ? 'preferred' : 'never'
    }
  }
}

/**
 * Where a definition runs given the Hosts its account has registered.
 * @param definition - the declared requirements and the owner's choice.
 * @param hosts - every registered Host of the account, the answering one included.
 * @returns the placement to show; an `auto` cloud definition of an account without a cloud Host runs on a device.
 */
export function resolvePlacement(definition: PlacementInput, hosts: readonly HostProfile[]): AutomationPlacement {
  const mode = placementMode(definition)
  const available = hosts.some(host => eligibility(definition, host) !== 'never')
  if (mode !== 'cloud') return { runsOn: mode, available }
  return { runsOn: definition.runOn === 'cloud' || hosts.some(host => host.kind === 'cloud') ? 'cloud' : 'device', available }
}

/**
 * Why an owner's choice cannot place a definition, checked when it is saved.
 * @param definition - the declared requirements and the owner's choice.
 * @param hosts - every registered Host of the account, the answering one included.
 * @returns the refusal to show, or undefined when the choice can place it.
 */
export function placementRefusal(definition: PlacementInput, hosts: readonly HostProfile[]): string | undefined {
  const needs = definition.requires ?? []
  if (definition.desktop !== undefined && definition.runOn !== 'device') return 'Choose a desktop only for a bot that runs on a desktop.'
  if (definition.runOn === 'cloud' && needs.length > 0) return `This bot uses ${needs.join(', ')} on your computer, so it cannot run in Aeven Cloud.`
  const chosen = definition.desktop === undefined ? undefined : hosts.find(host => host.kind === 'device' && host.device === definition.desktop)
  const missing = chosen === undefined ? [] : needs.filter(need => !chosen.provides.includes(need))
  if (missing.length > 0) return `That desktop cannot give this bot ${missing.join(', ')}.`
  return undefined
}
