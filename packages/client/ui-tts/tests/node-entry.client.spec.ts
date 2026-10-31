/**
 * The package's node half. The reader lives entirely in the browser, so the host plugin exists only as
 * an empty apply that lets the Loader see the plugin.
 */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('node half', () => {
  it('applies without host-side behavior', () => {
    expect(() => { apply() }).not.toThrow()
  })
})
