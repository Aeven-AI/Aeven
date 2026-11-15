/**
 * Pre-approved skill scripts: a sandbox escalation the deployment lets run without asking when the whole command is
 * one invocation of a script that a skill the deployment ships carries, such as the CV and slides exporters' Pages
 * and Keynote conversion, which macOS refuses to run inside the workspace sandbox.
 *
 * The command must be exactly `[cd <dir> && ] node <script> <arg> <arg> <final>`: every token plain or double-quoted
 * without `$`, backquotes, or backslashes, so nothing expands and nothing else runs. The script must resolve to the
 * configured file inside the resource directory of a skill whose source is `custom` or `bundled`, the skills the
 * deployment ships; a project or user skill of the same name, which a command could write, never qualifies.
 *
 * @module @aeven/tool-bash/skill-escalation
 */

import { realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { SkillDefinition } from '@aeven/skill'

/** One pre-approved skill script. */
export interface EscalationSkillScript {
  /** The skill's name. */
  skill: string
  /** The script, relative to the skill's resource directory. */
  script: string
  /** Values the command's final argument may take; the script's other arguments are free. */
  finalArgs: string[]
}

/** One token: a double-quoted string without `"`, `$`, backquote or backslash, or a plain word of safe characters. */
const TOKEN = String.raw`(?:"([^"$\`\\]*)"|([A-Za-z0-9_./@:+,=-]+))`
/** The whole command: an optional `cd <dir> &&`, then `node <script> <arg> <arg> <final>`. */
const COMMAND = new RegExp(String.raw`^(?:cd ${TOKEN} && )?node ${TOKEN} ${TOKEN} ${TOKEN} ${TOKEN}$`)

/** Skill sources the deployment ships. */
const SHIPPED_SOURCES: ReadonlySet<string> = new Set(['custom', 'bundled'])

/**
 * The tokens of a command in the pre-approved shape.
 * @param command - the bash command as the model sent it.
 * @returns the script, its two free arguments and the final argument, or undefined for any other command.
 */
export function parseSkillScriptCommand(command: string): { script: string; args: [string, string]; final: string } | undefined {
  const match = COMMAND.exec(command.trim())
  if (match === null) return undefined
  const token = (index: number): string => match[index] ?? match[index + 1] ?? ''
  return { script: token(3), args: [token(5), token(7)], final: token(9) }
}

/**
 * Whether a command is a pre-approved skill script invocation.
 * @param command - the bash command as the model sent it.
 * @param entries - the deployment's pre-approved scripts.
 * @param lookup - loads a skill as the calling agent sees it.
 * @returns true only when the command has the pre-approved shape, its final argument is allowed, and its script is
 * the configured file of a shipped skill.
 */
export async function isPreApprovedSkillScript(
  command: string,
  entries: readonly EscalationSkillScript[],
  lookup: (name: string) => Promise<SkillDefinition | undefined>,
): Promise<boolean> {
  if (entries.length === 0) return false
  const parsed = parseSkillScriptCommand(command)
  if (parsed === undefined || !isAbsolute(parsed.script)) return false
  const script = await realpath(parsed.script).catch(() => undefined)
  if (script === undefined) return false
  for (const entry of entries) {
    if (!entry.finalArgs.includes(parsed.final)) continue
    const skill = await lookup(entry.skill)
    if (skill === undefined || !SHIPPED_SOURCES.has(skill.source) || skill.resourceBase?.kind !== 'directory') continue
    const expected = await realpath(join(skill.resourceBase.path, entry.script)).catch(() => undefined)
    if (expected !== undefined && expected === script) return true
  }
  return false
}
