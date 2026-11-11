// @vitest-environment jsdom
// Every local image an Assistant writes reaches the browser as a
// Session-scoped workspace URL: a hosted Host mounts no `/api/file`, so the
// authored path is the only thing that can name the file.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@aeven/client-test-runtime'
import { zh as commonZh } from '@aeven/client-locale/src/locales/zh.ts'
import { AssistantMarkdown } from '../src/client/chat/AssistantMarkdown.tsx'
import { zh } from '../src/client/locale.ts'
import { assistantImageUrl, decodeImageSource, workspaceImagePath } from '../src/client/chat/workspace-images.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)
const cwd = '/datadrive/apps/aeven-hosted/home/sandbox/accounts/a/workspaces/w'
const sessionId = 'session-1'

/** The query a resolved URL asks the workspace route for. */
function queryOf(url: string | undefined): { sessionId: string | null; path: string | null } {
  if (url === undefined) throw new Error('no URL')
  const parsed = new URL(url)
  expect(parsed.pathname.endsWith('/api/workspace-file')).toBe(true)
  return { sessionId: parsed.searchParams.get('sessionId'), path: parsed.searchParams.get('path') }
}

describe('workspace image sources', () => {
  it('keeps a workspace-relative path as written', () => {
    expect(workspaceImagePath(cwd, 'logo-out/aeven-mark.png')).toBe('logo-out/aeven-mark.png')
  })

  it('strips the workspace root from an absolute path inside it', () => {
    expect(workspaceImagePath(cwd, `${cwd}/logo-out/aeven-mark.png`)).toBe('logo-out/aeven-mark.png')
  })

  it('tolerates a workspace root written with a trailing slash', () => {
    expect(workspaceImagePath(`${cwd}/`, `${cwd}/shot.png`)).toBe('shot.png')
  })

  it('refuses an absolute path outside the workspace', () => {
    expect(workspaceImagePath(cwd, '/tmp/shot.png')).toBeUndefined()
    expect(workspaceImagePath(cwd, `${cwd.replace(/\/w$/, '')}/other-workspace/shot.png`)).toBeUndefined()
  })

  it('hands any local path to the workspace route when the projection knows no workspace root', () => {
    // The Host confines the path to the workspace and refuses one outside it.
    expect(workspaceImagePath(undefined, 'shot.png')).toBe('shot.png')
    expect(workspaceImagePath(undefined, '/tmp/shot.png')).toBe('/tmp/shot.png')
  })

  it('leaves remote, embedded and protocol-relative sources to their own resolver', () => {
    expect(workspaceImagePath(cwd, 'https://example.test/shot.png')).toBeUndefined()
    expect(workspaceImagePath(cwd, 'http://example.test/shot.png')).toBeUndefined()
    expect(workspaceImagePath(cwd, 'data:image/png;base64,AAAA')).toBeUndefined()
    expect(workspaceImagePath(cwd, '//example.test/shot.png')).toBeUndefined()
  })

  it('applies the percent-escapes Markdown writes for spaces', () => {
    expect(decodeImageSource('my%20shot.png')).toBe('my shot.png')
    expect(workspaceImagePath(cwd, 'my%20shot.png')).toBe('my shot.png')
  })

  it('keeps a source whose escapes are malformed literal', () => {
    expect(decodeImageSource('100%%.png')).toBe('100%%.png')
  })
})

describe('assistant image URLs', () => {
  it('asks the workspace route for the Session it renders', () => {
    expect(queryOf(assistantImageUrl('logo-out/aeven-mark.png', { sessionId, cwd })))
      .toEqual({ sessionId, path: 'logo-out/aeven-mark.png' })
  })

  it('prefers the copy an earlier read stored', () => {
    const stored = vi.fn((decoded: string) => decoded === 'shot.png' ? 'https://media.test/shot.webp' : undefined)
    expect(assistantImageUrl('shot.png', { sessionId, cwd, stored })).toBe('https://media.test/shot.webp')
  })

  it('leaves a remote source unresolved so its own URL loads', () => {
    expect(assistantImageUrl('https://example.test/shot.png', { sessionId, cwd })).toBeUndefined()
  })

  it('renders through the markdown engine as a workspace URL', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: '![the mark](logo-out/aeven-mark.png)' }]}
        streaming={false}
        renderMessageImages={() => null}
        imageUrl={source => assistantImageUrl(source, { sessionId, cwd })}
      />,
    )
    const image = view.container.querySelector('img')
    expect(image).not.toBeNull()
    const parsed = new URL(image?.getAttribute('src') ?? '')
    expect(parsed.pathname.endsWith('/api/workspace-file')).toBe(true)
    expect(parsed.searchParams.get('sessionId')).toBe(sessionId)
    expect(parsed.searchParams.get('path')).toBe('logo-out/aeven-mark.png')
  })
})
