// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DocumentTitle } from '../src/client/DocumentTitle.tsx'

afterEach(() => {
  cleanup()
  document.title = ''
  vi.unstubAllEnvs()
})

describe('DocumentTitle', () => {
  it('projects a durable title and restores the product title', () => {
    vi.stubEnv('AVN_CLIENT_TITLE', 'Aeven')
    document.title = 'stale title'
    const mounted = render(<DocumentTitle productTitle="Aeven" />)
    expect(document.title).toBe('Aeven')
    mounted.rerender(<DocumentTitle title="First title" productTitle="Aeven" />)
    expect(document.title).toBe('First title — Aeven')
    mounted.rerender(<DocumentTitle title="Revised title" productTitle="Aeven" />)
    expect(document.title).toBe('Revised title — Aeven')
    mounted.rerender(<DocumentTitle productTitle="Aeven" />)
    expect(document.title).toBe('Aeven')
    mounted.unmount()
    expect(document.title).toBe('Aeven')
  })

  it('uses the generic title when the build provides no title', () => {
    vi.stubEnv('AVN_CLIENT_TITLE', '')
    delete process.env.AVN_CLIENT_TITLE
    const mounted = render(<DocumentTitle title="First title" productTitle="AVN Local Build" />)
    expect(document.title).toBe('First title — AVN Local Build')
    mounted.unmount()
    expect(document.title).toBe('AVN Local Build')
  })
})
