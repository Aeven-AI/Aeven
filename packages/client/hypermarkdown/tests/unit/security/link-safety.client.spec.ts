import { describe, expect, it } from 'vitest'

import type {
  Element as HastElement,
  ElementContent,
  Properties,
  Root as HastRoot,
  RootContent,
  Text as HastText,
} from 'hast'

import { rehypeLinkSafety } from '../../../src/engine/rehype/link-safety.ts'
import type { ResolvedLinkSafety } from '../../../src/engine/sanitize.ts'

function element(
  tagName: string,
  properties: Properties = {},
  children: ElementContent[] = [],
): HastElement {
  return { type: 'element', tagName, properties, children }
}

function root(children: RootContent[]): HastRoot {
  return { type: 'root', children }
}

function applyPolicy(
  tree: HastRoot | HastElement,
  overrides: Partial<ResolvedLinkSafety> = {},
): HastRoot | HastElement {
  const policy: ResolvedLinkSafety = {
    allowedProtocols: ['http', 'https', 'mailto', 'tel'],
    allowedLinkPrefixes: ['*'],
    allowedImagePrefixes: ['*'],
    allowDataImages: true,
    allowRelativeImages: false,
    ...overrides,
  }

  // The transform visits elements and their children, so a bare element stands
  // in for a whole document.
  rehypeLinkSafety(policy)(tree as HastRoot)
  return tree
}

/** Assert what a refused image leaves: an `img` without `src` that names the refused source. */
function expectBlocked(node: RootContent | HastElement | undefined, source: string | undefined, alt?: string): void {
  expect(node).toMatchObject({ type: 'element', tagName: 'img' })
  const image = node as HastElement
  expect(image.properties).not.toHaveProperty('src')
  if (source === undefined) expect(image.properties).not.toHaveProperty('dataBlockedSrc')
  else expect(image.properties['dataBlockedSrc']).toBe(source)
  if (alt !== undefined) expect(image.properties['alt']).toBe(alt)
}

describe('rehypeLinkSafety', () => {
  it('keeps allowed absolute and relative destinations', () => {
    const relative = element('a', { href: '/guide' })
    const absolute = element('a', { href: 'https://example.com' })
    const tree = root([relative, absolute])

    applyPolicy(tree)

    expect(relative.properties.href).toBe('/guide')
    expect(absolute.properties.href).toBe('https://example.com')
  })

  it('removes unsafe schemes without removing link content', () => {
    const text: HastText = { type: 'text', value: 'keep me' }
    const link = element('a', { href: ' javascript:alert(1)' }, [text])

    applyPolicy(root([link]))

    expect(link.properties).not.toHaveProperty('href')
    expect(link.children).toEqual([text])
  })

  it('enforces separate link and image prefix allowlists', () => {
    const link = element('a', { href: 'https://docs.example/page' })
    const image = element('img', { src: 'https://cdn.example/image.png', alt: 'chart' })
    const tree = root([link, image])

    applyPolicy(tree, {
      allowedLinkPrefixes: ['https://docs.example/'],
      allowedImagePrefixes: ['https://images.example/'],
    })

    expect(link.properties.href).toBe('https://docs.example/page')
    // A disallowed image loses its src and keeps the refused source, which
    // the image component names in its unavailable state.
    expectBlocked(tree.children[1], 'https://cdn.example/image.png', 'chart')
  })

  it('keeps the refused source of a disallowed image that had no alt', () => {
    const tree = root([element('img', { src: 'https://cdn.example/x.png' })])

    applyPolicy(tree, { allowedImagePrefixes: ['https://images.example/'] })

    expectBlocked(tree.children[0], 'https://cdn.example/x.png')
  })

  it('keeps a workspace-relative image source only when the host resolves it', () => {
    const source = 'logo-out/aeven-mark.png'

    const disabled = root([element('img', { src: source, alt: 'the mark' })])
    applyPolicy(disabled, { allowedImagePrefixes: ['https://', '/'] })
    expectBlocked(disabled.children[0], source, 'the mark')

    const enabled = root([element('img', { src: source })])
    applyPolicy(enabled, { allowedImagePrefixes: ['https://', '/'], allowRelativeImages: true })
    expect((enabled.children[0] as HastElement).properties.src).toBe(source)
  })

  it('does not let the relative allowance cover a protocol-relative source', () => {
    // `//cdn.example/x.png` names another host, so it stays subject to the
    // prefix list rather than borrowing the scheme-less allowance.
    const tree = root([element('img', { src: '//cdn.example/x.png', alt: 'x' })])

    applyPolicy(tree, { allowedImagePrefixes: ['https://'], allowRelativeImages: true })

    expectBlocked(tree.children[0], '//cdn.example/x.png', 'x')
  })

  it('allows only image data URLs when explicitly enabled', () => {
    const image = element('img', { src: 'DATA:image/png;base64,AAAA' })
    const link = element('a', { href: 'data:text/html,unsafe' })

    applyPolicy(root([image, link]), {
      allowedProtocols: ['https'],
      allowedLinkPrefixes: ['*'],
      allowedImagePrefixes: [],
    })

    expect(image.properties.src).toContain('DATA:image/png')
    expect(link.properties).not.toHaveProperty('href')
  })

  it('rejects data images when disabled', () => {
    const image = element('img', { src: 'data:image/svg+xml;base64,AAAA', alt: 'logo' })
    const tree = root([image])

    applyPolicy(tree, {
      allowDataImages: false,
      allowedProtocols: ['https'],
    })

    expectBlocked(tree.children[0], 'data:image/svg+xml;base64,AAAA', 'logo')
  })

  it('treats an image whose src sanitization already stripped as rejected', () => {
    // hast-util-sanitize runs first and removes a disallowed scheme outright,
    // so this stage sees an <img> with no src at all — the same verdict, with
    // no source left to name.
    const tree = root([element('img', { alt: 'diagram' })])

    applyPolicy(tree)

    expectBlocked(tree.children[0], undefined, 'diagram')
  })

  it('removes the source from a rejected root-level image', () => {
    const image = element('img', {
      src: 'javascript:alert(1)',
      alt: 'diagram',
    })

    applyPolicy(image)

    expectBlocked(image, 'javascript:alert(1)', 'diagram')
  })

  it('ignores unrelated elements and non-string URL properties', () => {
    const paragraph = element('p', { href: 'javascript:ignored' })
    // `href` is typed as a string, but a property reaching this transform from
    // another producer need not be one; a non-string destination is left alone.
    const foreignHref = ['not', 'a', 'string'] as unknown as Properties['href']
    const link = element('a', { href: foreignHref })

    applyPolicy(root([paragraph, link]))

    expect(paragraph.properties.href).toBe('javascript:ignored')
    expect(link.properties.href).toEqual(['not', 'a', 'string'])
  })
})
