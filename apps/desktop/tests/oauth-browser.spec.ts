import { describe, expect, it, vi } from 'vitest'
import { startBrowserSignIn } from '../src/oauth-browser.ts'

vi.mock('electron', () => ({}))

const labels = {
  continuing: 'Continuing to sign in…',
  signedIn: 'You are signed in to Aeven. You can close this tab and return to the app.',
  failed: 'Sign-in did not finish. Return to Aeven and try again.',
}

describe('browser sign-in pages', () => {
  it('serves a white Aeven page, preloads the client font, and keeps the redirect on that page', async () => {
    let opened = ''
    await startBrowserSignIn({
      providerUrl: 'https://accounts.google.com/o/oauth2/auth?client=1',
      labels,
      openExternal: (url) => {
        opened = url
        return Promise.resolve()
      },
      land: () => undefined,
    })

    try {
      const start = await fetch(opened)
      const html = await start.text()
      expect(start.status).toBe(200)
      expect(html).toContain('background:#fff')
      expect(html).not.toContain('#f2f2f2')
      expect(html).toContain('loader-spin')
      expect(html).toContain('width:50px;height:50px')
      // The mark and the 18px loading mark are the ones the application's start
      // screen draws, so the round trip opens on the product's own face.
      expect(html).toContain('m225.301 0 305.5 529.142')
      expect(html).toContain('width:18px;height:18px')
      expect(html).toContain('Continuing to sign in')
      expect(html).not.toContain('class="word')
      expect(html).toContain('https://accounts.google.com/o/oauth2/auth?client=1')

      const fontUrl = new URL('/fonts/google-sans-flex-latin-wght-normal.woff2', opened)
      const font = await fetch(fontUrl)
      expect(font.status).toBe(200)
      expect(font.headers.get('content-type')).toContain('font/woff2')
      const bytes = Buffer.from(await font.arrayBuffer())
      expect(bytes.subarray(0, 4).toString('ascii')).toBe('wOF2')

      const done = await fetch(new URL('/oauth-result/sess-1/chal-1', opened))
      const doneHtml = await done.text()
      expect(done.status).toBe(200)
      expect(doneHtml).toContain('You are signed in to Aeven')
      expect(doneHtml).toContain('font-size:80px')
      expect(doneHtml).toContain('background:#fff')
      expect(doneHtml).toContain('rel="preload"')
      expect(doneHtml).toContain('font-display:block')
      expect(doneHtml).not.toContain('loader-spin')
      expect(doneHtml).not.toContain('http-equiv="refresh"')
    } finally {
      await fetch(new URL('/oauth-result/error', opened)).catch(() => undefined)
    }
  })
})
