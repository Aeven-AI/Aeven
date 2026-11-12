/**
 * Build the published snapshot of one assistant message from its Session log.
 *
 * The snapshot is the message alone, as Markdown; the prompt that led to it is never
 * published. Images travel beside the Markdown, which names image `n` as
 * `share-image:n`: an image content block of the message, and a Markdown image whose
 * source is a file inside the Session's working directory or a registered workspace. An
 * `https` or `data:` image stays as written; any other image source is dropped, because
 * a reader of the public page could not load it.
 * @module @aeven/host-message-share/snapshot
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ImageAttachmentRef, ImageMediaType } from '@aeven/attachment'
import type { ContentBlock } from '@aeven/llm'
import type { MessageId } from '@aeven/llm/brand'
import { deriveEventMessage, isAppendSurfaceEvent } from '@aeven/session/surface'
import type { SessionEvent } from '@aeven/session/types'

/** Media types a share image may have, by file extension. */
const IMAGE_TYPES: Readonly<Record<string, ShareImage['mediaType']>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** A Markdown image: alt text, then a source optionally in angle brackets and an optional title. */
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g

/** Longest title kept, in characters. */
const TITLE_MAX = 120

/** One image published with a share. */
export interface ShareImage {
  readonly mediaType: ImageMediaType
  readonly data: Uint8Array
}

/** What the Aeven API publishes for one message. */
export interface ShareSnapshot {
  readonly title: string
  readonly response: string
  readonly images: readonly ShareImage[]
}

/** The message a share publishes, as found in the log. */
export interface ShareTarget {
  /** Content of the shared assistant message. */
  readonly response: readonly ContentBlock[]
}

/** Readers the snapshot uses for image bytes. */
export interface SnapshotSources {
  /** Working directory of the Session, when it has one. */
  readonly cwd: string | undefined
  /** Canonical roots of the registered workspaces. */
  readonly workspaceRoots: readonly string[]
  /** Path prefix of the workspace-files route, such as `/workspace`, when it is mounted. */
  readonly workspaceMount: string | undefined
  /** Resolve a workspace id to its canonical root. */
  readonly workspaceRoot: (workspaceId: string) => string | undefined
  /** Read an image content block at share size, or undefined when no attachment store is mounted. */
  readonly readAttachment: (ref: ImageAttachmentRef) => Promise<ShareImage | undefined>
  /** Images one share carries at most. */
  readonly maxImages: number
  /** Largest image, in bytes. */
  readonly maxImageBytes: number
}

/**
 * Find the finalized assistant message.
 * @param events - the Session's complete log.
 * @param messageId - the assistant message to share.
 * @returns the message's content, or undefined when the message is not a finalized
 *   append-origin assistant message of this log.
 */
export function findShareTarget(events: readonly SessionEvent[], messageId: MessageId): ShareTarget | undefined {
  for (const event of events) {
    if (!isAppendSurfaceEvent(event) || event.type !== 'assistant/message') continue
    const message = deriveEventMessage(event)
    if (message === null || message.id !== messageId) continue
    return event.data.interrupted === true ? undefined : { response: message.content }
  }
  return undefined
}

/**
 * The share's title: the first line of the response.
 * @param response - response Markdown.
 * @returns a one-line title of at most {@link TITLE_MAX} characters.
 */
