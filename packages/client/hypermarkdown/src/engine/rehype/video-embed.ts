import type { Element, ElementContent, Root, RootContent } from 'hast'

import { parseVideoUrl } from '../video-url.ts'
import { groupTree, meaningfulChildren, paragraphItems } from './image-group.ts'

/** The element a video becomes; the renderer's component draws it. */
export const VIDEO_TAG = 'video-embed'

/** The container a run of videos renders in; the host lays its tiles out. */
const GRID_CLASS = 'markdown-video-grid'

/**
 * The text a link reads as, for the player's accessible name.
 * @param node - Any node inside the link.
 * @returns Its text, with an image contributing its alt text.
 */
function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value
  if (node.type !== 'element') return ''
  if (node.tagName === 'img') return typeof node.properties['alt'] === 'string' ? node.properties['alt'] : ''
  return node.children.map(textOf).join('')
}

/**
 * The video one inline node links to on its own.
 *
 * Any link whose destination is a YouTube or Vimeo video counts — a bare URL, a
 * titled link, or a thumbnail image wrapped in the link — because each is how a
 * model writes "this video". The link's text becomes the player's title unless
 * it only repeats the address.
 *
 * @param node - Any child of a paragraph.
 * @returns The video element, or undefined for anything else.
 */
function inlineVideo(node: ElementContent): Element | undefined {
  if (node.type !== 'element' || node.tagName !== 'a') {
    return undefined
  }

  const href = node.properties['href']
  const video = typeof href === 'string' ? parseVideoUrl(href) : undefined

  if (video === undefined || meaningfulChildren(node).length === 0) {
    return undefined
  }

  const text = node.children.map(textOf).join('').replace(/\s+/g, ' ').trim()

  return {
    type: 'element',
    tagName: VIDEO_TAG,
    properties: {
      dataProvider: video.provider,
      dataVideoId: video.id,
      dataVideoHash: video.hash,
      dataVideoStart: video.start === undefined ? undefined : String(video.start),
      dataTitle: text === '' || text === href ? undefined : text,
    },
    children: [],
  }
}

/**
 * The container a run of videos renders in.
 * @param videos - The run's video elements, in order.
 * @returns The grid carrying the run's count.
 */
function videoGrid(videos: readonly Element[]): Element {
  return {
    type: 'element',
    tagName: 'div',
    properties: {
      className: [GRID_CLASS],
      'data-count': String(videos.length),
    },
    children: [...videos],
  }
}

/**
 * The videos a block of prose links to, each once, in order of mention.
 * @param node - A paragraph or list item.
 * @returns The video elements for its links; empty when it links to none.
 */
function mentionedVideos(node: Element): Element[] {
  const videos: Element[] = []
  const seen = new Set<string>()

  const visit = (child: ElementContent): void => {
    if (child.type !== 'element') return

    if (child.tagName === 'a') {
      const video = inlineVideo(child)
      const id = video === undefined ? undefined : String(video.properties['dataVideoId'])

      if (video !== undefined && id !== undefined && !seen.has(id)) {
        seen.add(id)
        videos.push(video)
      }

      return
    }

    child.children.forEach(visit)
  }

  node.children.forEach(visit)
  return videos
}

/**
 * Give every paragraph and list item that mentions a video in its prose a
 * player for it, after its text. The link stays where it was written, so the
 * sentence still reads; the reader watches the video without leaving.
 * @param node - A container whose blocks have already been grouped.
 */
function playMentionedVideos(node: Root | Element): void {
  const children: RootContent[] = []

  for (const child of node.children) {
    children.push(child)

    if (child.type !== 'element') continue

    if (child.tagName === 'p') {
      const videos = mentionedVideos(child)
      if (videos.length > 0) children.push(videoGrid(videos))
      continue
    }

    if (child.tagName === 'li') {
      // A list item's own nested lists hold their own mentions.
      const own: Element = { ...child, children: child.children.filter(item => !(item.type === 'element' && (item.tagName === 'ul' || item.tagName === 'ol'))) }
      const videos = child.children.some(item => item.type === 'element' && item.tagName === 'p') ? [] : mentionedVideos(own)
      if (videos.length > 0) child.children.push(videoGrid(videos))
    }

    if (child.tagName !== VIDEO_TAG && !child.properties['className']?.toString().includes(GRID_CLASS)) {
      playMentionedVideos(child)
    }
  }

  node.children = node.type === 'root'
    ? children
    : children.filter((child): child is ElementContent => child.type !== 'doctype')
}

/**
 * Turn each paragraph that holds only YouTube or Vimeo links into players, and
 * group each run of them into one `div.markdown-video-grid` carrying
 * `data-count` — a lone video included, so the host owns every video's
 * geometry in one place.
 *
 * A video linked inside prose keeps its link, and the paragraph or list item it
 * is mentioned in is followed by a player for it, so a video the reply names is
 * always one the reader can watch in place. The element carries the video's
 * identity, never its address, and the player address is rebuilt from that
 * identity, so markup cannot point a frame anywhere else.
 *
 * Runs after sanitization, like image grouping, because the elements are
 * renderer chrome the schema would drop; and before image grouping, so a
 * thumbnail linked to a video plays rather than tiling as a photograph.
 *
 * @returns The rehype transform that replaces each run.
 */
export function rehypeVideoEmbed(): (tree: Root) => void {
  return (tree: Root) => {
    groupTree(tree, {
      items: node => paragraphItems(node, inlineVideo),
      wrap: videoGrid,
      minimum: 1,
    })
    playMentionedVideos(tree)
  }
}
