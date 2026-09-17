// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

describe('Vitest jsdom compatibility', () => {
  it('provides isolated browser storage instead of Node process storage', () => {
    if (process.allowedNodeEnvironmentFlags.has('--webstorage')) {
      expect(process.execArgv.filter(argument => argument === '--no-webstorage')).toHaveLength(1)
    }
    localStorage.setItem('avn-vitest-storage-probe', 'available')

    expect(localStorage.getItem('avn-vitest-storage-probe')).toBe('available')
    localStorage.removeItem('avn-vitest-storage-probe')
  })
})
