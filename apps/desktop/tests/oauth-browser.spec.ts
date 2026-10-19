import { describe, expect, it, vi } from 'vitest'
import { startBrowserSignIn } from '../src/oauth-browser.ts'

vi.mock('electron', () => ({}))

const labels = {
  continuing: 'Continuing to sign in…',
  signedIn: 'You are signed in to Aeven. You can close this tab and return to the app.',
  failed: 'Sign-in did not finish. Return to Aeven and try again.',
}

describe('browser sign-in pages', () => {
  it('serves the brand page waiting, then reporting, with the face inlined and the redirect on the first paint', async () => {
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
      expect(html).toContain('class="page-waiting fonts-loading"')
      // The cover is the product's first face: the mark, and the 18px loading mark under it.
      expect(html).toContain('m225.301 0 305.5 529.142')
      expect(html).toContain('cover__spinner')
      expect(html).toContain('Continuing to sign in')
      // The wordmark and the sheet are the coming-soon page's.
      expect(html).toContain('<h1>Æven</h1>')
      expect(html).toContain('--bg: #f2f2f2')
      expect(html).toContain('https://accounts.google.com/o/oauth2/auth?client=1')
      // Nothing is fetched: the face travels inside the document.
      expect(html).toContain('src: url("data:font/woff2;base64,')
      expect(html).not.toContain('/fonts/google-sans-flex')

      const done = await fetch(new URL('/oauth-result/sess-1/chal-1', opened))
      const doneHtml = await done.text()
      expect(done.status).toBe(200)
      expect(doneHtml).toContain('class="page-result fonts-loading"')
      expect(doneHtml).toContain('You are signed in to Aeven')
      expect(doneHtml).not.toContain('class="cover"')
      expect(doneHtml).not.toContain('http-equiv="refresh"')
    } finally {
      await fetch(new URL('/oauth-result/error', opened)).catch(() => undefined)
    }
  })
})
