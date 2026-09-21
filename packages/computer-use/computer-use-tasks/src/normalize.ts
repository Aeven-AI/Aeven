/**
 * Normalizing the source domains.
 *
 * Measured on the real task sets, the sources describe the same application in
 * several ways: LibreOffice Calc appears as `libreoffice calc`, `libreoffice_calc`,
 * and `libreoffice-calc` depending on which benchmark and which generation of its
 * data you read. They also carry harness artefacts in the same field — the
 * largest single "domain" in the raw catalog is `terminal_no_reset`, which is 244
 * tasks whose snapshot sets a reset flag, not an application that 244 tasks
 * concern.
 *
 * Left alone, both problems make the catalog misleading in a specific way: the
 * counts are the thing a reader uses to decide where to invest, and a split count
 * understates an application while a harness artefact overstates one. So
 * normalization runs before grouping, and every rename is a visible decision here
 * rather than a silent rewrite.
 *
 * @module @aeven/computer-use-tasks/normalize
 */

import type { TaskIntent } from './intent.ts'

/**
 * Domain spellings that name the same application.
 *
 * Keys are as the sources write them; values are the canonical application name.
 * Only genuine aliases belong here — a rename that changes which application a
 * task concerns would be a curation error, not a normalization.
 */
export const DOMAIN_ALIASES: Readonly<Record<string, string>> = {
  'libreoffice calc': 'libreoffice-calc',
  libreoffice_calc: 'libreoffice-calc',
  'libreoffice writer': 'libreoffice-writer',
  libreoffice_writer: 'libreoffice-writer',
  'libreoffice impress': 'libreoffice-impress',
  libreoffice_impress: 'libreoffice-impress',
  file_explorer: 'file-explorer',
  vs_code: 'vscode',
  msedge: 'edge',
  reminder: 'reminders',
  mac_system_settings: 'system-settings',
}

/**
 * Domains that describe the harness rather than an application.
 *
 * The snapshot name of a task set often encodes how the environment was prepared.
 * Those names are not applications, and leaving them in the catalog would put a
 * harness artefact at the top of a list a reader uses to choose where to invest.
 */
export const HARNESS_DOMAINS: ReadonlySet<string> = new Set([
  'terminal_no_reset',
  'clock_no_kill',
  'os',
  'multi_app',
  'multi_apps',
])

/**
 * Whether a domain names the harness rather than an application.
 * @param domain - the domain as a source writes it.
 * @returns true when it is a harness marker.
 */
export function isHarnessDomain(domain: string): boolean {
  return HARNESS_DOMAINS.has(domain)
}

/**
 * Canonicalize one domain name.
 *
 * Case and separator differences are folded, so `LibreOffice_Calc` and
 * `libreoffice-calc` agree; then the alias table decides. An unknown domain is
 * passed through unchanged rather than guessed at, because inventing a canonical
 * name for an application we have not seen would be a fabrication.
 * @param domain - the domain as a source writes it.
 * @returns the canonical name.
 */
export function canonicalDomain(domain: string): string {
  const trimmed = domain.trim()
  const lowered = trimmed.toLowerCase()
  const separatorsFolded = lowered.replace(/[\s_]+/g, '-')
  return DOMAIN_ALIASES[trimmed]
    ?? DOMAIN_ALIASES[lowered]
    ?? DOMAIN_ALIASES[separatorsFolded]
    ?? separatorsFolded
}

/**
 * Rewrite an intent's domains to their canonical form, dropping harness markers.
 *
 * The intent itself is copied rather than mutated: the raw `apps` a source wrote
 * are evidence, and a caller comparing normalized output against the source needs
 * the original to still be there.
 * @param intent - the intent to normalize.
 * @returns a copy with canonical application names and no harness markers.
 */
export function normalizeIntent(intent: TaskIntent): TaskIntent {
  const apps: string[] = []
  for (const app of intent.apps) {
    if (isHarnessDomain(app)) {
      continue
    }
    const canonical = canonicalDomain(app)
    if (!apps.includes(canonical)) {
      apps.push(canonical)
    }
  }
  return { ...intent, apps }
}

/**
 * Normalize a whole catalog.
 * @param intents - the intents to normalize.
 * @returns normalized copies, in the same order.
 */
export function normalizeIntents(intents: readonly TaskIntent[]): TaskIntent[] {
  return intents.map(normalizeIntent)
}

/**
 * Report which raw domains were folded into which canonical ones.
 *
 * Exported so a catalog can state its own renames: a reader who knows the source
 * writes `libreoffice_calc` should be able to see where those tasks went instead
 * of wondering why the count dropped.
 * @param intents - the raw intents.
 * @returns canonical domain to the raw spellings that map to it.
 */
export function renameReport(intents: readonly TaskIntent[]): Map<string, string[]> {
  const renames = new Map<string, string[]>()
  for (const intent of intents) {
    for (const app of intent.apps) {
      const canonical = canonicalDomain(app)
      if (canonical === app) {
        continue
      }
      const existing = renames.get(canonical)
      if (existing === undefined) {
        renames.set(canonical, [app])
      } else if (!existing.includes(app)) {
        existing.push(app)
      }
    }
  }
  return new Map([...renames.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

/**
 * Count the tasks whose domains were all harness markers, so the catalog can say
 * how many were set aside rather than quietly shrinking the total.
 * @param intents - the raw intents.
 * @returns how many intents end up with no application at all.
 */
export function harnessOnlyCount(intents: readonly TaskIntent[]): number {
  return normalizeIntents(intents).filter(intent => intent.apps.length === 0).length
}
