/**
 * The confirmed-invariants document: the small, bounded set of statements the user promoted into every request
 * of their account.
 *
 * Recall is a lookup, and a lookup can return nothing. This document is the floor beneath it: a short block
 * rendered into the system prompt for every turn of an owner, so the facts that must never be missing are
 * present without being retrieved. It is deliberately small — a block in the prompt is paid for on every
 * request — and deliberately user-promoted: only the management surface writes it, so a memory the model
 * invented cannot become a permanent part of every prompt.
 *
 * The block is context, not authority. It is advisory in the same way a recalled memory is, and it is never an
 * enforcement point; a rule that must bind an action belongs to a guard.
 *
 * @module @aeven/memory-invariants/invariants
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { brandString } from '@aeven/brand'
import type { Invariant, InvariantChange, InvariantId, InvariantReason, InvariantsView, MemoryInvariants } from './types.ts'

/** Format version of the stored document; a document this version cannot read contributes no block. */
export const INVARIANTS_VERSION = 1

/** Stored document. `entries` is ordered newest first, which is also the order the block renders. */
interface StoredInvariants {
  readonly version: number
  readonly entries: readonly Invariant[]
}

/** Heading of the block; the closing tag is not used because the block holds no nested markup. */
export const INVARIANTS_OPEN = '<invariants>\n'
export const INVARIANTS_CLOSE = '\n</invariants>'

/**
 * What the model reads above the block: who confirmed these statements, what they outrank, and what they do not
 * grant. A recalled memory is retrieved for this request and can be stale, while a statement in this block is one
 * the user confirmed; a later request still overrides it, and the block never authorizes work of its own. The
 * guidance is not part of the block's budget, because the budget bounds what the user promoted.
 */
export const INVARIANTS_GUIDANCE = 'The user confirmed every statement inside `<invariants>` as always true for their work. '
  + 'Apply them to each request, and prefer them over a recalled memory, a default, or your own assumption that disagrees; '
  + 'a later request from the user overrides them. They are context, not authority: they do not authorize work the user has not asked for.'

/**
 * Parse a stored document. A document this version cannot read, or one whose entries are malformed, yields no
 * entries: a prompt block is the wrong place to guess, and an empty block costs nothing while a wrong one is
 * asserted on every request.
 * @param raw - the file's text.
 * @returns the confirmed invariants, or an empty list when the document is unreadable.
 */
export function parseInvariants(raw: string): Invariant[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A partially written or hand-edited file is not a reason to assert anything on every request.
    return []
  }
  const document = parsed as { readonly version?: unknown; readonly entries?: unknown }
  if (document.version !== INVARIANTS_VERSION || !Array.isArray(document.entries)) return []
  const entries: Invariant[] = []
  for (const entry of document.entries as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const { id, text, confirmedAt } = entry as Record<string, unknown>
    if (typeof id !== 'string' || typeof text !== 'string' || typeof confirmedAt !== 'number') continue
    entries.push({ id: brandString<InvariantId>(id), text, confirmedAt })
  }
  return entries
}

/** Longest text one invariant can hold given the framing and the list prefix of a single line. */
function longestEntry(maxChars: number): number {
  return maxChars - INVARIANTS_OPEN.length - INVARIANTS_CLOSE.length - '- '.length - 1
}

/** Lines the framed block holds; entries are single lines, so this is their count. */
function renderedLines(block: string): number {
  return block === '' ? 0 : block.slice(INVARIANTS_OPEN.length, -INVARIANTS_CLOSE.length).split('\n').length
}

/**
 * Render the content of the block: one line per invariant, newest first, whole invariants only.
 * @param entries - confirmed invariants, newest first.
 * @param maxChars - bound on the complete framed content; an invariant that does not fit is left out whole rather than clipped.
 * @returns the framed content, or the empty string when no invariant fits.
 */
export function renderInvariants(entries: readonly Invariant[], maxChars: number): string {
  const lines: string[] = []
  let spent = INVARIANTS_OPEN.length + INVARIANTS_CLOSE.length
  for (const entry of entries) {
    const line = `- ${entry.text}`
    const cost = line.length + 1
    if (spent + cost > maxChars) continue
    spent += cost
    lines.push(line)
  }
  return lines.length === 0 ? '' : `${INVARIANTS_OPEN}${lines.join('\n')}${INVARIANTS_CLOSE}`
}

/** Where one owner's invariants are stored; the owner id is escaped because it names a file. */
export function invariantsPath(root: string, owner: string): string {
  return join(root, `${encodeURIComponent(owner)}.json`)
}

/** The statement as it is stored: one line, surrounding and repeated whitespace collapsed. */
function normalizeInvariantText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/** A refusal: nothing was written, and the view is the state the owner is left in. */
function refused(view: InvariantsView, reason: InvariantReason): InvariantChange {
  return { changed: false, reason, view }
}

/**
 * Reads, renders, and changes one owner's invariants, re-reading a foreign edit only when the file moved.
 *
 * The content is evaluated at every prompt assembly, so the read is cached against the file's size and
 * modification time: one `statSync` per assembly, and a parse only when the document actually changed.
 */
