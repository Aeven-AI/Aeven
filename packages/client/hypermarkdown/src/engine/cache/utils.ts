import { EXIT, visit } from 'unist-util-visit'

import type {
  Element as HastElement,
  Root as HastRoot,
  RootContent as HastContent,
} from 'hast'
import type { ElementType } from 'react'

import type { createProcessor } from '../processors.ts'

/** A pipeline that stops at hast, so a single node can be lifted out of it. */
export type CacheProcessor = ReturnType<typeof createProcessor>

/**
 * The components a cached fragment may contain. Kept narrow on purpose: a cell
 * or list item can hold a link, an image or a mermaid ref, but never a nested
 * table or fence.
 */
export type CellComponents = Record<string, ElementType>

/**
 * The first `<tr>` inside the given section of a parsed table.
 *
 * A cell is cached by lifting its row out of the parsed table, and the header
 * row is only reachable through the `thead` it sits in.
 * @param tree - the parsed table to search.
 * @param sectionTag - the section to look inside, `thead` or `tbody`.
 * @returns the section's first row element, or null when the tree holds no such
 *   section or the section has no row.
 */
export function findSectionRow(
  tree: HastRoot,
  sectionTag: 'thead' | 'tbody',
): HastElement | null {
  let rowNode: HastElement | null = null

  visit(tree, 'element', (node) => {
    if (rowNode) {
      return EXIT
    }

    if (node.tagName !== sectionTag) {
      return
    }

    node.children.forEach((child: HastContent) => {
      if (!rowNode && child.type === 'element' && child.tagName === 'tr') {
        rowNode = child
      }
    })

    return undefined
  })

  return rowNode
}

/**
 * The first `<li>` of a parsed list.
 *
 * An item is cached by lifting it out of the parsed list, which is how the
 * settled items of a streaming list avoid being re-parsed on every chunk.
 * @param tree - the parsed list to search; either an unordered or an ordered
 *   list counts.
 * @returns the first list item element, or null when the tree holds no list.
 */
export function findListItem(tree: HastRoot): HastElement | null {
  let itemNode: HastElement | null = null

  visit(tree, 'element', (node) => {
    if (itemNode) {
      return EXIT
    }

    if (node.tagName !== 'ul' && node.tagName !== 'ol') {
      return
    }

    node.children.forEach((child: HastContent) => {
      if (!itemNode && child.type === 'element' && child.tagName === 'li') {
        itemNode = child
      }
    })

    return undefined
  })

  return itemNode
}
