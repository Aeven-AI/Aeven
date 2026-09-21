/**
 * The accessibility walk's parser, node indexing, and window listing.
 *
 * The walk script itself cannot run without the Accessibility grant — it is
 * measured to return `-25201` from a spawned helper — so this suite covers the
 * half that can be tested: everything that turns the walk's output into indexed
 * nodes, and the refusal that keeps a missing grant from looking like an
 * application with no UI.
 */

import { describe, expect, it } from 'vitest'
import { ComputerUseError } from '@aeven/computer-use-desktop'
import {
  axActionScript,
  axSnapshotId,
  axWalkScript,
  DEFAULT_AX_NODE_CAP,
  indexAxNodes,
  parseAxEnvelope,
  type RawAxNode,
} from '../src/ax.ts'
import { hasWindows, listWindowsScript, parsePair, parseWindowList } from '../src/windows.ts'

const rawNode = (overrides: Partial<RawAxNode> = {}): RawAxNode => ({
  depth: 0,
  role: 'AXButton',
  title: '',
  description: '',
  value: '',
  actions: [],
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  ...overrides,
})

describe('walk envelope parsing', () => {
  it('reads a successful walk', () => {
    const envelope = parseAxEnvelope('{"ok":true,"nodes":[],"truncated":true}', 'walk')
    expect(envelope.ok).toBe(true)
    expect(envelope.truncated).toBe(true)
  })

  it('takes the last line, so a script that prints before its envelope still parses', () => {
    const envelope = parseAxEnvelope('a warning\n{"ok":true,"nodes":[]}', 'walk')
    expect(envelope.nodes).toEqual([])
  })

  it('explains a missing Accessibility grant as a permission problem, not an empty tree', () => {
    try {
      parseAxEnvelope('{"ok":false,"error":"no app","axError":-25201}', 'walk')
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ComputerUseError).code).toBe('capability-unavailable')
      expect((error as ComputerUseError).message).toContain('not permitted')
      expect((error as ComputerUseError).message).toContain('spawned helper')
      expect((error as ComputerUseError).detail).toEqual({ axError: -25201 })
    }
  })

  it('passes through other AX errors with their code attached', () => {
    try {
      parseAxEnvelope('{"ok":false,"error":"gone","axError":-25204}', 'walk')
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ComputerUseError).message).toBe('gone')
      expect((error as ComputerUseError).detail).toEqual({ axError: -25204 })
    }
  })

  it('supplies a reason when a failure reported none', () => {
    expect(() => parseAxEnvelope('{"ok":false}', 'walking')).toThrow(/walking failed without a reported reason/)
  })

  it('refuses empty output rather than treating it as an empty tree', () => {
    expect(() => parseAxEnvelope('   \n ', 'walk')).toThrow(/produced no output/)
  })

  it('refuses output that is not JSON and keeps what it saw', () => {
    try {
      parseAxEnvelope('not json', 'walk')
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as ComputerUseError).message).toContain('not JSON')
      expect((error as ComputerUseError).detail).toEqual({ output: 'not json' })
    }
  })
})

describe('node indexing', () => {
  it('mints tokens from the snapshot id and the walk position', () => {
    const nodes = indexAxNodes([rawNode(), rawNode({ role: 'AXTextArea' })], 'ax:1:w:0')
    expect(nodes.map(node => node.token)).toEqual(['ax:1:w:0:0', 'ax:1:w:0:1'])
    expect(nodes.map(node => node.index)).toEqual([0, 1])
  })

  it('prefers the title and falls back to the description', () => {
    const nodes = indexAxNodes([
      rawNode({ title: 'Body', description: 'ignored' }),
      rawNode({ title: '', description: 'Close' }),
    ], 's')
    expect(nodes[0]?.title).toBe('Body')
    expect(nodes[1]?.title).toBe('Close')
  })

  it('omits title and value when the walk reported neither', () => {
    const [node] = indexAxNodes([rawNode()], 's')
    expect(node?.title).toBeUndefined()
    expect(node?.value).toBeUndefined()
  })

  it('carries bounds and the advertised actions through unchanged', () => {
    const [node] = indexAxNodes([rawNode({ x: 1, y: 2, width: 3, height: 4, actions: ['AXPress'] })], 's')
    expect(node?.bounds).toEqual({ x: 1, y: 2, width: 3, height: 4 })
    expect(node?.actions).toEqual(['AXPress'])
  })

  it('treats a text area or a set-value advertisement as editable', () => {
    const nodes = indexAxNodes([
      rawNode({ role: 'AXTextArea' }),
      rawNode({ role: 'AXTextField' }),
      rawNode({ actions: ['AXSetValue'] }),
      rawNode({ role: 'AXButton' }),
    ], 's')
    expect(nodes.map(node => node.editable)).toEqual([true, true, true, false])
  })

  it('indexes an empty walk as no nodes', () => {
    expect(indexAxNodes([], 's')).toEqual([])
  })

  it('encodes the owning window in the snapshot id, so a token is self-describing', () => {
    const id = axSnapshotId({ windowId: 'Agent Story.pages', pid: 42, app: { id: 'Pages' } }, 7)
    expect(id).toBe('ax:42:Agent Story.pages:7')
  })
})

