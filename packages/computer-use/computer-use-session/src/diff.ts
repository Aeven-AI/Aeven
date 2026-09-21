/**
 * Tree diffing.
 *
 * A full accessibility tree reported on every observation is the largest avoidable
 * token cost in a computer-use loop: a document window can publish hundreds of
 * nodes, and almost all of them are unchanged from the previous look. Reporting
 * only what moved turns a repeated full tree into a short delta.
 *
 * The comparison is by **position**, not by token. A token embeds its snapshot
 * id, so comparing tokens across two observations would report every node as
 * simultaneously removed and added — a delta that says nothing. The element at a
 * given position in a window's walk is the meaningful identity between two looks
 * at the same window.
 *
 * What is compared *within* a position is identity-relevant: role, title, value,
 * and whether the node is still editable. Because tokens are snapshot-scoped, a
 * node reported as unchanged carries its **current** token — the one an action
 * must use now.
 *
 * The first observation is a full tree, because there is nothing to compare
 * against. `complete` says which one the caller received, so a caller never has
 * to infer it.
 *
 * @module @aeven/computer-use-session/diff
 */

import type { DesktopNode } from '@aeven/computer-use-desktop'

/** A field that changed on a node that still exists. */
export interface NodeChange {
  /** The node's token in the newer observation, which is the one to act with. */
  token: string
  /** Position in the window's walk. */
  index: number
  /** Changed fields, as `previous → next`. */
  fields: Readonly<Record<string, { from: string | boolean | undefined, to: string | boolean | undefined }>>
}

/** What changed between two observations. */
export interface TreeDiff {
  /**
   * True when this is a full tree with nothing to compare against, rather than a
   * delta that happens to be large. A caller must not treat the first
   * observation's node list as "everything appeared".
   */
  complete: boolean
  /** Nodes present now and absent before. */
  added: readonly DesktopNode[]
  /** Positions present before and absent now. */
  removed: readonly number[]
  /** Positions present in both whose identity fields differ. */
  changed: readonly NodeChange[]
  /**
   * Positions present in both and identical. Reported as indices rather than
   * nodes, since there is nothing to act on; the current token for such a
   * position is in the observation the caller already holds.
   */
  unchanged: readonly number[]
}

/** The fields compared when a token exists in both observations. */
const COMPARED_FIELDS = ['role', 'title', 'value', 'editable'] as const

/**
 * Compare two node lists by position.
 *
 * Positions are compared only when the two observations describe the same set of
 * windows. A different window means a different walk, and comparing positions
 * across the two would report every index as changed for no reason.
 * @param previous - the previous observation's nodes, or `undefined` for the first.
 * @param next - the current observation's nodes.
 * @param sameWindows - whether both observations cover the same windows.
 * @returns the diff, marked `complete` when there was nothing to compare against.
 */
export function diffNodes(
  previous: readonly DesktopNode[] | undefined,
  next: readonly DesktopNode[],
  sameWindows = true,
): TreeDiff {
  if (previous === undefined || !sameWindows) {
    return { complete: true, added: [...next], removed: [], changed: [], unchanged: [] }
  }
  const before = new Map(previous.map(node => [node.index, node]))
  const after = new Set(next.map(node => node.index))
  const added: DesktopNode[] = []
  const changed: NodeChange[] = []
  const unchanged: number[] = []

  for (const node of next) {
    const prior = before.get(node.index)
    if (prior === undefined) {
      added.push(node)
      continue
    }
    const fields: Record<string, { from: string | boolean | undefined, to: string | boolean | undefined }> = {}
    for (const field of COMPARED_FIELDS) {
      const from = prior[field]
      const to = node[field]
      if (from !== to) {
        fields[field] = { from, to }
      }
    }
    if (Object.keys(fields).length === 0) {
      unchanged.push(node.index)
    } else {
      changed.push({ token: node.token, index: node.index, fields })
    }
  }

  const removed: number[] = []
  for (const index of before.keys()) {
    if (!after.has(index)) {
      removed.push(index)
    }
  }

  return { complete: false, added, removed, changed, unchanged }
}

/**
 * Whether a diff carries no news.
 *
 * Useful for a wait loop: an empty delta means the interface has stopped moving,
 * which is a cheaper and more reliable signal than a fixed sleep.
 * @param diff - the diff to inspect.
 * @returns true when nothing was added, removed, or changed.
 */
export function isQuiet(diff: TreeDiff): boolean {
  return !diff.complete && diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0
}

/**
 * Count the nodes a diff reports, for a step or token budget.
 * @param diff - the diff to measure.
 * @returns how many nodes the diff actually carries.
 */
export function diffSize(diff: TreeDiff): number {
  return diff.added.length + diff.removed.length + diff.changed.length
}
