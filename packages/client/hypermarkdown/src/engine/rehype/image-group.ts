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

/** One image a block shows, and the element that carries it. */
interface BlockImage {
  /** What the grid takes: the `<img>`, or the `<a>` written around it. */
  readonly node: Element
  /** The image itself, which is what the row counts. */
  readonly image: Element
}

/**
 * The image one inline node shows on its own.
 *
 * Both spellings a model uses for a sourced photograph count: a bare image, and
 * an image wrapped in the link to the page it came from — which is the whole
 * point of writing one that way, so the link travels with it.
 *
 * @param node - Any child of a paragraph.
 * @returns The image and its carrier, or undefined for anything else.
 */
function inlineImage(node: ElementContent): BlockImage | undefined {
  if (node.type !== 'element') {
    return undefined
  }

  if (node.tagName === 'img') {
    return { node, image: node }
  }

  if (node.tagName !== 'a') {
    return undefined
  }

  const content = node.children.filter(child => !(child.type === 'text' && child.value.trim() === ''))
  const [only] = content

  if (content.length !== 1 || only === undefined || only.type !== 'element' || only.tagName !== 'img') {
    return undefined
  }

  return { node, image: only }
}

/**
 * Every image a block shows, or none for a block that holds anything else.
 *
 * One paragraph may hold a whole row — a model writing several images on
 * consecutive lines produces exactly that, since a single line break is a soft
 * break rather than a new block. Prose anywhere in the paragraph ends the run.
 *
 * @param node - Any node in the tree.
 * @returns The block's images in order, or an empty list.
 */
function blockImages(node: RootContent): readonly BlockImage[] {
  if (node.type !== 'element' || node.tagName !== 'p') {
    return []
  }

  const content = node.children.filter(child => !(child.type === 'text' && child.value.trim() === ''))
  if (content.length === 0) {
    return []
  }

  const images: BlockImage[] = []

  for (const child of content) {
    const image = inlineImage(child)

    if (image === undefined) {
      return []
    }

    images.push(image)
  }

  return images
}

/**
 * The row a run of images becomes.
 * @param images - The run, in document order.
 * @returns The container the host lays out, carrying how many images it holds.
 */
function grid(images: readonly BlockImage[]): Element {
  return {
    type: 'element',
    tagName: 'div',
    properties: { className: [GRID_CLASS], 'data-count': String(images.length) },
    children: images.map(image => image.node),
  }
}

/**
 * Replace every run of two or more adjacent images with one container.
 *
 * A lone image is left as the block it was written as: one picture reads
 * better at the full width of the transcript than as a single tile.
 *
 * @param children - The children of one container, in document order.
 * @returns The same children, with each image run wrapped.
 */
function groupRuns(children: readonly RootContent[]): RootContent[] {
  const grouped: RootContent[] = []
  let images: BlockImage[] = []
  /** Gaps after the run's last image, which precede whatever follows when the run closes. */
  let trailing: RootContent[] = []
  /** Gaps between the run's own blocks, dropped from a row and restored to a lone image. */
  let inside: RootContent[] = []

  const close = (): void => {
    if (images.length > 1) {
      grouped.push(grid(images))
    } else {
      grouped.push(...images.map(image => image.node), ...inside)
    }

    grouped.push(...trailing)
    images = []
    inside = []
    trailing = []
  }

  for (const child of children) {
    const block = blockImages(child)

    if (block.length > 0) {
      if (images.length === 0) {
        grouped.push(...trailing)
        trailing = []
      } else {
        inside.push(...trailing)
        trailing = []
      }

      images.push(...block)
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
 * Group each run of images written on consecutive blocks into one container.
 *
 * A model writing a set of photographs emits one image per paragraph, which
 * paints as a stack of full-width pictures. The reader wants the set, so the
 * run becomes one container and the host lays its images out as tiles. Only the
 * structure is added here; how a tile looks stays with the host, which owns
 * every other rule for a rendered image.
 *
 * The container is renderer chrome rather than author markup, so this runs
 * after sanitization: the class and count it carries would otherwise be dropped
 * by the schema.
 *
 * @returns The rehype transform that wraps each run.
 */
export function rehypeImageGroup(): (tree: Root) => void {
  const groupContainer = (node: Root | Element): void => {
    const children = groupRuns(node.children)

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

  return (tree: Root) => { groupContainer(tree) }
}
