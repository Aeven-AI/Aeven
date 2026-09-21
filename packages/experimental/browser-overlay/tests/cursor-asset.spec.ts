import { describe, expect, it } from 'vitest'
import { CURSOR_ASSET_URL } from '../src/cursor-asset.ts'
import { CURSOR_SPRITE } from '../src/styles.ts'

/** The embedded sprite's bytes, decoded from its data URI. */
function spriteBytes(): Buffer {
  const comma = CURSOR_ASSET_URL.indexOf(',')
  return Buffer.from(CURSOR_ASSET_URL.slice(comma + 1), 'base64')
}

describe('cursor sprite asset', () => {
  it('is embedded as a base64 PNG data URI', () => {
    // A data URI rather than a URL: the overlay is injected into a page it does
    // not own, so a relative path would resolve against that page's origin and a
    // separate file would need a fetch its CSP could block.
    expect(CURSOR_ASSET_URL.startsWith('data:image/png;base64,')).toBe(true)
    expect(spriteBytes().subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })

  it('carries the sprite at the size the stylesheet renders it from', () => {
    // 46x48 source downsampled to 23x24 CSS pixels, so a Retina display shows a
    // clean 2x downsample rather than a resample.
    const bytes = spriteBytes()
    expect(bytes.readUInt32BE(16)).toBe(CURSOR_SPRITE.width * 2)
    expect(bytes.readUInt32BE(20)).toBe(CURSOR_SPRITE.height * 2)
  })
})