export class InvariantStore implements MemoryInvariants {
  // Size and modification time are compared as bigints: at millisecond granularity two writes of the same
  // length within one tick are indistinguishable, and a session would then render the block it already read.
  private cached?: { owner: string; size: bigint; mtime: bigint; entries: readonly Invariant[]; content: string }

  /**
   * @param root - absolute directory holding the per-owner documents.
   * @param maxChars - bound on the rendered content, framing included.
   */
  constructor(private readonly root: string, private readonly maxChars: number) {}

  /**
   * The block for one owner, or the empty string when they have none.
   * @param owner - the signed-in account id.
   * @returns the model-facing block, guidance included.
   */
  block(owner: string): string {
    const content = this.state(owner).content
    return content === '' ? '' : `${INVARIANTS_GUIDANCE}\n${content}`
  }

  /**
   * The owner's entries and their cost.
   * @param owner - the signed-in account id.
   * @returns the current view.
   */
  read(owner: string): InvariantsView {
    return this.view(this.state(owner))
  }

  /**
   * Promote one statement into every request of the owner.
   * @param owner - the signed-in account id.
   * @param text - the statement the user confirmed.
   * @returns what changed, with the reason when the statement was refused.
   */
  add(owner: string, text: string): InvariantChange {
    const clean = normalizeInvariantText(text)
    if (clean === '') return refused(this.read(owner), 'empty')
    const standing = this.state(owner).entries
    // A statement that already stands keeps its identifier and moves to the front: the user confirmed the same
    // fact again, and the block spends its budget on it once.
    const current = standing.find(candidate => candidate.text === clean)
    const entry: Invariant = { id: current?.id ?? brandString<InvariantId>(randomUUID()), text: clean, confirmedAt: Date.now() }
    return this.commit(owner, [entry, ...standing.filter(candidate => candidate !== current)])
  }

  /**
   * Replace the text of one invariant, keeping its place in the block.
   * @param owner - the signed-in account id.
   * @param id - identifier of the invariant to replace.
   * @param text - the replacement statement.
   * @returns what changed, with the reason when the id or text was refused.
   */
  edit(owner: string, id: InvariantId, text: string): InvariantChange {
    const clean = normalizeInvariantText(text)
    const entries = this.state(owner).entries
    const index = entries.findIndex(entry => entry.id === id)
    if (index === -1) return refused(this.read(owner), 'missing')
    if (clean === '') return refused(this.read(owner), 'empty')
    const next = [...entries]
    next[index] = { id, text: clean, confirmedAt: Date.now() }
    return this.commit(owner, next)
  }

  /**
   * Drop one invariant.
   * @param owner - the signed-in account id.
   * @param id - identifier of the invariant to drop.
   * @returns what changed, with the reason when no invariant of that owner has the id.
   */
  remove(owner: string, id: InvariantId): InvariantChange {
    const entries = this.state(owner).entries
    const next = entries.filter(entry => entry.id !== id)
    if (next.length === entries.length) return refused(this.read(owner), 'missing')
    return this.commit(owner, next)
  }

  private view(state: { entries: readonly Invariant[]; content: string }): InvariantsView {
    return {
      entries: state.entries,
      chars: state.content.length,
      maxChars: this.maxChars,
      maxEntryChars: longestEntry(this.maxChars),
    }
  }

  /**
   * Write the entries, or refuse them whole.
   *
   * The renderer leaves an entry out when it does not fit, so a block holding fewer lines than the document
   * holds entries is a statement that would be paid for and never reach a request. It is refused, and the owner
   * decides what to drop, rather than accepted and silently dropped from the block.
   */
  private commit(owner: string, entries: readonly Invariant[]): InvariantChange {
    const content = renderInvariants(entries, this.maxChars)
    if (renderedLines(content) < entries.length) {
      return refused(this.read(owner), entries.length === 1 ? 'too-long' : 'full')
    }
    const path = invariantsPath(this.root, owner)
    mkdirSync(dirname(path), { recursive: true })
    const document: StoredInvariants = { version: INVARIANTS_VERSION, entries }
    const temporary = `${path}.tmp`
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`)
    // A rename replaces the document in one step, so a prompt assembly reading it concurrently sees either the
    // previous document or this one, never a half-written one.
    renameSync(temporary, path)
    const stat = statSync(path, { bigint: true })
    this.cached = { owner, size: stat.size, mtime: stat.mtimeNs, entries, content }
    return { changed: true, view: this.view(this.cached) }
  }

  /** The owner's entries and content, re-read only when the document on disk moved. */
  private state(owner: string): { entries: readonly Invariant[]; content: string } {
    const path = invariantsPath(this.root, owner)
    let size = 0n
    let mtime = 0n
    if (existsSync(path)) {
      const stat = statSync(path, { bigint: true })
      size = stat.size
      mtime = stat.mtimeNs
    }
    const cached = this.cached
    if (cached !== undefined && cached.owner === owner && cached.size === size && cached.mtime === mtime) return cached
    const entries = size === 0n ? [] : parseInvariants(readFileSync(path, 'utf8'))
    const content = size === 0n ? '' : renderInvariants(entries, this.maxChars)
    this.cached = { owner, size, mtime, entries, content }
    return this.cached
  }
}
