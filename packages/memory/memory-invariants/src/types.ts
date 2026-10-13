/**
 * The confirmed-invariants data model: what one statement is, what a management surface reads back, and what a
 * change reports. Kept apart from the document in [`invariants.ts`](invariants.ts) so a Remote boundary can name
 * these types without reaching the plugin entry.
 *
 * @module @aeven/memory-invariants/types
 */
import type { Branded } from '@aeven/brand'

/** Identifier of one confirmed invariant, stable across edits of its text. */
export type InvariantId = Branded<'InvariantId'>

/** One invariant the user confirmed. */
export interface Invariant {
  readonly id: InvariantId
  readonly text: string
  /** Epoch milliseconds the user confirmed it, so a management surface can show how current the statement is. */
  readonly confirmedAt: number
}

/** One owner's invariants and the budget their block is rendered under. */
export interface InvariantsView {
  /** Confirmed invariants, newest first. */
  readonly entries: readonly Invariant[]
  /** Characters the owner's own content costs — framing and item lines — excluding the block's fixed guidance. */
  readonly chars: number
  /** Bound on that content. The fixed guidance is never counted against it. */
  readonly maxChars: number
  /** Longest text one invariant can hold and still fit an empty block. */
  readonly maxEntryChars: number
}

/** Why a change did not happen; absent when it did. */
export type InvariantReason = 'empty' | 'missing' | 'too-long' | 'full'

/** What a change did, with the owner's state as it stands after the attempt. */
export interface InvariantChange {
  readonly changed: boolean
  readonly reason?: InvariantReason
  readonly view: InvariantsView
}

/**
 * One owner's confirmed invariants, as the management surface and the prompt block read and change them.
 *
 * Every operation is synchronous and answers from the owner's document on disk: a prompt assembly reads the
 * block at every turn and cannot await a file, and the management surface edits the same document the block is
 * rendered from, so both see one state with no cache to invalidate.
 */
export interface MemoryInvariants {
  /**
   * The owner's invariants and the budget they render under.
   * @param owner - the signed-in account id.
   * @returns the current entries, their cost, and the bound.
   */
  read(owner: string): InvariantsView
  /**
   * The block rendered into the owner's requests.
   * @param owner - the signed-in account id.
   * @returns the complete model-facing block, or the empty string when the owner has none.
   */
  block(owner: string): string
  /**
   * Promote one statement into every request of the owner. Promoting a statement that already stands refreshes
   * how current it is instead of spending the block twice.
   * @param owner - the signed-in account id.
   * @param text - the statement the user confirmed.
   * @returns what changed, with the reason when the statement was refused.
   */
  add(owner: string, text: string): InvariantChange
  /**
   * Replace the text of one invariant, keeping its place in the block.
   * @param owner - the signed-in account id.
   * @param id - identifier of the invariant to replace.
   * @param text - the replacement statement.
   * @returns what changed, with the reason when the id or text was refused.
   */
  edit(owner: string, id: InvariantId, text: string): InvariantChange
  /**
   * Drop one invariant, which frees its share of the block.
   * @param owner - the signed-in account id.
   * @param id - identifier of the invariant to drop.
   * @returns what changed, with the reason when no invariant of that owner has the id.
   */
  remove(owner: string, id: InvariantId): InvariantChange
}
