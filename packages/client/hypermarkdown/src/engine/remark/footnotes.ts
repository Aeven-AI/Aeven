import { SKIP, visit } from 'unist-util-visit'

import type { Root as MdastRoot } from 'mdast'
import type { VFile } from 'vfile'

/**
 * Lift footnote definitions out of the tree and onto the file.
 *
 * A definition can arrive in a chunk long after the reference that needs it,
 * so leaving it in place would render it as stray text under the block it
 * happened to land in.
 *
 * @returns The remark transform that collects footnote definitions on the
 *   file's data and takes them out of the tree.
 */
export function remarkFootnotes(): (tree: MdastRoot, file: VFile) => void {
  return (tree: MdastRoot, file: VFile) => {
    const data = file.data as typeof file.data & {
      footnoteDefinitions?: unknown[]
    }

    data.footnoteDefinitions ||= []

    visit(tree, 'footnoteDefinition', (_node, index, parent) => {
      if (parent && index !== undefined) {
        parent.children.splice(index, 1)
      }

      return [SKIP, index]
    })
  }
}
