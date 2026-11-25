/**
 * Which Files pill a file request lands in: the pill showing the file, else a pill showing only the tree, so a
 * reload that returned every pill to the root does not add a pill per opened file.
 */
import { describe, expect, it } from 'vitest'
import { openTarget, type FilesPill } from '../src/client/open-target.ts'

const pill = (sessionId: string, surfaceId: string, path: string | null): FilesPill =>
  ({ sessionId, surfaceId, path, root: '/work/repo' })

describe('openTarget', () => {
  it('brings forward the pill already showing the file, by its resolved path', () => {
    const pills = [['a', pill('s1', 'files-1', null)], ['b', pill('s1', 'files-2', 'site/index.html')]] as const
    expect(openTarget(pills, 's1', '/work/repo/site/index.html', () => true)).toEqual({ key: 'b', surfaceId: 'files-2', showing: true })
  })

  it('opens the file in a pill that shows only the tree', () => {
    const pills = [['a', pill('s1', 'files-1', 'notes.md')], ['b', pill('s1', 'files-2', null)], ['c', pill('s1', 'files-3', null)]] as const
    expect(openTarget(pills, 's1', '/Users/me/Documents/Aeven/vase/index.html', () => true)).toEqual({ key: 'b', surfaceId: 'files-2', showing: false })
  })

  it('asks for a new pill when every pill shows another file, belongs to another session, or cannot open in place', () => {
    const pills = [['a', pill('s1', 'files-1', 'notes.md')], ['b', pill('s2', 'files-2', null)], ['c', pill('s1', 'files-3', null)]] as const
    expect(openTarget(pills, 's1', 'index.html', key => key !== 'c')).toBeUndefined()
  })
})
