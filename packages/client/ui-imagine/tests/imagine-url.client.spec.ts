import { describe, expect, it } from 'vitest'
import { imagineIdOf, newImaginePath } from '../src/client/imagine-url.ts'

const ID = '4cc55fb3-2630-4249-b52b-87518203ad17'

describe('Imagine address', () => {
  it('reads a UUID id under /i and nothing else', () => {
    expect(imagineIdOf(`/i/${ID}`)).toBe(ID)
    expect(imagineIdOf(`/i/${ID.toUpperCase()}`)).toBe(ID)
    for (const path of ['/', '/i', '/i/', '/i/not-a-uuid', `/i/${ID}/x`, `/c/${ID}`]) {
      expect(imagineIdOf(path)).toBeUndefined()
    }
  })

  it('mints a fresh readable address per call', () => {
    const first = newImaginePath()
    const second = newImaginePath()
    expect(imagineIdOf(first)).toBeDefined()
    expect(first).not.toBe(second)
  })
})
