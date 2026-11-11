import { visit } from 'unist-util-visit'

import type { Root as HastRoot } from 'hast'

import type { ResolvedLinkSafety } from '../sanitize.ts'

/**
 * Keep links and images pointing somewhere the host is willing to send people.
 *
 * Sanitization already removes scripting attributes; this is the separate
 * question of *where* a URL may point. Nothing silently vanishes from what the
 * reader was sent: a disallowed link keeps its text and loses its destination,
 * and a disallowed image keeps its alt text but loses `src`, carrying the
 * refused source as `data-blocked-src` so the image component can name it in
 * its unavailable state. Every component map this renderer builds draws `img`
 * through that component, so no bare `<img>` without `src` reaches the page.
 *
 * @param config - The resolved rules that decide what is allowed through: the
 *   permitted protocols, link prefixes, image prefixes, whether a
 *   `data:image/` URL may stand in for an image source, and whether a
 *   scheme-less, rootless image source is the host's to resolve.
 * @returns The rehype transform that removes a disallowed destination, and
 *   moves a rejected image's source to `data-blocked-src`.
 */
export function rehypeLinkSafety(
  config: ResolvedLinkSafety,
): (tree: HastRoot) => void {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node) => {
      if (node.tagName === 'a') {
        const href = node.properties?.['href']

        if (typeof href === 'string' && !allowed(href, false)) {
          delete node.properties['href']
        }
      }

      if (node.tagName === 'img') {
        const src = node.properties?.['src']
        // A non-string src means sanitization already removed a disallowed
        // scheme upstream of this stage, which is the same verdict.
        const rejected = typeof src === 'string' ? !allowed(src, true) : true

        if (rejected) {
          delete node.properties['src']
          if (typeof src === 'string') node.properties['dataBlockedSrc'] = src
        }
      }
    })
  }

  function allowed(url: string, isImage: boolean): boolean {
    const trimmed = url.trim()

    if (isImage && config.allowDataImages && /^data:image\//i.test(trimmed)) {
      return true
    }

    // A scheme-less URL is relative, so it inherits the page's own origin.
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)

    if (scheme) {
      const protocol = scheme[1]!.toLowerCase()

      if (!config.allowedProtocols.includes(protocol)) {
        return false
      }
    }

    // A scheme-less, rootless source is a workspace path in the author's head;
    // only a host that resolves those itself may keep one. Protocol-relative
    // sources name another host and stay out.
    if (isImage && config.allowRelativeImages && scheme === null && !trimmed.startsWith('//')) {
      return true
    }

    const prefixes = isImage
      ? config.allowedImagePrefixes
      : config.allowedLinkPrefixes

    if (prefixes.includes('*')) {
      return true
    }

    return prefixes.some(prefix => trimmed.startsWith(prefix))
  }
}
