import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'

const LINUX_ENVIRONMENT = {
  AVN_DESKTOP_APP_ID: 'com.example.desktop',
  AVN_DESKTOP_TARGET_PLATFORM: 'linux',
  AVN_DESKTOP_TARGET_ARCH: 'x64',
}

/** Icon-theme sizes the AppImage and deb launchers request from `resources/linux/icons`. */
const ICON_THEME_SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512]

function linuxConfig(): ReturnType<typeof createElectronBuilderConfig> {
  return createElectronBuilderConfig(LINUX_ENVIRONMENT, 'linux', 'x64')
}

describe('desktop Linux package configuration', () => {
  it('packages an AppImage and a deb named aeven', () => {
    expect(linuxConfig().linux).toMatchObject({
      executableName: 'aeven',
      target: ['AppImage', 'deb'],
    })
  })

  it('ships one icon per icon-theme size', () => {
    const { icon } = linuxConfig().linux
    expect(icon).toBe('resources/linux/icons')
    const missing = ICON_THEME_SIZES.filter(
      size => !existsSync(new URL(`../${icon}/${size}x${size}.png`, import.meta.url)),
    )
    expect(missing).toEqual([])
  })

  it('associates the installed desktop entry with the window Electron identifies itself as', () => {
    const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(linuxConfig().linux.syncDesktopName).toBe(true)
    expect(manifest).toHaveProperty('desktopName', 'aeven.desktop')
  })

  it('uses the static AppImage runtime instead of the system libfuse2', () => {
    expect(linuxConfig().toolsets).toEqual({ appimage: '1.0.3' })
  })

  it('requires the Electron runtime libraries and lets older releases resolve renamed ones', () => {
    expect(linuxConfig().deb.depends).toEqual(expect.arrayContaining([
      'libasound2t64 | libasound2',
      'libatspi2.0-0t64 | libatspi2.0-0',
      'libgtk-3-0t64 | libgtk-3-0',
      'libnotify4',
      'libnss3',
      'libsecret-1-0',
      'libuuid1',
      'xdg-utils',
    ]))
  })

  it('names a maintainer and the launcher copy for the deb', () => {
    const { linux } = linuxConfig()
    expect(linux.maintainer).toMatch(/<[^<>]+@[^<>]+>/u)
    expect(linux.synopsis).toBeTruthy()
    expect(linux.description).toBeTruthy()
  })
})
