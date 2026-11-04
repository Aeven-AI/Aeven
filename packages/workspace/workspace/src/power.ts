/**
 * Whether this computer runs on battery, which defers the large first downloads file sync would otherwise start.
 * @module @aeven/workspace/power
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/subprocess'

/** Linux's power supply directory. */
const POWER_SUPPLY = '/sys/class/power_supply'

/**
 * Whether this computer draws from its battery now.
 * @param ctx - context whose optional `subprocess` runs the platform's power query.
 * @returns true only when the platform reports battery power; false on AC, without a battery, or when it cannot tell.
 */
export async function onBatteryPower(ctx: Context): Promise<boolean> {
  const output = (argv: readonly string[]): Promise<string | undefined> => commandOutput(ctx, argv)
  if (process.platform === 'darwin') return (await output(['pmset', '-g', 'ps']))?.includes("'Battery Power'") === true
  if (process.platform === 'win32') {
    // BatteryStatus 1 is "discharging"; a desktop without a battery prints nothing.
    const status = await output(['powershell', '-NoProfile', '-Command', '(Get-CimInstance Win32_Battery).BatteryStatus'])
    return status?.trim().split(/\s+/u).includes('1') === true
  }
  let supplies: string[]
  try {
    supplies = await readdir(POWER_SUPPLY)
  } catch {
    // No power supply information: a server or container, which never runs on battery.
    return false
  }
  let battery = false
  for (const supply of supplies) {
    const type = (await readFile(join(POWER_SUPPLY, supply, 'type'), 'utf8').catch(() => '')).trim()
    if (type === 'Mains' && (await readFile(join(POWER_SUPPLY, supply, 'online'), 'utf8').catch(() => '0')).trim() === '1') return false
    if (type === 'Battery') battery = true
  }
  return battery
}

/**
 * Order workspaces most recently changed first, so the ones in use arrive before the rest.
 * @param workspaces - workspaces with ISO-8601 `updatedAt` instants.
 * @returns a new array in that order.
 */
export function byRecentUse<T extends { readonly updatedAt: string }>(workspaces: readonly T[]): T[] {
  return [...workspaces].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

/** A short command's standard output, or undefined when it cannot run, fails, or no subprocess capability is mounted. */
async function commandOutput(ctx: Context, argv: readonly string[]): Promise<string | undefined> {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) return undefined
  try {
    const child = subprocess.spawn({
      argv: [...argv],
      cwd: process.cwd(),
      graceMs: 1_000,
      signal: AbortSignal.timeout(10_000),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 16_384 }, stderr: { maxBytes: 16_384 } },
    })
    const outcome = await child.done
    return outcome.exitCode === 0 ? child.collected.stdout?.readFrom(0).text : undefined
  } catch {
    // The command is missing on this platform; the caller treats it as "cannot tell".
    return undefined
  }
}
