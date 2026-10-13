import { describe, expect, it } from 'vitest'
import {
  assertActionTarget,
  assertAdvertisedAction,
  assertVerified,
  composeReadinessReport,
  ComputerUseError,
  describeExpectation,
  resolveDesktopPlatform,
  resolveNode,
  verificationSatisfied,
} from '../src/guard.ts'
import type { DesktopNode, DesktopSnapshot, ReadinessProbe, VerificationOutcome } from '../src/types.ts'

const node = (overrides: Partial<DesktopNode> = {}): DesktopNode => ({
  index: 0,
  token: 's1:0',
  role: 'AXButton',
  ...overrides,
})

const snapshot = (nodes: readonly DesktopNode[]): DesktopSnapshot => ({
  snapshotId: 's1',
  platform: 'darwin',
  windows: [],
  nodes,
})

describe('action target validation', () => {
  it('accepts an element target with a token', () => {
    expect(() => { assertActionTarget({ kind: 'element', token: 's1:0' }) }).not.toThrow()
  })

  it('rejects an element target with an empty token', () => {
    expect(() => { assertActionTarget({ kind: 'element', token: '' }) }).toThrow(ComputerUseError)
    try {
      assertActionTarget({ kind: 'element', token: '' })
    } catch (error) {
      expect((error as ComputerUseError).code).toBe('invalid-target')
      expect((error as ComputerUseError).detail).toEqual({ kind: 'element' })
    }
  })

  it('accepts a window target naming both pid and windowId', () => {
    expect(() => { assertActionTarget({ kind: 'window', pid: 42, windowId: 'w1' }) }).not.toThrow()
  })

  it('rejects a window target with an empty windowId', () => {
    try {
      assertActionTarget({ kind: 'window', pid: 42, windowId: '' })
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ComputerUseError).code).toBe('invalid-target')
      expect((error as ComputerUseError).detail).toEqual({ kind: 'window', pid: 42 })
    }
  })

  it('rejects unscoped point coordinates, which is the whole reason the field is required', () => {
    try {
      assertActionTarget({ kind: 'point', x: 10, y: 20 })
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ComputerUseError).code).toBe('invalid-target')
      expect((error as ComputerUseError).message).toContain('wrong window')
      expect((error as ComputerUseError).detail).toEqual({ kind: 'point', x: 10, y: 20 })
    }
  })

  it('accepts a point target scoped to a window', () => {
    expect(() => {
      assertActionTarget({ kind: 'point', x: 10, y: 20, window: { kind: 'window', pid: 42, windowId: 'w1' } })
    }).not.toThrow()
  })
})

describe('node token resolution', () => {
  it('resolves a token that belongs to the snapshot', () => {
    const target = node({ token: 's1:3', role: 'AXTextArea' })
    expect(resolveNode(snapshot([node(), target]), 's1:3')).toBe(target)
  })

  it('refuses a token from another snapshot as stale rather than acting on a position', () => {
    try {
      resolveNode(snapshot([node()]), 's9:7')
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ComputerUseError).code).toBe('stale-token')
      expect((error as ComputerUseError).message).toContain('re-observe')
      expect((error as ComputerUseError).detail).toEqual({ snapshotId: 's1', token: 's9:7' })
    }
  })
})

describe('advertised accessibility actions', () => {
  it('permits an action the node advertises', () => {
    expect(() => { assertAdvertisedAction(node({ actions: ['press', 'showmenu'] }), 'press') }).not.toThrow()
  })

  it('refuses an unadvertised action and reports what the node does expose', () => {
    try {
      assertAdvertisedAction(node({ role: 'AXTextField', actions: ['press'] }), 'increment')
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ComputerUseError).code).toBe('unknown-action')
      expect((error as ComputerUseError).detail).toEqual({ token: 's1:0', role: 'AXTextField', advertised: ['press'] })
    }
  })

  it('refuses every action when the node advertises none', () => {
    expect(() => { assertAdvertisedAction(node(), 'press') }).toThrow(ComputerUseError)
  })
})

describe('verification outcomes', () => {
  const outcome = (satisfied: boolean): VerificationOutcome => ({
    expectation: { kind: 'fileExists', path: '/tmp/x' },
    satisfied,
  })

  it('treats an empty expectation list as unproven, never as success', () => {
    expect(verificationSatisfied([])).toBe(false)
    expect(() => { assertVerified([], 'write document') }).toThrow(ComputerUseError)
  })

  it('requires every expectation to hold', () => {
    expect(verificationSatisfied([outcome(true), outcome(true)])).toBe(true)
    expect(verificationSatisfied([outcome(true), outcome(false)])).toBe(false)
  })

  it('names the operation and carries the failing outcomes', () => {
    try {
      assertVerified([outcome(false)], 'write document')
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ComputerUseError).code).toBe('unverified')
      expect((error as ComputerUseError).message).toContain('write document')
      expect((error as ComputerUseError).detail).toEqual({
        outcomes: [{ expectation: 'fileExists', satisfied: false, observed: undefined }],
      })
    }
  })

  it('describes an unlabelled verification failure without inventing a name', () => {
    expect(() => { assertVerified([outcome(false)]) }).toThrow(/could not be verified/)
  })

  it('returns quietly when every expectation held', () => {
    expect(() => { assertVerified([outcome(true)], 'write document') }).not.toThrow()
  })
})

