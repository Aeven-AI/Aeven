/**
 * Background mode: a menu bar (tray) icon that keeps the shell running after
 * its last window closes. The running shell keeps its Host lease, so agent
 * turns and automations continue until the user quits from the icon or the
 * application menu. On by default; the choice is stored per installation.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, Menu, nativeImage, Tray, type NativeImage } from 'electron'
import type { DesktopMessages } from './locale.ts'

/** Shell operations the menu bar icon invokes. */
export interface DesktopBackgroundActions {
  /** Show the primary window, creating it when none is open. */
  open(): void
  /** Quit the application through its ordinary quit confirmation. */
  quit(): void
}

function trayImage(): NativeImage {
  const resources = join(app.getAppPath(), 'resources')
  switch (process.platform) {
    // The `Template` suffix makes macOS tint the image for the menu bar and load its @2x sibling.
    case 'darwin':
      return nativeImage.createFromPath(join(resources, 'trayTemplate.png'))
    case 'win32':
      return nativeImage.createFromPath(join(resources, 'tray-windows.ico'))
    default:
      return nativeImage.createFromPath(join(resources, 'linux', 'icons', '24x24.png'))
  }
}

function readEnabled(file: string): boolean {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    // Absent until the user first changes the setting; background mode starts on.
    return true
  }
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && (value as Record<string, unknown>).enabled === true
  } catch {
    // A corrupt record reads as off and is replaced on the next change.
    return false
  }
}

/** The persisted background-mode choice and the menu bar icon it shows. */
export class DesktopBackgroundMode {
  private enabledValue: boolean
  private tray: Tray | undefined
  private readonly listeners = new Set<(enabled: boolean) => void>()

  /**
   * @param file - JSON record of the choice, in the shell's user-data directory.
   * @param messages - locale-owned menu copy.
   * @param actions - operations the icon's menu invokes.
   */
  constructor(
    private readonly file: string,
    private readonly messages: DesktopMessages,
    private readonly actions: DesktopBackgroundActions,
  ) {
    this.enabledValue = readEnabled(file)
    this.syncTray()
  }

  /** Whether closing the last window leaves the application running in the menu bar. */
  get enabled(): boolean {
    return this.enabledValue
  }

  /**
   * Persist the choice, then show or remove the menu bar icon.
   * @param enabled - whether background mode is on.
   * @returns resolution after the choice is durable.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    await writeFile(this.file, `${JSON.stringify({ enabled })}\n`)
    this.enabledValue = enabled
    this.syncTray()
    for (const listener of this.listeners) listener(enabled)
  }

  /**
   * Observe changes to the choice.
   * @param listener - called with each new value.
   * @returns disposer removing the listener.
   */
  onChange(listener: (enabled: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private syncTray(): void {
    if (!this.enabledValue) {
      this.tray?.destroy()
      this.tray = undefined
      return
    }
    if (this.tray !== undefined) return
    const tray = new Tray(trayImage())
    tray.setToolTip(app.name)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: this.messages.openApplication, click: () => { this.actions.open() } },
      { type: 'separator' },
      { label: this.messages.quitApplication, click: () => { this.actions.quit() } },
    ]))
    // Windows and Linux open the window on a click; macOS shows the menu.
    if (process.platform !== 'darwin') tray.on('click', () => { this.actions.open() })
    this.tray = tray
  }
}
