import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Menu bar icons the class created, so a test can see the tray follow the choice. */
const trays: { destroyed: boolean; tooltip: string | undefined; items: string[] }[] = []

vi.mock('electron', () => ({
  app: { getAppPath: () => '/application', name: 'Aeven' },
  nativeImage: { createFromPath: (path: string) => ({ path }) },
  Menu: {
    buildFromTemplate: (items: { label?: string }[]) => ({ items }),
  },
  Tray: class {
    private readonly record = { destroyed: false, tooltip: undefined as string | undefined, items: [] as string[] }
    constructor(_image: unknown) { trays.push(this.record) }
    setToolTip(tooltip: string): void { this.record.tooltip = tooltip }
    setContextMenu(menu: { items: { label?: string }[] }): void {
      this.record.items = menu.items.map(item => item.label ?? '-')
    }
    on(): void {}
    destroy(): void { this.record.destroyed = true }
  },
}))

const { DesktopBackgroundMode } = await import('../src/background-mode.ts')
const { en } = await import('../src/locale.ts')

const actions = { open: () => undefined, quit: () => undefined }
const directories: string[] = []

async function recordFile(contents?: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'avn-background-mode-'))
  directories.push(directory)
  const file = join(directory, 'background-mode.json')
  if (contents !== undefined) await writeFile(file, contents)
  return file
}

afterEach(async () => {
  trays.length = 0
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('desktop background mode', () => {
  it('runs in the background before the user ever chooses', async () => {
    const mode = new DesktopBackgroundMode(await recordFile(), en, actions)
    expect(mode.enabled).toBe(true)
    expect(trays).toHaveLength(1)
    expect(trays[0]).toMatchObject({ tooltip: 'Aeven', items: ['Open Aeven', '-', 'Quit Aeven'] })
  })

  it('honors a stored choice of either value', async () => {
    expect(new DesktopBackgroundMode(await recordFile('{"enabled":false}\n'), en, actions).enabled).toBe(false)
    expect(new DesktopBackgroundMode(await recordFile('{"enabled":true}\n'), en, actions).enabled).toBe(true)
  })

  it('reads an unreadable record as off rather than as the default', async () => {
    expect(new DesktopBackgroundMode(await recordFile('not json'), en, actions).enabled).toBe(false)
  })

  it('stores the choice, then shows or removes the icon', async () => {
    const file = await recordFile()
    const mode = new DesktopBackgroundMode(file, en, actions)
    expect(trays).toHaveLength(1)

    await mode.setEnabled(false)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ enabled: false })
    expect(trays[0]?.destroyed).toBe(true)
    expect(new DesktopBackgroundMode(file, en, actions).enabled).toBe(false)

    await mode.setEnabled(true)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ enabled: true })
    expect(trays).toHaveLength(2)
    expect(trays[1]?.destroyed).toBe(false)
  })

  it('reports each stored choice to its listeners', async () => {
    const mode = new DesktopBackgroundMode(await recordFile(), en, actions)
    const seen: boolean[] = []
    mode.onChange(enabled => seen.push(enabled))
    await mode.setEnabled(false)
    await mode.setEnabled(true)
    expect(seen).toEqual([false, true])
  })
})
