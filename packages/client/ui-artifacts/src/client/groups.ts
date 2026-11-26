/** Date groups of the Artifacts grid: Today, Yesterday, Previous 7 days, Previous 30 days, then one group per month. */
import type { Artifact } from '@aeven/host-artifacts/types'

/** The fixed groups, newest first; an older artifact falls in its calendar month. */
export type FixedGroup = 'today' | 'yesterday' | 'week' | 'month'

/** One group of the grid. */
export interface ArtifactGroup {
  /** Stable key: a fixed group's name, or `YYYY-MM` for a calendar month. */
  readonly key: string
  /** The fixed group, absent for a calendar month. */
  readonly fixed?: FixedGroup | undefined
  /** A time inside a calendar-month group, for naming it; absent for a fixed group. */
  readonly monthOf?: number | undefined
  /** The group's artifacts, newest first. */
  readonly items: readonly Artifact[]
}

const DAY_MS = 86_400_000

/**
 * Split artifacts into date groups by local calendar days.
 * @param artifacts - the artifacts in any order.
 * @param now - the current time, in Unix epoch milliseconds.
 * @returns the non-empty groups, newest first.
 */
export function groupByDate(artifacts: readonly Artifact[], now: number): ArtifactGroup[] {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const today = midnight.getTime()
  const fixedOf = (time: number): FixedGroup | undefined => {
    if (time >= today) return 'today'
    if (time >= today - DAY_MS) return 'yesterday'
    if (time >= today - 7 * DAY_MS) return 'week'
    if (time >= today - 30 * DAY_MS) return 'month'
    return undefined
  }
  const groups = new Map<string, { fixed?: FixedGroup; monthOf?: number; items: Artifact[] }>()
  for (const artifact of [...artifacts].sort((a, b) => b.createdAt - a.createdAt)) {
    const fixed = fixedOf(artifact.createdAt)
    const date = new Date(artifact.createdAt)
    const key = fixed ?? `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const group = groups.get(key)
    if (group !== undefined) group.items.push(artifact)
    else groups.set(key, fixed === undefined ? { monthOf: artifact.createdAt, items: [artifact] } : { fixed, items: [artifact] })
  }
  return [...groups].map(([key, group]) => ({ key, ...group }))
}
