/** Date groups of the Artifacts grid: fixed recent groups by local calendar day, then one group per month. */
import { describe, expect, it } from 'vitest'
import type { Artifact, ArtifactId } from '@aeven/host-artifacts/types'
import { groupByDate } from '../src/client/groups.ts'

const NOW = new Date(2026, 10, 26, 15, 0, 0).getTime()
const DAY = 86_400_000

function artifact(name: string, createdAt: number): Artifact {
  return { id: name as ArtifactId, sessionId: 's' as Artifact['sessionId'], path: name, name, title: name, kind: 'document', createdAt }
}

describe('groupByDate', () => {
  it('groups by today, yesterday, the previous 7 and 30 days, then by month, newest first', () => {
    const groups = groupByDate([
      artifact('month-old', NOW - 20 * DAY),
      artifact('today', NOW - 60_000),
      artifact('september', new Date(2026, 8, 3).getTime()),
      artifact('week', NOW - 3 * DAY),
      artifact('yesterday', NOW - DAY),
      artifact('today-early', new Date(2026, 10, 26, 0, 5).getTime()),
    ], NOW)

    expect(groups.map(group => [group.key, group.items.map(item => item.name)])).toEqual([
      ['today', ['today', 'today-early']],
      ['yesterday', ['yesterday']],
      ['week', ['week']],
      ['month', ['month-old']],
      ['2026-09', ['september']],
    ])
    expect(groups.at(-1)?.fixed).toBeUndefined()
    expect(groups.at(-1)?.monthOf).toBe(new Date(2026, 8, 3).getTime())
  })

  it('returns no groups for no artifacts', () => {
    expect(groupByDate([], NOW)).toEqual([])
  })
})
