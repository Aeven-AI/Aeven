/**
 * Audited debt registries for the ui-theme stylesheet sweeps. Each sweep reads
 * every sheet under `packages/client/` as its corpus, so a sheet that is off the
 * sweep's rule is recorded here instead of being fixed in a package this one does
 * not own, in the shape `scripts/doc-standard.spec.ts` uses for its README
 * registries: one entry per sheet, the exact offences it carries, and a
 * self-invalidating check (see {@link expectDebtStillOwed}) so a settled entry
 * fails until it is deleted. Only the recorded offence is excused: every other
 * rule in that sheet, and every sheet with no entry, still fails its sweep.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { relative, resolve } from 'node:path'
import { expect } from 'vitest'

/** Root the registries key their sheets against: `packages/client/`. */
const CLIENT_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** One sheet's audited deviation from a sweep's rule. */
export interface SweepDebt {
  /**
   * What the sheet is off on, in the sweep's own unit: the selectors whose rule
   * breaks the standard, or the token the sweep flagged.
   */
  readonly offences: readonly string[]
  /** What the sheet is off on, one line, naming the drift rather than its history. */
  readonly reason: string
}

/** Debt recorded for one sweep, keyed by sheet path under `packages/client/`. */
export type SweepDebtRegistry = Readonly<Record<string, SweepDebt>>

/**
 * The registry key of a sheet the sweep is reading.
 * @param file - absolute sheet path, as the sweep enumerated it.
 * @returns the sheet path under `packages/client/`.
 */
export function clientSheet(file: string): string {
  return relative(CLIENT_ROOT, file).replaceAll('\\', '/')
}

/**
 * The absolute path of a registry key.
 * @param sheet - sheet path under `packages/client/`.
 * @returns the sheet's absolute path.
 */
export function clientSheetPath(sheet: string): string {
  return resolve(CLIENT_ROOT, sheet)
}

/**
 * The offences one sheet is recorded as carrying, ready to hand a sweep as its
 * exemption set.
 * @param debt - the sweep's registry.
 * @param sheet - sheet path under `packages/client/`.
 * @returns the recorded offences, empty for a sheet with no entry.
 */
export function recordedOffences(debt: SweepDebtRegistry, sheet: string): ReadonlySet<string> {
  return new Set(debt[sheet]?.offences ?? [])
}

/**
 * Hold every recorded entry to the debt it states, so no entry outlives its
 * cause: the sheet must still exist and every offence it is recorded for must
 * still be off the rule. A sheet brought back into line therefore fails its own
 * sweep until the entry is removed.
 * @param debt - the sweep's registry.
 * @param stillOff - reports whether one recorded offence is still off the rule, recomputed from the sheet on disk.
 */
export function expectDebtStillOwed(
  debt: SweepDebtRegistry,
  stillOff: (sheet: string, offence: string) => boolean,
): void {
  for (const [sheet, entry] of Object.entries(debt)) {
    expect(entry.reason.trim(), `${sheet}: recorded debt states what the sheet is off on`).not.toBe('')
    expect(entry.offences.length, `${sheet}: recorded debt names the offences off the rule`).toBeGreaterThan(0)
    const path = clientSheetPath(sheet)
    expect(existsSync(path), `${sheet}: recorded debt names a sheet the sweep reads`).toBe(true)
    for (const offence of entry.offences) {
      expect(
        stillOff(sheet, offence),
        `${sheet} ${offence}: recorded debt is settled; delete its entry`,
      ).toBe(true)
    }
  }
}

/**
 * The text of one sheet, for a self-invalidation predicate that recomputes the
 * sweep from disk.
 * @param sheet - sheet path under `packages/client/`.
 * @returns the sheet's CSS source.
 */
export function clientSheetCss(sheet: string): string {
  return readFileSync(clientSheetPath(sheet), 'utf8')
}
