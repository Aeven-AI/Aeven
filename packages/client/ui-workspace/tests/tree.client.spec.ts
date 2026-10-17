import { describe, expect, it } from 'vitest'
import type {
  SessionListState, SessionSearchResultItem, SessionSummary,
} from '@aeven/api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@aeven/api-workspace-controller/client'
import type { SessionPendingInteractionBase } from '@aeven/client-ui-session/client'
import type { ScheduleId, ScheduleRecord } from '@aeven/schedule/client'
import type { SessionId, SessionSeq } from '@aeven/session/types'
import {
  deriveGroups, deriveSearchResults, deriveStatusBuckets, owningGroupKey, sessionBucket,
  STATUS_BUCKET_KEYS, workspaceLabel, UNGROUPED_KEY,
} from '../src/client/tree.ts'
import { createWorkspaceViewStore } from '../src/client/stores.ts'

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId
const searchHit = (sessionId: SessionId, snippet: string, at = 1): SessionSearchResultItem =>
  ({ sessionId, seq: at as SessionSeq, snippet })
const summary = (id: string, updatedAt: number, cwd?: string): SessionSummary => ({
  id: sid(id), createdAt: 0, displayTitle: id, title: id, running: false, blank: false,
  updatedAt, ...(cwd === undefined ? {} : { cwd }),
})
const list = (...items: SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined,
  phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
})
const workspace = (id: string, sessionIds: string[], title = id): WorkspaceView => ({
  workspaceId: wid(id), kind: 'folder', isDefault: false, isBuiltIn: false, path: `/projects/${id}`, title,
  sessionIds: sessionIds.map(sid), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
const view = (expandedGroups: readonly string[] = [], ungroupedOrder?: readonly string[]) => ({
  expandedGroups,
  ...(ungroupedOrder === undefined ? {} : { ungroupedOrder }),
})
/** Browser-safe job row the list carries; `status` is its whole live/settled fact. */
type SessionJobRow = SessionListState['jobsBySession'][SessionId][number]
const job = (id: string, status: SessionJobRow['status']): SessionJobRow => ({
  id: id as SessionJobRow['id'], kind: 'bash', label: id, status, startedAt: 1,
})
const noArchive: readonly SessionId[] = []
const noAttention: ReadonlyMap<SessionId, SessionPendingInteractionBase> = new Map()
/** Every status bucket's rows in bucket order, under the reader's default open folds. */
const statusRows = (
  sessions: SessionListState,
  archive: readonly SessionId[] = noArchive,
  attention = noAttention,
  hidden = new Set<SessionId>(),
) => deriveStatusBuckets(sessions, archive, attention, hidden, {}).flatMap(bucket => bucket.sessions)
const archived = (...ids: string[]): readonly SessionId[] => ids.map(sid)
const schedule = (id: string, scheduledAt: string): ScheduleRecord => ({
  id: id as ScheduleId,
  kind: 'at',
  prompt: id,
  scheduledAt,
})

describe('owningGroupKey', () => {
  it('returns the owning Workspace id or the Ungrouped key', () => {
    const workspaces = [workspace('first', ['owned'])]
    expect(owningGroupKey(workspaces, sid('owned'))).toBe('first')
    expect(owningGroupKey(workspaces, sid('loose'))).toBe(UNGROUPED_KEY)
  })
})

describe('deriveGroups', () => {
  it('keeps Host Workspace and sessionIds order without Client recency sorting', () => {
    const sessions = list(summary('newer', 20), summary('older', 10))
    const workspaces = [workspace('first', ['older', 'newer']), workspace('empty', [])]
    const groups = deriveGroups(sessions, workspaces, noArchive, noAttention, view(['first']))
    expect(groups.map(group => group.key)).toEqual(['first', 'empty'])
    expect(groups[0]!.sessions.map(session => session.id)).toEqual([sid('older'), sid('newer')])
  })

  it('reads a directory-less Workspace as no directory rather than as a literal null', () => {
    // The wire states "no directory" as JSON `null`, and the grouping vocabulary
    // states it as `undefined`; the translation happens once, so absence must not
    // survive as a value a consumer could mistake for a real path.
    const sessions = list(summary('member', 10))
    const workspaces = [{ ...workspace('plain', ['member']), path: null }]
    const groups = deriveGroups(sessions, workspaces, noArchive, noAttention, view(['plain']))
    expect(groups[0]!.cwd).toBeUndefined()
  })

  it('projects pending-interaction state into grouped and status rows', () => {
    const awaiting = { ...summary('awaiting', 10), running: true }
    const sessions = list(awaiting)
    const attention: ReadonlyMap<SessionId, SessionPendingInteractionBase> = new Map([[
      awaiting.id,
      { key: 'question:1', kind: 'plan-review', sessionId: awaiting.id },
    ]])
    const grouped = deriveGroups(
      sessions, [workspace('project', ['awaiting'])], noArchive, attention, view(['project']),
    )
    expect(grouped[0]!.sessions[0]).toMatchObject({ pendingInteraction: 'plan-review', running: true })
    expect(statusRows(sessions, noArchive, attention)[0])
      .toMatchObject({ pendingInteraction: 'plan-review', running: true })
  })

  it.each(['approval', 'question'] as const)(
    'projects the %s pending-interaction kind',
    (kind) => {
      const awaiting = summary(kind, 10)
      const attention: ReadonlyMap<SessionId, SessionPendingInteractionBase> = new Map([[
        awaiting.id,
        { key: `${kind}:1`, kind, sessionId: awaiting.id },
      ]])

      expect(statusRows(list(awaiting), noArchive, attention)[0]?.pendingInteraction).toBe(kind)
    },
  )

  it('puts only real unaccounted Sessions in the trailing Ungrouped group', () => {
    const sessions = list(summary('owned', 1, '/projects/first'), summary('loose', 9, '/other'))
    const groups = deriveGroups(
      sessions, [workspace('first', ['owned'])], noArchive, noAttention, view([UNGROUPED_KEY]),
    )
    expect(groups.map(group => group.key)).toEqual(['first', UNGROUPED_KEY])
    expect(groups[1]!.sessions.map(session => session.id)).toEqual([sid('loose')])
  })

  it('applies stored Ungrouped order and appends new loose Sessions by recency', () => {
    const sessions = list(summary('one', 3), summary('two', 2), summary('new', 4))
    const groups = deriveGroups(
      sessions,
      [],
      noArchive,
      noAttention,
      view([UNGROUPED_KEY], ['two', 'stale', 'two']),
    )
    expect(groups[0]!.sessions.map(session => session.id)).toEqual([
      sid('two'), sid('new'), sid('one'),
    ])
  })

  it('shows only the current blank session in its Workspace count and tree', () => {
    const currentBlank = { ...summary('current-blank', 5), blank: true }
    const staleBlank = { ...summary('stale-blank', 4), blank: true }
    const real = summary('shown', 3)
    const sessions = {
      ...list(real, currentBlank, staleBlank),
      current: currentBlank.id,
    }
    const groups = deriveGroups(
      sessions, [workspace('first', ['shown', 'current-blank', 'stale-blank'])],
      noArchive, noAttention, view(['first']),
    )
    expect(groups[0]!.sessions.map(session => session.id)).toEqual([real.id, currentBlank.id])
    const blankNode = groups[0]!.sessions.find(session => session.id === currentBlank.id)!
    // The stored placeholder title stays canonical; the renderer swaps in
    // the localized New Session label via the blank flag.
    expect(blankNode.title).toBe('')
    expect(blankNode.blank).toBe(true)
    expect(groups[0]!.sessions.find(session => session.id === real.id)!.blank).toBe(false)
    expect(groups[0]!.sessionCount).toBe(2)
    // A non-current blank stray never surfaces an Ungrouped bucket either.
    const strayGroups = deriveGroups(
      list({ ...summary('stray', 2), blank: true }),
      [workspace('first', [])], noArchive, noAttention, view(),
    )
    expect(strayGroups.map(group => group.key)).toEqual(['first'])
  })

  it('projects the completion reminder into session and search rows (absent = false)', () => {
    const done = { ...summary('done', 3), completed: true }
    const plain = summary('plain', 2)
    const sessions = list(done, plain)
    const groups = deriveGroups(
      sessions, [workspace('first', ['done', 'plain'])], noArchive, noAttention, view(['first']),
    )
    const doneNode = groups[0]!.sessions.find(session => session.id === done.id)!
    const plainNode = groups[0]!.sessions.find(session => session.id === plain.id)!
    expect(doneNode.completed).toBe(true)
    expect(plainNode.completed).toBe(false)
    expect(statusRows(sessions, noArchive, noAttention).find(node => node.id === done.id)!.completed).toBe(true)
    const search = deriveSearchResults(
      sessions, [workspace('first', ['done', 'plain'])], 'done', noArchive,
      noAttention, { items: [], hasMore: false }, 10,
    )
    expect(search.items[0]?.completed).toBe(true)
  })

  it('derives one active-Schedule fact for grouped, status, and search rows', () => {
    const absent = summary('absent', 4)
    const empty = { ...summary('empty', 3), projectionValues: { schedule: [] } }
    const future = {
      ...summary('future', 2),
      projectionValues: { schedule: [schedule('future', '2099-01-01T00:00:00.000Z')] },
    }
    const overdue = {
      ...summary('overdue', 1),
      projectionValues: { schedule: [schedule('overdue', '2000-01-01T00:00:00.000Z')] },
    }
    const sessions = list(absent, empty, future, overdue)
    const workspaces = [workspace('project', ['absent', 'empty', 'future', 'overdue'], 'Project')]
    const expected = [
      [sid('absent'), false],
      [sid('empty'), false],
      [sid('future'), true],
      [sid('overdue'), true],
    ]

    expect(deriveGroups(
      sessions, workspaces, noArchive, noAttention, view(['project']),
    )[0]!.sessions.map(node => [node.id, node.hasActiveSchedule])).toEqual(expected)
    expect(statusRows(sessions, noArchive, noAttention)
      .map(node => [node.id, node.hasActiveSchedule])).toEqual(expected)
    expect(deriveSearchResults(
      sessions, workspaces, 'project', noArchive, noAttention, { items: [], hasMore: false }, 10,
    ).items.map(node => [node.id, node.hasActiveSchedule])).toEqual(expected)
  })

  it('hides subagent-origin sessions without hiding ordinary forks', () => {
    const parent = summary('parent', 1)
    const subagent = {
      ...summary('subagent', 3), parentId: parent.id, origin: 'subagent' as const, running: true,
    }
    const grandchild = {
      ...summary('grandchild', 4), parentId: subagent.id, origin: 'subagent' as const, running: true,
    }
    const fork = { ...summary('fork', 2), parentId: subagent.id }
    const forkChild = {
      ...summary('fork-child', 5), parentId: fork.id, origin: 'subagent' as const, running: true,
    }
    const sessions = { ...list(parent, fork, subagent, grandchild, forkChild), current: subagent.id }
    const groups = deriveGroups(
      sessions,
      [workspace('first', ['parent', 'fork', 'subagent', 'grandchild', 'fork-child'])],
      noArchive,
      noAttention,
      view(['first']),
    )

    expect(groups[0]!.sessions.map(node => node.id)).toEqual([parent.id, fork.id])
    expect(groups[0]!.sessionCount).toBe(2)
    expect(groups[0]!.sessions[0]).toMatchObject({ running: false, runningSubagentCount: 2 })
    expect(groups[0]!.sessions[1]).toMatchObject({ running: false, runningSubagentCount: 1 })
    expect(statusRows(sessions, noArchive, noAttention).map(node => [node.id, node.runningSubagentCount])).toEqual([
      [fork.id, 1], [parent.id, 2],
    ])
    expect(deriveSearchResults(
      sessions, [workspace('first', ['parent', 'fork'])], 'parent', noArchive,
      noAttention, { items: [], hasMore: false }, 10,
    ).items[0]).toMatchObject({ id: parent.id, runningSubagentCount: 2 })
  })

  it('reports a Session’s live background jobs while it is between turns', () => {
    // A background job outlives the turn that started it: the Session's Agent
    // is idle, its job still works, and a row that reads "Completed" there
    // tells the reader the Session is finished when it is not.
    const live = summary('live', 20)
    const done = summary('done', 10)
    const sessions: SessionListState = {
      ...list(live, done),
      jobsBySession: {
        [live.id as string]: [job('bash-1', 'running'), job('bash-2', 'stopping')],
        [done.id as string]: [job('bash-3', 'completed'), job('bash-4', 'killed')],
      },
    }
    const rows = statusRows(sessions, noArchive, noAttention)

    expect(rows.map(node => [node.id, node.runningJobCount]))
      .toEqual([[live.id, 2], [done.id, 0]])
    expect(deriveSearchResults(
      sessions, [workspace('first', ['live', 'done'])], 'e', noArchive,
      noAttention, { items: [], hasMore: false }, 10,
    ).items.map(node => [node.id, node.runningJobCount]))
      .toEqual([[live.id, 2], [done.id, 0]])
  })

  it('ignores fork lineage and sorts every ungrouped session as a top-level row', () => {
    const parent = summary('parent', 1)
    const oldChild = { ...summary('old-child', 10), parentId: parent.id }
    const newChild = { ...summary('new-child', 20), parentId: parent.id }
    const tieB = { ...summary('tie-b', 20), parentId: parent.id }
    const tieA = { ...summary('tie-a', 20), parentId: parent.id }
    const self = { ...summary('self', 2), parentId: sid('self') }
    const orphan = { ...summary('orphan', 3), parentId: sid('missing') }
    const cycleA = { ...summary('cycle-a', 4), parentId: sid('cycle-b') }
    const cycleB = { ...summary('cycle-b', 5), parentId: sid('cycle-a') }
    const groups = deriveGroups(
      list(parent, oldChild, newChild, tieB, tieA, self, orphan, cycleA, cycleB),
      [],
      noArchive,
      noAttention,
      { expandedGroups: [UNGROUPED_KEY] },
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]!.sessions.map(node => node.id)).toEqual([
      newChild.id, tieA.id, tieB.id, oldChild.id,
      cycleB.id, cycleA.id, orphan.id, self.id, parent.id,
    ])

    // Equal timestamps use ids as a deterministic tiebreak in either input order.
    expect(deriveGroups(
      list(summary('tie-a', 1), summary('tie-b', 1)), [], noArchive, noAttention, view([UNGROUPED_KEY]),
    )[0]!
      .sessions.map(node => node.id)).toEqual([sid('tie-a'), sid('tie-b')])
  })

  it('tolerates Workspace membership arriving before its Session summary', () => {
    const partial: SessionListState = {
      ...list(),
      ids: [sid('present')],
      byId: { [sid('present')]: summary('present', 1) },
    }
    const groups = deriveGroups(
      partial, [workspace('project', ['missing', 'present'])], noArchive, noAttention, view(['project']),
    )
    expect(groups[0]!.sessions.map(node => node.id)).toEqual([sid('present')])
  })

  it('hides archived sessions from workspace groups and Ungrouped', () => {
    const kept = summary('kept', 1, '/projects/first')
    const gone = summary('gone', 2, '/projects/first')
    const looseGone = summary('loose-gone', 3, '/other')
    const sessions = list(kept, gone, looseGone)
    const groups = deriveGroups(
      sessions, [workspace('first', ['kept', 'gone'])], archived('gone', 'loose-gone'),
      noAttention, view(['first', UNGROUPED_KEY]),
    )
    // The archived member drops from its group AND the archived stray never
    // surfaces an Ungrouped bucket; counts follow the visible rows.
    expect(groups.map(group => group.key)).toEqual(['first'])
    expect(groups[0]!.sessions.map(node => node.id)).toEqual([kept.id])
    expect(groups[0]!.sessionCount).toBe(1)
  })

  it('marks selected Workspace and Ungrouped sessions without relying on an Intent', () => {
    const owned = summary('owned', 1)
    const loose = summary('loose', 2)
    const ws = workspace('project', ['owned'])
    const ownedGroups = deriveGroups(
      { ...list(owned, loose), current: owned.id }, [ws], noArchive, noAttention, view(),
    )
    expect(ownedGroups.find(group => group.key === 'project')!.containsCurrent).toBe(true)
    const looseGroups = deriveGroups(
      { ...list(owned, loose), current: loose.id }, [ws], noArchive, noAttention, view(),
    )
    expect(looseGroups.find(group => group.key === UNGROUPED_KEY)!.containsCurrent).toBe(true)
  })
})

describe('status buckets', () => {
  it('files every Session by what it is doing, newest first inside a bucket', () => {
    const waiting = { ...summary('waiting', 50), running: true }
    const working = { ...summary('working', 40), running: true }
    const subagentChild = {
      ...summary('subagent-child', 35), parentId: sid('parent'), origin: 'subagent' as const, running: true,
    }
    const parent = summary('parent', 30)
    const jobWork = summary('job-work', 20)
    const resting = summary('resting', 10)
    const sessions: SessionListState = {
      ...list(waiting, working, subagentChild, parent, jobWork, resting),
      jobsBySession: { [jobWork.id]: [job('bash-1', 'running')] },
    }
    const attention: ReadonlyMap<SessionId, SessionPendingInteractionBase> = new Map([[
      waiting.id,
      { key: 'question:1', kind: 'question', sessionId: waiting.id },
    ]])

    const buckets = deriveStatusBuckets(sessions, noArchive, attention, new Set(), {})

    // A Session waiting on the reader leads even while its Agent still runs;
    // its own turns, running subagents, and live jobs are all work in flight;
    // everything at rest trails.
    expect(buckets.map(bucket => [bucket.bucket, bucket.sessions.map(node => node.id)])).toEqual([
      ['needs-input', [waiting.id]],
      ['working', [working.id, parent.id, jobWork.id]],
      ['completed', [resting.id]],
    ])
    expect(buckets.map(bucket => bucket.key)).toEqual([
      STATUS_BUCKET_KEYS['needs-input'], STATUS_BUCKET_KEYS.working, STATUS_BUCKET_KEYS.completed,
    ])
    expect(buckets.map(bucket => bucket.sessionCount)).toEqual([1, 3, 1])
    // A bucket is a product section, not a Workspace: no backing Workspace
    // means no Workspace header actions and no New Session control.
    expect(buckets.every(bucket => bucket.workspaceId === undefined && bucket.isBuiltIn && bucket.managed))
      .toBe(true)
  })

  it('files the provisional New Session in Needs input and leaves archived, hidden, and subagent rows out', () => {
    const real = summary('real', 2)
    const blank = { ...summary('blank', 9), blank: true }
    const hidden = summary('hidden', 8)
    const gone = summary('gone', 7)
    const subagent = { ...summary('subagent', 6), origin: 'subagent' as const, running: true }
    const rows = statusRows(
      { ...list(real, blank, hidden, gone, subagent), current: blank.id },
      archived('gone'),
      noAttention,
      new Set([hidden.id]),
    )
    // A blank New Session waits on the reader's first message, so it joins the
    // sessions blocked on them instead of reporting work it has not done.
    expect(rows.map(row => row.id)).toEqual([blank.id, real.id])
  })

  it('opens each bucket until the reader folds it, and reports the selected Session while folded', () => {
    const current = summary('current', 2)
    const older = summary('older', 1)
    const sessions = { ...list(current, older), current: current.id }

    const folded = deriveStatusBuckets(sessions, noArchive, noAttention, new Set(), {
      [STATUS_BUCKET_KEYS.completed]: false,
    })
    const closed = folded.find(bucket => bucket.bucket === 'completed')!
    expect(closed.expanded).toBe(false)
    expect(closed.sessions).toEqual([])
    expect(closed.containsCurrent).toBe(true)
    expect(closed.sessionCount).toBe(2)

    const open = deriveStatusBuckets(sessions, noArchive, noAttention, new Set(), {
      [STATUS_BUCKET_KEYS.completed]: true,
    })
    expect(open.find(bucket => bucket.bucket === 'completed')!.sessions.map(row => row.id))
      .toEqual([current.id, older.id])
  })

  it('classifies one Session from its live facts alone', () => {
    expect(sessionBucket({
      pendingInteraction: 'approval', running: true, runningSubagentCount: 2, runningJobCount: 1,
    })).toBe('needs-input')
    expect(sessionBucket({ running: true, runningSubagentCount: 0, runningJobCount: 0 })).toBe('working')
    expect(sessionBucket({ running: false, runningSubagentCount: 1, runningJobCount: 0 })).toBe('working')
    expect(sessionBucket({ running: false, runningSubagentCount: 0, runningJobCount: 1 })).toBe('working')
    expect(sessionBucket({ running: false, runningSubagentCount: 0, runningJobCount: 0 })).toBe('completed')
  })
})

describe('deriveSearchResults archive filtering', () => {
  it('archived sessions never match — not by title and not via a backend content hit', () => {
    const hit = summary('hit', 2)
    hit.displayTitle = 'Needle row'
    const gone = summary('gone', 1)
    gone.displayTitle = 'Needle archived'
    const result = deriveSearchResults(
      list(hit, gone),
      [],
      'needle',
      archived('gone'),
      noAttention,
      { items: [searchHit(gone.id, 'needle body')], hasMore: false },
      10,
    )
    expect(result.items.map(item => item.id)).toEqual([hit.id])
  })
})

describe('deriveSearchResults', () => {
  it('merges local title/Workspace matches before ranked content hits and enriches duplicates', () => {
    const titleHit = summary('title-hit', 30, '/projects/a')
    titleHit.displayTitle = 'Needle title'
    const workspaceHit = summary('workspace-hit', 20, '/projects/b')
    workspaceHit.displayTitle = 'Ordinary title'
    const contentHit = summary('content-hit', 10, '/projects/c')
    const sessions = list(titleHit, workspaceHit, contentHit)
    const result = deriveSearchResults(
      sessions,
      [
        workspace('a', ['title-hit'], 'Alpha'),
        workspace('b', ['workspace-hit'], 'Needle Workspace'),
        workspace('duplicate-owner', ['title-hit'], 'Ignored duplicate owner'),
      ],
      ' NEEDLE ',
      noArchive,
      new Map([[titleHit.id, {
        key: 'question:1', kind: 'plan-review', sessionId: titleHit.id,
      }]]),
      {
        items: [
          searchHit(contentHit.id, 'body needle excerpt', 5),
          searchHit(contentHit.id, 'ignored duplicate excerpt', 9),
          searchHit(titleHit.id, 'title session body excerpt', 2),
          searchHit(sid('unknown'), 'not in session.list'),
        ],
        hasMore: false,
      },
      10,
    )

    expect(result).toEqual({
      items: [
        {
          id: titleHit.id,
          title: 'Needle title',
          untitled: false,
          workspace: 'Alpha',
          running: false,
          runningSubagentCount: 0, runningJobCount: 0,
          pendingInteraction: 'plan-review',
          completed: false,
          hasActiveSchedule: false,
          matchSeq: 2,
          snippet: 'title session body excerpt',
        },
        {
          id: workspaceHit.id,
          title: 'Ordinary title',
          untitled: false,
          workspace: 'Needle Workspace',
          running: false,
          runningSubagentCount: 0, runningJobCount: 0,
          completed: false,
          hasActiveSchedule: false,
        },
        {
          id: contentHit.id,
          title: 'content-hit',
          untitled: false,
          workspace: 'c',
          running: false,
          runningSubagentCount: 0, runningJobCount: 0,
          completed: false,
          hasActiveSchedule: false,
          matchSeq: 5,
          snippet: 'body needle excerpt',
        },
      ],
      hasMore: false,
    })
  })

  it('excludes blank sessions from search regardless of query or content hits', () => {
    const currentBlank = { ...summary('opaque-current', 5), blank: true }
    const staleBlank = { ...summary('new session stale', 4), blank: true }
    const sessions = {
      ...list(currentBlank, staleBlank),
      current: currentBlank.id,
    }
    // Blank placeholders never match — not their localized-display title, not
    // their id, and not even a backend content hit naming them.
    const result = deriveSearchResults(
      sessions,
      [workspace('first', ['opaque-current', 'new session stale'])],
      'new session',
      noArchive,
      noAttention,
      {
        items: [
          searchHit(staleBlank.id, 'stale body', 3),
          searchHit(currentBlank.id, 'current body', 4),
        ],
        hasMore: false,
      },
      10,
    )
    expect(result.items).toEqual([])
  })

  it('uses the supplied cap and preserves either local overflow or backend hasMore', () => {
    const rows = Array.from({ length: 5 }, (_, index) => {
      const item = summary(`s-${String(index).padStart(2, '0')}`, index)
      item.displayTitle = `Needle ${String(index)}`
      return item
    })
    const overflow = deriveSearchResults(
      list(...rows),
      [],
      'needle',
      noArchive,
      noAttention,
      { items: [], hasMore: false },
      3,
    )
    expect(overflow.items).toHaveLength(3)
    expect(overflow.hasMore).toBe(true)

    const backendMore = deriveSearchResults(
      list(summary('body', 1)),
      [],
      'needle',
      noArchive,
      noAttention,
      { items: [searchHit(sid('body'), 'needle')], hasMore: true },
      3,
    )
    expect(backendMore.items).toHaveLength(1)
    expect(backendMore.hasMore).toBe(true)
    expect(deriveSearchResults(list(), [], '  ', noArchive, noAttention, { items: [], hasMore: true }, 3))
      .toEqual({ items: [], hasMore: false })
  })
})

describe('createWorkspaceViewStore', () => {
  it('stores grouping, ordering, Workspace expansion, and recent-session view order', () => {
    const store = createWorkspaceViewStore().create()
    expect(store.getSnapshot().groupBy).toBe('workspace')
    expect(store.getSnapshot().orderBy).toBe('updated')
    store.actions.setGroupBy('status')
    store.actions.setOrderBy('updated')
    store.actions.setGroupExpanded('alpha', true)
    store.actions.syncSessionOrderAccount('alpha', ['two', 'one'], { one: 1, two: 2 })
    store.actions.setSessionOrder('alpha', ['one', 'two'])
    expect(store.getSnapshot().groupBy).toBe('status')
    expect(store.getSnapshot()).toMatchObject({
      orderBy: 'updated',
      groupExpansion: { alpha: true },
      sessionOrderByAccount: { alpha: ['one', 'two'] },
      sessionUpdatedAtByAccount: { alpha: { one: 1, two: 2 } },
    })
  })

  it('removes view state outside the retained Workspace key set', () => {
    const store = createWorkspaceViewStore().create()
    store.actions.setGroupExpanded('', true)
    store.actions.setGroupExpanded('alpha', true)
    store.actions.setGroupExpanded('deleted', true)
    store.actions.syncSessionOrderAccount('alpha', ['alpha-session'], { 'alpha-session': 2 })
    store.actions.syncSessionOrderAccount('deleted', ['deleted-session'], { 'deleted-session': 1 })

    store.actions.retainAccountKeys(['', 'alpha'])

    const snapshot = store.getSnapshot()
    expect(snapshot.groupExpansion).toEqual({ '': true, alpha: true })
    expect(snapshot.sessionOrderByAccount).toEqual({ alpha: ['alpha-session'] })
    expect(snapshot.sessionUpdatedAtByAccount).toEqual({ alpha: { 'alpha-session': 2 } })
  })
})

describe('workspaceLabel', () => {
  it('uses the Ungrouped fallback and extracts POSIX and Windows basenames', () => {
    expect(workspaceLabel(undefined)).toBe('')
    expect(workspaceLabel('')).toBe('')
    expect(workspaceLabel('/projects/demo/')).toBe('demo')
    expect(workspaceLabel('C:\\projects\\demo\\')).toBe('demo')
    expect(workspaceLabel('/')).toBe('/')
  })
})
