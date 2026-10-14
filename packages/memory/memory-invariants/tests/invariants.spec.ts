/**
 * The confirmed-invariants document: what is read from an owner's file, what the block renders for the prompt,
 * and what a write accepts or refuses. A prompt block is asserted on every request, so an unreadable document
 * contributes nothing, and a statement that would not fit is refused rather than paid for and never rendered.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@aeven/brand'
import { afterEach, describe, expect, it } from 'vitest'
import {
  INVARIANTS_CLOSE,
  INVARIANTS_GUIDANCE,
  INVARIANTS_OPEN,
  INVARIANTS_VERSION,
  InvariantStore,
  invariantsPath,
  parseInvariants,
  renderInvariants,
} from '../src/invariants.ts'
import type { Invariant, InvariantId } from '../src/types.ts'

const entry = (text: string, confirmedAt = 1): Invariant => ({ id: brandString<InvariantId>(text.slice(0, 4)), text, confirmedAt })
const document = (entries: readonly Invariant[], version = INVARIANTS_VERSION): string => JSON.stringify({ version, entries })
const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('the fixture is missing the value this assertion needs')
  return value
}
const idOf = (store: InvariantStore, owner: string, text: string): InvariantId =>
  must(store.read(owner).entries.find(candidate => candidate.text === text)).id

const directories: string[] = []
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'invariants-'))
  directories.push(root)
  return root
}
afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('parseInvariants', () => {
  it('reads a document this version wrote', () => {
    expect(parseInvariants(document([entry('Prefers tabs.')]))).toEqual([entry('Prefers tabs.')])
  })

  it('contributes nothing when the document is not readable JSON', () => {
    expect(parseInvariants('{ not json')).toEqual([])
  })

  it('contributes nothing for a version this build does not know', () => {
    expect(parseInvariants(document([entry('Prefers tabs.')], INVARIANTS_VERSION + 1))).toEqual([])
  })

  it('drops an entry that is missing a field rather than rendering it partially', () => {
    const raw = JSON.stringify({ version: INVARIANTS_VERSION, entries: [{ id: 'a', text: 'Kept.', confirmedAt: 1 }, { id: 'b' }] })
    expect(parseInvariants(raw).map(parsed => parsed.text)).toEqual(['Kept.'])
  })
})

describe('renderInvariants', () => {
  it('contributes no block at all when the owner has none', () => {
    expect(renderInvariants([], 500)).toBe('')
  })

  it('frames one entry per line, newest first', () => {
    expect(renderInvariants([entry('Second.', 2), entry('First.', 1)], 500))
      .toBe(`${INVARIANTS_OPEN}- Second.\n- First.${INVARIANTS_CLOSE}`)
  })

  it('leaves out an entry that does not fit whole rather than clipping it', () => {
    const block = renderInvariants([entry('x'.repeat(80)), entry('Short.')], 60 + INVARIANTS_OPEN.length + INVARIANTS_CLOSE.length)
    expect(block).toContain('- Short.')
    expect(block).not.toContain('xxx')
  })

  it('keeps the block within the bound it is given', () => {
    const entries = Array.from({ length: 20 }, (_, index) => entry(`Invariant number ${index}.`))
    expect(renderInvariants(entries, 200).length).toBeLessThanOrEqual(200)
  })
})

describe('InvariantStore reads', () => {
  it('answers with the owner of the document, not another owner', () => {
    const root = scratch()
    writeFileSync(invariantsPath(root, 'owner-a'), document([entry('A only.')]))
    writeFileSync(invariantsPath(root, 'owner-b'), document([entry('B only.')]))
    const store = new InvariantStore(root, 500)
    expect(store.block('owner-a')).toContain('A only.')
    expect(store.block('owner-b')).toContain('B only.')
  })

  it('contributes nothing for an owner with no document', () => {
    expect(new InvariantStore(scratch(), 500).block('nobody')).toBe('')
  })

  it('picks up a document that changed after it was first read', () => {
    const root = scratch()
    const path = invariantsPath(root, 'owner-a')
    const store = new InvariantStore(root, 500)
    expect(store.block('owner-a')).toBe('')
    writeFileSync(path, document([entry('Added later.')]))
    expect(store.block('owner-a')).toContain('Added later.')
  })

  it('escapes an owner id that would otherwise leave the directory', () => {
    expect(invariantsPath('/root', '../elsewhere')).toBe(join('/root', '..%2Felsewhere.json'))
  })

  it('states what the block costs the owner and what one statement may hold', () => {
    const store = new InvariantStore(scratch(), 500)
    store.add('owner-a', 'Prefers tabs.')
    const view = store.read('owner-a')
    expect(view.entries.map(statement => statement.text)).toEqual(['Prefers tabs.'])
    expect(view.maxChars).toBe(500)
    expect(view.maxEntryChars).toBe(500 - INVARIANTS_OPEN.length - INVARIANTS_CLOSE.length - 3)
    expect(view.chars).toBe(INVARIANTS_OPEN.length + '- Prefers tabs.'.length + INVARIANTS_CLOSE.length)
  })

  it('counts the block, not its fixed guidance, against the budget', () => {
    const store = new InvariantStore(scratch(), 500)
    store.add('owner-a', 'Prefers tabs.')
    const block = store.block('owner-a')
    expect(block).toBe(`${INVARIANTS_GUIDANCE}\n${INVARIANTS_OPEN}- Prefers tabs.${INVARIANTS_CLOSE}`)
    expect(store.read('owner-a').chars).toBe(block.length - INVARIANTS_GUIDANCE.length - 1)
  })
})

describe('InvariantStore.add', () => {
  it('writes one statement the next read renders', () => {
    const root = scratch()
    const store = new InvariantStore(root, 500)
    const added = store.add('owner-a', 'Prefers tabs.')
    expect(added.changed).toBe(true)
    expect(added.view.entries.map(statement => statement.text)).toEqual(['Prefers tabs.'])
    expect(store.block('owner-a')).toContain('- Prefers tabs.')
    expect(parseInvariants(readFileSync(invariantsPath(root, 'owner-a'), 'utf8')).map(statement => statement.text))
      .toEqual(['Prefers tabs.'])
  })

  it('stores a statement as one line', () => {
    const store = new InvariantStore(scratch(), 500)
    store.add('owner-a', '  Prefers\n\ttabs   over spaces.  ')
    expect(store.read('owner-a').entries.map(statement => statement.text)).toEqual(['Prefers tabs over spaces.'])
  })

  it('refreshes a statement that already stands instead of spending the block twice', () => {
    const store = new InvariantStore(scratch(), 500)
    const first = store.add('owner-a', 'Prefers tabs.')
    const again = store.add('owner-a', 'Prefers tabs.')
    expect(again.changed).toBe(true)
    expect(again.view.entries.map(statement => statement.text)).toEqual(['Prefers tabs.'])
    expect(again.view.entries[0]?.id).toBe(first.view.entries[0]?.id)
    expect(must(again.view.entries[0]).confirmedAt).toBeGreaterThanOrEqual(must(first.view.entries[0]).confirmedAt)
  })

  it('puts the newest statement first', () => {
    const store = new InvariantStore(scratch(), 500)
    store.add('owner-a', 'First.')
    store.add('owner-a', 'Second.')
    expect(store.read('owner-a').entries.map(statement => statement.text)).toEqual(['Second.', 'First.'])
  })

  it('refuses an empty statement and writes no document', () => {
    const root = scratch()
    const store = new InvariantStore(root, 500)
    for (const text of ['', '   ', '\n\t ']) {
      const refused = store.add('owner-a', text)
      expect(refused.changed).toBe(false)
      expect(refused.reason).toBe('empty')
    }
    expect(existsSync(invariantsPath(root, 'owner-a'))).toBe(false)
  })

  it('refuses a statement longer than the block, naming the limit', () => {
    const root = scratch()
    const store = new InvariantStore(root, 100)
    const maxEntryChars = store.read('owner-a').maxEntryChars
    expect(store.add('owner-a', 'x'.repeat(maxEntryChars)).changed).toBe(true)
    const refused = store.add('owner-b', 'y'.repeat(maxEntryChars + 1))
    expect(refused.changed).toBe(false)
    expect(refused.reason).toBe('too-long')
    expect(existsSync(invariantsPath(root, 'owner-b'))).toBe(false)
  })

  it('refuses a statement the block has no room for and leaves the document untouched', () => {
    const root = scratch()
    const store = new InvariantStore(root, 60)
    expect(store.add('owner-a', 'a'.repeat(20)).changed).toBe(true)
    const before = readFileSync(invariantsPath(root, 'owner-a'), 'utf8')
    const refused = store.add('owner-a', 'b'.repeat(20))
    expect(refused.changed).toBe(false)
    expect(refused.reason).toBe('full')
    expect(refused.view.entries.map(statement => statement.text)).toEqual(['a'.repeat(20)])
    expect(readFileSync(invariantsPath(root, 'owner-a'), 'utf8')).toBe(before)
  })

  it('replaces the document in one step, leaving no temporary file', () => {
    const root = scratch()
    new InvariantStore(root, 500).add('owner-a', 'Prefers tabs.')
    expect(existsSync(`${invariantsPath(root, 'owner-a')}.tmp`)).toBe(false)
  })

  it('writes only the owner it was asked about', () => {
    const root = scratch()
    const store = new InvariantStore(root, 500)
    store.add('owner-a', 'A only.')
    store.add('owner-b', 'B only.')
    const read = (owner: string): string[] => parseInvariants(readFileSync(invariantsPath(root, owner), 'utf8')).map(statement => statement.text)
    expect(read('owner-a')).toEqual(['A only.'])
    expect(read('owner-b')).toEqual(['B only.'])
  })

  it('picks up a write another instance made', () => {
    const root = scratch()
    const prompt = new InvariantStore(root, 500)
    expect(prompt.block('owner-a')).toBe('')
    new InvariantStore(root, 500).add('owner-a', 'Promoted while the session ran.')
    expect(prompt.block('owner-a')).toContain('Promoted while the session ran.')
  })
})

describe('InvariantStore.edit', () => {
  it('replaces the text of one statement, keeping its place and identifier', () => {
    const store = new InvariantStore(scratch(), 500)
    store.add('owner-a', 'First.')
    store.add('owner-a', 'Second.')
    const edited = store.edit('owner-a', idOf(store, 'owner-a', 'First.'), 'First, corrected.')
    expect(edited.changed).toBe(true)
    expect(edited.view.entries.map(statement => statement.text)).toEqual(['Second.', 'First, corrected.'])
    expect(edited.view.entries[1]?.id).toBe(idOf(store, 'owner-a', 'First, corrected.'))
  })

  it('refuses an edit of a statement this owner does not have', () => {
    const store = new InvariantStore(scratch(), 500)
    store.add('owner-a', 'Kept.')
    const refused = store.edit('owner-a', brandString<InvariantId>('gone'), 'Replacement.')
    expect(refused.changed).toBe(false)
    expect(refused.reason).toBe('missing')
    expect(refused.view.entries.map(statement => statement.text)).toEqual(['Kept.'])
  })

  it('refuses to empty a statement through an edit', () => {
    const store = new InvariantStore(scratch(), 500)
    store.add('owner-a', 'Kept.')
    expect(store.edit('owner-a', idOf(store, 'owner-a', 'Kept.'), '   ').reason).toBe('empty')
    expect(store.read('owner-a').entries.map(statement => statement.text)).toEqual(['Kept.'])
  })

  it('refuses an edit that no longer fits the block', () => {
    const store = new InvariantStore(scratch(), 60)
    store.add('owner-a', 'a'.repeat(20))
    const refused = store.edit('owner-a', idOf(store, 'owner-a', 'a'.repeat(20)), 'b'.repeat(60))
    expect(refused.reason).toBe('too-long')
    expect(refused.view.entries.map(statement => statement.text)).toEqual(['a'.repeat(20)])
  })
})

describe('InvariantStore.remove', () => {
  it('drops one statement and frees its share of the block', () => {
    const store = new InvariantStore(scratch(), 60)
    store.add('owner-a', 'a'.repeat(20))
    expect(store.add('owner-a', 'b'.repeat(20)).reason).toBe('full')
    const removed = store.remove('owner-a', idOf(store, 'owner-a', 'a'.repeat(20)))
    expect(removed.changed).toBe(true)
    expect(removed.view.entries).toEqual([])
    expect(store.block('owner-a')).toBe('')
    expect(store.add('owner-a', 'b'.repeat(20)).changed).toBe(true)
  })

  it('refuses to remove a statement this owner does not have', () => {
    const store = new InvariantStore(scratch(), 500)
    const refused = store.remove('owner-a', brandString<InvariantId>('gone'))
    expect(refused.changed).toBe(false)
    expect(refused.reason).toBe('missing')
    expect(existsSync(invariantsPath(scratch(), 'owner-a'))).toBe(false)
  })
})
