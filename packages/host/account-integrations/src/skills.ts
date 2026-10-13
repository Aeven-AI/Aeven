/** Parse uploaded skill bundles before storing or publishing their resources. */

import { load, JSON_SCHEMA } from 'js-yaml'
import { unzipSync } from 'fflate'
import { isSkillName } from '@aeven/skill'
import type { SkillUploadFile } from './types.ts'

/** Validated skill content and decoded, relative resource files. */
export interface ParsedPersonalSkill {
  name: string
  description: string
  content: string
  modelInvocable: boolean
  userInvocable: boolean
  files: Map<string, Uint8Array>
}

/**
 * Parse a SKILL.md upload or ZIP bundle without accepting absolute or escaping paths.
 * @param uploads - files uploaded by the account.
 * @param maxBytes - deployment limit for decoded bundle bytes.
 * @returns validated instructions and resources.
 */
export function parsePersonalSkill(uploads: readonly SkillUploadFile[], maxBytes: number): ParsedPersonalSkill {
  const files = new Map<string, Uint8Array>()
  let bytes = 0
  const add = (path: string, data: Uint8Array): void => {
    if (path.endsWith('/')) return
    if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '..' || part === '.' || part === '')
      || /^[A-Za-z]:/.test(path)) throw new Error('skill bundle contains an unsafe file path')
    bytes += data.byteLength
    if (bytes > maxBytes) throw new Error('skill bundle exceeds the configured size limit')
    if (files.has(path)) throw new Error('skill bundle contains duplicate file paths')
    files.set(path, data)
  }
  for (const upload of uploads) {
    const data = Buffer.from(upload.base64, 'base64')
    if (data.byteLength > maxBytes || data.toString('base64') !== upload.base64) throw new Error('invalid or oversized skill upload')
    if (/\.(?:zip|skill)$/i.test(upload.path)) {
      let expandedBytes = bytes
      const paths = new Set<string>()
      const archive = unzipSync(data, { filter: (file) => {
        if (paths.has(file.name)) throw new Error('skill archive contains duplicate file paths')
        paths.add(file.name)
        expandedBytes += file.originalSize
        if (expandedBytes > maxBytes) throw new Error('skill archive exceeds the configured size limit')
        return true
      } })
      for (const [path, value] of Object.entries(archive)) add(path, value)
    } else add(upload.path, data)
  }
  const definitions = [...files.keys()].filter(path => path === 'SKILL.md' || path.endsWith('/SKILL.md'))
  if (definitions.length !== 1) throw new Error('import one skill bundle containing exactly one SKILL.md')
  const definition = definitions[0]!
  const prefix = definition.slice(0, -'SKILL.md'.length)
  const resources = new Map<string, Uint8Array>()
  for (const [path, data] of files) {
    if (!path.startsWith(prefix)) throw new Error('all skill resources must be beside SKILL.md')
    resources.set(path.slice(prefix.length), data)
  }
  const markdown = new TextDecoder('utf-8', { fatal: true }).decode(files.get(definition))
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(markdown)
  if (match === null) throw new Error('SKILL.md requires YAML frontmatter')
  const metadata: unknown = load(match[1]!, { schema: JSON_SCHEMA })
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) throw new Error('skill frontmatter must be an object')
  const fields = metadata as Record<string, unknown>
  if (typeof fields['name'] !== 'string' || !isSkillName(fields['name'])) throw new Error('skill name must be a lowercase hyphenated identifier')
  if (typeof fields['description'] !== 'string' || fields['description'].trim() === '') throw new Error('skill description is required')
  for (const key of ['disable-model-invocation', 'user-invocable']) {
    if (fields[key] !== undefined && typeof fields[key] !== 'boolean') throw new Error(`${key} must be a boolean`)
  }
  return {
    name: fields['name'], description: fields['description'], content: match[2]!, files: resources,
    modelInvocable: fields['disable-model-invocation'] !== true,
    userInvocable: fields['user-invocable'] !== false,
  }
}