export function shareTitle(response: string): string {
  const line = response
    .replace(MARKDOWN_IMAGE, '')
    .split('\n')
    .map(text => text.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/, '').replace(/[*_`~]/g, '').trim())
    .find(text => text !== '') ?? ''
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
}

/**
 * Whether a path is a directory or inside it.
 * @param root - canonical directory.
 * @param path - canonical candidate.
 */
function within(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** Collects images in order, enforcing the count and size bounds. */
class ImageCollector {
  readonly images: ShareImage[] = []

  /** @param sources - readers and bounds. */
  constructor(private readonly sources: SnapshotSources) {}

  /**
   * Add one image when it fits the bounds.
   * @param image - candidate image.
   * @returns the `share-image:n` source naming it, or undefined when it was refused.
   */
  add(image: ShareImage): string | undefined {
    if (this.images.length >= this.sources.maxImages || image.data.byteLength > this.sources.maxImageBytes) return undefined
    this.images.push(image)
    return `share-image:${String(this.images.length - 1)}`
  }

  /**
   * Read a local image file the Session may publish.
   * @param path - absolute path as the Markdown names it.
   * @returns the image, or undefined when it is outside every allowed root, absent, too large, or not an image.
   */
  async readLocal(path: string): Promise<ShareImage | undefined> {
    const mediaType = IMAGE_TYPES[extname(path).toLowerCase()]
    if (mediaType === undefined) return undefined
    const canonical = await realpath(path).catch(() => undefined)
    if (canonical === undefined) return undefined
    const roots = await Promise.all([this.sources.cwd, ...this.sources.workspaceRoots]
      .filter((root): root is string => root !== undefined)
      .map(root => realpath(root).catch(() => undefined)))
    if (!roots.some(root => root !== undefined && within(root, canonical))) return undefined
    const info = await stat(canonical).catch(() => undefined)
    if (info === undefined || !info.isFile() || info.size > this.sources.maxImageBytes) return undefined
    const data = await readFile(canonical).catch(() => undefined)
    return data === undefined ? undefined : { mediaType, data }
  }

  /**
   * The local path a Markdown image source names, when it names one.
   * @param source - the image source.
   * @returns an absolute path, or undefined for a source that is not a local file.
   */
  localPath(source: string): string | undefined {
    if (source.startsWith('file://')) {
      try {
        return fileURLToPath(source)
      } catch {
        // A malformed file URL names no file; the image is dropped.
        return undefined
      }
    }
    const mount = this.sources.workspaceMount
    let pathname: string | undefined
    if (/^https?:\/\//i.test(source)) {
      try {
        pathname = decodeURIComponent(new URL(source).pathname)
      } catch {
        // An unparseable URL names no workspace file; the image is dropped.
        return undefined
      }
    } else if (source.startsWith('/') && mount !== undefined && source.startsWith(`${mount}/`)) {
      pathname = decodeURIComponent(source.split(/[?#]/)[0] ?? source)
    }
    if (pathname !== undefined) {
      if (mount === undefined || !pathname.startsWith(`${mount}/`)) return undefined
      const [workspaceId = '', ...segments] = pathname.slice(mount.length + 1).split('/')
      const root = this.sources.workspaceRoot(workspaceId)
      return root === undefined ? undefined : resolve(root, segments.join('/'))
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !/^[a-z]:[\\/]/i.test(source)) return undefined
    if (isAbsolute(source)) return source
    return this.sources.cwd === undefined ? undefined : resolve(this.sources.cwd, source)
  }
}

/**
 * Rewrite the Markdown images of one text so every kept image has a source a public page
 * can load.
 * @param markdown - text as the model wrote it.
 * @param images - the share's image collector.
 * @returns the rewritten Markdown.
 */
async function rewriteImages(markdown: string, images: ImageCollector): Promise<string> {
  const replacements: string[] = []
  for (const match of markdown.matchAll(MARKDOWN_IMAGE)) {
    const alt = match[1] ?? ''
    const source = match[2] ?? ''
    if (/^https:\/\//i.test(source) && images.localPath(source) === undefined) {
      replacements.push(match[0])
      continue
    }
    if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(source)) {
      replacements.push(match[0])
      continue
    }
    const path = images.localPath(source)
    const image = path === undefined ? undefined : await images.readLocal(path)
    const named = image === undefined ? undefined : images.add(image)
    replacements.push(named === undefined ? alt : `![${alt}](${named})`)
  }
  let index = 0
  return markdown.replace(MARKDOWN_IMAGE, () => replacements[index++] ?? '')
}

/**
 * Markdown of one message's content: its text blocks, then its image blocks.
 * @param content - the message content.
 * @param images - the share's image collector.
 * @param sources - readers for image blocks.
 * @returns the Markdown.
 */
async function contentMarkdown(content: readonly ContentBlock[], images: ImageCollector, sources: SnapshotSources): Promise<string> {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && block.text.trim() !== '') parts.push(await rewriteImages(block.text, images))
  }
  for (const block of content) {
    if (block.type !== 'image') continue
    const image = await sources.readAttachment(block.attachment).catch(() => undefined)
    const named = image === undefined ? undefined : images.add(image)
    if (named !== undefined) parts.push(`![${block.attachment.name ?? ''}](${named})`)
  }
  return parts.join('\n\n')
}

/**
 * Build the snapshot the Aeven API publishes.
 * @param target - the shared message.
 * @param sources - readers and bounds for images.
 * @returns the snapshot; the response is empty when the message has no text or images.
 */
export async function buildSnapshot(target: ShareTarget, sources: SnapshotSources): Promise<ShareSnapshot> {
  const images = new ImageCollector(sources)
  const response = await contentMarkdown(target.response, images, sources)
  return { title: shareTitle(response), response, images: images.images }
}
