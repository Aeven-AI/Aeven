// The Microsoft Store manifest and the Windows installer name the registry keys the app writes. Each list is
// held to `windowsHostKeys()`, the keys `browser-extension.ts` registers and removes.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { windowsHostKeys } from '../src/browser-extension.ts'

const manifest = readFileSync(new URL('../installer/appx/AppxManifest.xml', import.meta.url), 'utf8')
const installer = readFileSync(new URL('../installer/installer.nsh', import.meta.url), 'utf8')

/** The keys the manifest excludes from registry write virtualization on Windows 11, in `reg` syntax. */
const excluded = [...manifest.matchAll(/<virtualization:ExcludedKey>([^<]+)<\/virtualization:ExcludedKey>/g)]
  .map(([, key]) => (key ?? '').replace(/^HKEY_CURRENT_USER\\/, 'HKCU\\'))

describe('Microsoft Store manifest', () => {
  it('excludes exactly the keys the app writes from registry virtualization', () => {
    expect(excluded.toSorted()).toEqual(windowsHostKeys().toSorted())
  })

  it('lets a Windows release without key exclusions install the package', () => {
    expect(manifest).toMatch(/IgnorableNamespaces="[^"]*\bvirtualization\b[^"]*"/)
    expect(manifest).toContain('<desktop6:RegistryWriteVirtualization>disabled</desktop6:RegistryWriteVirtualization>')
  })

  it('leaves file-system writes unvirtualized and excludes no directory by name', () => {
    expect(manifest).not.toContain('<virtualization:ExcludedDirector')
    expect(manifest).toContain('<desktop6:FileSystemWriteVirtualization>disabled</desktop6:FileSystemWriteVirtualization>')
  })
})

describe('Windows installer', () => {
  it('deletes each key the app writes when the app is uninstalled', () => {
    const deleted = [...installer.matchAll(/^\s*DeleteRegKey HKCU "([^"]+)"/gm)].map(([, key]) => `HKCU\\${key ?? ''}`)
    expect(deleted.toSorted()).toEqual(windowsHostKeys().toSorted())
  })
})