describe('platform resolution', () => {
  it('accepts exactly the three covered platforms', () => {
    expect(resolveDesktopPlatform('darwin')).toBe('darwin')
    expect(resolveDesktopPlatform('win32')).toBe('win32')
    expect(resolveDesktopPlatform('linux')).toBe('linux')
  })

  it('refuses an uncovered platform instead of guessing one', () => {
    try {
      resolveDesktopPlatform('freebsd')
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ComputerUseError).code).toBe('invalid-target')
      expect((error as ComputerUseError).detail).toEqual({ platform: 'freebsd' })
    }
  })
})

describe('readiness composition', () => {
  // `remedy` is spread conditionally, not passed as possibly-undefined: under
  // exactOptionalPropertyTypes an explicit undefined is a present property of the
  // wrong type, and the report distinguishes "no remedy" from "remedy: undefined".
  const probe = (name: string, state: ReadinessProbe['state'], remedy?: string): ReadinessProbe =>
    ({ name, state, ...(remedy === undefined ? {} : { remedy }) })

  it('derives blockers from the probes so a report cannot contradict itself', () => {
    const report = composeReadinessReport('darwin', [
      probe('accessibility.read', 'ready'),
      probe('screenRecording.capture', 'blocked'),
    ])
    expect(report.platform).toBe('darwin')
    expect(report.blockers).toEqual(['screenRecording.capture'])
  })

  it('offers the blocked capability remedy as the next step', () => {
    const report = composeReadinessReport('darwin', [probe('accessibility.read', 'blocked', 'Grant Accessibility to Aeven')])
    expect(report.recommendedNextStep).toBe('Grant Accessibility to Aeven')
  })

  it('omits a next step when the blocked capability has no remedy', () => {
    const report = composeReadinessReport('linux', [probe('windowing.backend', 'blocked')])
    expect(report.blockers).toEqual(['windowing.backend'])
    expect(report.recommendedNextStep).toBeUndefined()
  })

  it('reports no blockers and no next step on a fully ready host', () => {
    const report = composeReadinessReport('win32', [probe('uia.tree', 'ready')])
    expect(report.blockers).toEqual([])
    expect(report.recommendedNextStep).toBeUndefined()
  })

  it('keeps unknown distinct from blocked so a probe that could not run is not a missing grant', () => {
    const report = composeReadinessReport('linux', [probe('sessionBus.reach', 'unknown'), probe('atspi.tree', 'blocked', 'Start the session bus')])
    expect(report.blockers).toEqual(['atspi.tree'])
    expect(report.probes.map(entry => entry.state)).toEqual(['unknown', 'blocked'])
  })

  it('copies the probe list rather than aliasing the caller array', () => {
    const probes: ReadinessProbe[] = [probe('uia.tree', 'ready')]
    const report = composeReadinessReport('win32', probes)
    probes.push(probe('later', 'blocked'))
    expect(report.probes).toHaveLength(1)
    expect(report.blockers).toEqual([])
  })
})

describe('expectation descriptions', () => {
  it('names each observable in one vocabulary across adapters', () => {
    expect(describeExpectation({ kind: 'fileExists', path: '/tmp/a' })).toBe('file exists: /tmp/a')
    expect(describeExpectation({ kind: 'fileContains', path: '/tmp/a', text: 'hi' })).toBe('file contains "hi": /tmp/a')
    expect(describeExpectation({ kind: 'fileEquals', path: '/tmp/a', text: 'hi' })).toBe('file equals "hi": /tmp/a')
    expect(describeExpectation({ kind: 'fileNewerThan', path: '/tmp/a', sinceMs: 5 })).toBe('file modified after 5: /tmp/a')
    expect(describeExpectation({ kind: 'nodeValueEquals', token: 's1:0', value: 'x' })).toBe('element value equals "x"')
    expect(describeExpectation({ kind: 'windowTitled', title: 'Doc' })).toBe('a window is titled "Doc"')
  })

  it('describes the semantic kinds, including both sides of each optional field', () => {
    // The two-sided checks are the point: an omitted calendar and a named one are
    // different claims, and a description that read the same for both would tell a
    // caller nothing about what was actually verified.
    expect(describeExpectation({ kind: 'appObject', app: 'Calendar', collection: 'events', match: { summary: 'Standup' } }))
      .toBe('Calendar has a events matching {"summary":"Standup"}')
    expect(describeExpectation({ kind: 'calendarHasEvent' })).toBe('a calendar holds the expected event')
    expect(describeExpectation({ kind: 'calendarHasEvent', calendar: 'Work' }))
      .toBe('the calendar "Work" holds the expected event')
    expect(describeExpectation({ kind: 'noteExists', name: 'Groceries' })).toBe('a note named "Groceries" exists')
    expect(describeExpectation({ kind: 'noteExists', name: 'Groceries', folder: 'Home' }))
      .toBe('a note named "Groceries" exists in "Home"')
  })
})