describe('generated scripts are well-formed', () => {
  it('emits both scripts as non-empty source containing their entry points', () => {
    expect(axWalkScript(String(DEFAULT_AX_NODE_CAP))).toContain('kAXFocusedApplicationAttribute')
    expect(axActionScript('0', "'AXPress'", "''", 'AXSetValue')).toContain('AXUIElementPerformAction')
  })

  it('checks the advertised actions before performing one, listing them on refusal', () => {
    const script = axActionScript('3', "'AXPress'", "''", 'AXSetValue')
    expect(script).toContain('advertised.indexOf(wantedAction) < 0')
    expect(script).toContain('it advertises:')
  })

  it('routes the value path through the attribute setter rather than an action', () => {
    const script = axActionScript('0', "'AXSetValue'", "'hello'", 'AXSetValue')
    expect(script).toContain('AXUIElementSetAttributeValue')
  })

  it('emits its failure before throwing, because osascript has no exit', () => {
    const script = axWalkScript('1')
    // osascript provides no exit(), so the reason goes to stdout and the throw
    // supplies the non-zero status the caller branches on.
    expect(script).not.toContain('$.exit')
    const fail = script.slice(script.indexOf('function fail'))
    expect(fail.indexOf('emit(')).toBeLessThan(fail.indexOf('throw new Error'))
  })

  it('lists windows without leaking an unescaped quote into the JSON', () => {
    const script = listWindowsScript()
    expect(script).toContain('on escape(value)')
    expect(script).toContain('background only is false')
  })
})

describe('window listing', () => {
  it('parses position and size into bounds and marks a zero-sized window off screen', () => {
    const stdout = JSON.stringify([
      { pid: 42, app: 'Pages', title: 'Agent Story.pages', position: '10, 20', size: '800, 600' },
      { pid: 43, app: 'Mail', title: 'Inbox', position: '0, 0', size: '0, 0' },
    ])
    const windows = parseWindowList(stdout)
    expect(windows[0]).toMatchObject({
      windowId: 'Agent Story.pages',
      pid: 42,
      title: 'Agent Story.pages',
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      onScreen: true,
    })
    expect(windows[1]?.onScreen).toBe(false)
    expect(windows[0]?.app).toEqual({ id: 'Pages', displayName: 'Pages' })
  })

  it('reads unreadable numbers as zero rather than NaN', () => {
    expect(parsePair('')).toEqual({ a: 0, b: 0 })
    expect(parsePair('nonsense')).toEqual({ a: 0, b: 0 })
    expect(parsePair('5')).toEqual({ a: 5, b: 0 })
  })

  it('takes the last line so an AppleScript warning does not break the parse', () => {
    expect(parseWindowList('warning\n[]')).toEqual([])
  })

  it('refuses empty or unreadable output instead of reporting no windows', () => {
    expect(() => parseWindowList('  ')).toThrow(/produced no output/)
    expect(() => parseWindowList('not json')).toThrow(/was not JSON/)
  })

  it('reports whether a process row owns any window', () => {
    expect(hasWindows({ pid: 1, name: 'a', windows: [] })).toBe(false)
    expect(hasWindows({ pid: 1, name: 'a', windows: [{ name: 'w', position: '0, 0', size: '1, 1' }] })).toBe(true)
  })
})
