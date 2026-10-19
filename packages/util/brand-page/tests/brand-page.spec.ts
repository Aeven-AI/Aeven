import { describe, expect, it } from 'vitest'
import { BRAND_PAGE_CSS, brandPageHtml, escapeHtml } from '../src/index.ts'

describe('the document a brand page renders', () => {
  it('reports a result under the wordmark, with no cover and nothing fetched', () => {
    const page = brandPageHtml({ note: 'Signed in.', hint: 'You can close this window.' })

    expect(page).toContain('<html lang="en" class="page-result fonts-loading">')
    expect(page).toContain('<h1>Æven</h1>')
    expect(page).toContain('<p class="note">Signed in.</p>')
    expect(page).toContain('<p class="hint">You can close this window.</p>')
    expect(page).not.toContain('class="cover"')
    expect(page).not.toContain('http-equiv="refresh"')
    // The face travels in the document, so a loopback port needs no asset route.
    expect(page).toContain('src: url("data:font/woff2;base64,')
    expect(page).not.toContain('__AEVEN_PAGE_FONT__')
    expect(page).toContain('<title>Æven</title>')
  })

  it('waits behind the cover, then leaves for the provider route', () => {
    const page = brandPageHtml({
      state: 'waiting',
      note: 'Continuing to sign in…',
      title: 'Signing in — Æven',
      redirect: 'https://accounts.example/authorize?a=1&b=2',
    })

    expect(page).toContain('class="page-waiting fonts-loading"')
    expect(page).toContain('class="cover"')
    expect(page).toContain('cover__spinner')
    expect(page).toContain('<title>Signing in — Æven</title>')
    expect(page).toContain('content="0; url=https://accounts.example/authorize?a=1&amp;b=2"')
    expect(page).toContain('location.replace("https://accounts.example/authorize?a=1&b=2")')
    expect(page).toContain('document.fonts.load')
  })

  it('omits both scripts and the font gate when the page runs no script', () => {
    const page = brandPageHtml({ note: 'Signed in.', scripted: false, redirect: 'https://example.test/' })

    expect(page).toContain('class="page-result"')
    expect(page).not.toContain('<script')
    expect(page).not.toContain('http-equiv="refresh"')
    // The lockup still carries the face and its entrance, so the page reads the same.
    expect(page).toContain('src: url("data:font/woff2;base64,')
    expect(page).toContain('.note')
  })

  it('states the document language it is given', () => {
    expect(brandPageHtml({ note: 'Signed in.', lang: 'zh-CN' })).toContain('<html lang="zh-CN"')
  })

  it('carries no hint line when the page has none', () => {
    expect(brandPageHtml({ note: 'Signed in.' })).not.toContain('class="hint"')
  })
})

describe('escaping', () => {
  it('keeps page text from becoming markup', () => {
    const page = brandPageHtml({ note: '<b>a & b</b>', hint: '"quoted"' })

    expect(page).toContain('&lt;b&gt;a &amp; b&lt;/b&gt;')
    expect(page).toContain('&quot;quoted&quot;')
  })

  it('escapes each significant character', () => {
    expect(escapeHtml('&<>"')).toBe('&amp;&lt;&gt;&quot;')
  })
})

describe('the stylesheet', () => {
  it('states the coming-soon design and leaves the face to the renderer', () => {
    expect(BRAND_PAGE_CSS).toContain('--bg: #f2f2f2')
    expect(BRAND_PAGE_CSS).toContain('font-size: clamp(3.25rem, 11vw, 10rem)')
    expect(BRAND_PAGE_CSS).toContain('feTurbulence')
    expect(BRAND_PAGE_CSS).toContain('src: url("__AEVEN_PAGE_FONT__")')
    expect(BRAND_PAGE_CSS).toContain('html.page-waiting.fonts-loading .cover')
  })
})
