import type { Element, ElementContent, Root, RootContent } from 'hast'

/** The container a run of images renders in; the host lays its tiles out. */
const GRID_CLASS = 'markdown-image-grid'

/**
 * Whether a node is the formatting between two blocks.
 *
 * `remark-rehype` leaves a newline between every pair of block elements, so a
 * run of images arrives as `<p>`, newline, `<p>`, newline, `<p>`. A gap that
 * carries a line break is markup formatting; a space inside a paragraph is
 * content and keeps its meaning.
 *
 * @param node - Any node in the tree.
 * @returns true for whitespace that carries a line break.
 */
function isBlockGap(node: RootContent): boolean {
  return node.type === 'text' && node.value.trim() === '' && /[\r\n]/.test(node.value)
}

/**
 * The content of a paragraph that is not whitespace.
 * @param node - A paragraph or link.
 * @returns Its children without blank text nodes.
 */
export function meaningfulChildren(node: Element): ElementContent[] {
  return node.children.filter(child => !(child.type === 'text' && child.value.trim() === ''))
}

/**
 * The image one inline node shows on its own.
 *
 * Both spellings a model uses for a sourced photograph count: a bare image, and
 * an image wrapped in the link to the page it came from — which is the whole
 * point of writing one that way, so the link travels with it.
 *
 * @param node - Any child of a paragraph.
 * @returns What the grid takes — the `<img>`, or the `<a>` written around it —
 * or undefined for anything else.
 */
function inlineImage(node: ElementContent): Element | undefined {
  if (node.type !== 'element') {
    return undefined
  }

  if (node.tagName === 'img') {
    return node
  }

  if (node.tagName !== 'a') {
    return undefined
  }

  const [only, ...rest] = meaningfulChildren(node)

  return rest.length === 0 && only?.type === 'element' && only.tagName === 'img' ? node : undefined
}

/**
 * Every item one paragraph shows, or none for a block that holds anything else.
 *
 * One paragraph may hold a whole row — a model writing several items on
 * consecutive lines produces exactly that, since a single line break is a soft
 * break rather than a new block. Prose anywhere in the paragraph ends the run.
 *
 * @param node - Any node in the tree.
 * @param item - What one inline child shows, or undefined when it is not an item.
 * @returns The block's items in order, or an empty list.
 */
export function paragraphItems(node: RootContent, item: (child: ElementContent) => Element | undefined): readonly Element[] {
  if (node.type !== 'element' || node.tagName !== 'p') {
    return []
  }

  const content = meaningfulChildren(node)
  const items: Element[] = []

  for (const child of content) {
    const found = item(child)

    if (found === undefined) {
      return []
    }

    items.push(found)
  }

  return items
}

/** How one kind of run is recognised and wrapped. */
export interface RunGrouping {
  /** The items a block holds, or an empty list when it is not part of a run. */
  readonly items: (node: RootContent) => readonly Element[]
  /** The container a run becomes. */
  readonly wrap: (items: readonly Element[]) => Element
  /** The fewest items a run needs before it is wrapped; a shorter run keeps the blocks it was written as. */
  readonly minimum: number
}

/**
 * Replace every qualifying run of adjacent item blocks with one container.
 *
 * @param children - The children of one container, in document order.
 * @param grouping - Which blocks form a run and what the run becomes.
 * @returns The same children, with each qualifying run wrapped.
 */
function groupRuns(children: readonly RootContent[], grouping: RunGrouping): RootContent[] {
  const grouped: RootContent[] = []
  let items: Element[] = []
  /** The run as written — its blocks and the gaps between them — for a run too short to wrap. */
  let written: RootContent[] = []
  /** Gaps after the run's last block, which precede whatever follows when the run closes. */
  let trailing: RootContent[] = []

  const close = (): void => {
    if (items.length >= grouping.minimum) {
      grouped.push(grouping.wrap(items))
    } else {
      grouped.push(...written)
    }

    grouped.push(...trailing)
    items = []
    written = []
    trailing = []
  }

  for (const child of children) {
    const block = grouping.items(child)

    if (block.length > 0) {
      if (items.length === 0) {
        grouped.push(...trailing)
      } else {
        written.push(...trailing)
      }

      trailing = []
      written.push(child)
      items.push(...block)
      continue
    }

    if (isBlockGap(child)) {
      trailing.push(child)
      continue
    }

    close()
    grouped.push(child)
  }

  close()

  return grouped
}

/**
 * Apply one run grouping to a tree, in every container but a paragraph.
 * @param tree - The document.
 * @param grouping - Which blocks form a run and what the run becomes.
 */
export function groupTree(tree: Root, grouping: RunGrouping): void {
  const groupContainer = (node: Root | Element): void => {
    const children = groupRuns(node.children, grouping)

    node.children = node.type === 'root'
      ? children
      // An element's children hold no doctype, which is the only node the run
      // helper can carry through from the root.
      : children.filter((child): child is ElementContent => child.type !== 'doctype')

    for (const child of node.children) {
      // A paragraph's content is inline: there is nothing to group inside one.
      if (child.type === 'element' && child.tagName !== 'p') {
        groupContainer(child)
      }
    }
  }

  groupContainer(tree)
}

/**
 * Group each run of images written on consecutive blocks into one container.
 *
 * A model writing a set of photographs emits one image per paragraph, which
 * paints as a stack of full-width pictures. The reader wants the set, so a run
 * of two or more becomes one `div.markdown-image-grid` carrying `data-count`,
 * and the host lays its images out as tiles. A lone image keeps the paragraph it
 * was written in: one picture reads better at the full width of the transcript
 * than as a single tile. Only the structure is added here; how a tile looks
 * stays with the host, which owns every other rule for a rendered image.
 *
 * The container is renderer chrome rather than author markup, so this runs
 * after sanitization: the class and count it carries would otherwise be dropped
 * by the schema.
 *
 * @returns The rehype transform that wraps each run.
 */
export function rehypeImageGroup(): (tree: Root) => void {
  const grouping: RunGrouping = {
    items: node => paragraphItems(node, inlineImage),
    wrap: images => ({
      type: 'element',
      tagName: 'div',
      properties: { className: [GRID_CLASS], 'data-count': String(images.length) },
      children: [...images],
    }),
    minimum: 2,
  }

  return (tree: Root) => { groupTree(tree, grouping) }
}
