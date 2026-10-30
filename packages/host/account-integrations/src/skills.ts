/** Parse uploaded skill bundles before storing or publishing their resources. */

import { load, JSON_SCHEMA } from 'js-yaml'
import { unzipSync } from 'fflate'
import { isSkillName } from '@aeven/skill'
import type { SkillUploadFile } from './types.ts'

/** Skill frontmatter block and the body below it. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/

/**
 * Read a skill's declared name and description without validating the rest of the bundle.
 * @param markdown - SKILL.md contents.
 * @returns the frontmatter name and description, or undefined when either is missing or malformed.
 */
export function skillHeader(markdown: string): { name: string; description: string } | undefined {
  const [, frontmatter] = FRONTMATTER.exec(markdown) ?? []
  if (frontmatter === undefined) return undefined
  const metadata: unknown = load(frontmatter, { schema: JSON_SCHEMA })
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return undefined
  const fields = metadata as Record<string, unknown>
  const { name, description } = fields
  return typeof name === 'string' && typeof description === 'string' && description.trim() !== ''
    ? { name, description }
    : undefined
}

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
  const [definition, ...otherDefinitions] = [...files.keys()].filter(path => path === 'SKILL.md' || path.endsWith('/SKILL.md'))
  if (definition === undefined || otherDefinitions.length > 0) {
    throw new Error('import one skill bundle containing exactly one SKILL.md')
  }
  const prefix = definition.slice(0, -'SKILL.md'.length)
  const resources = new Map<string, Uint8Array>()
  for (const [path, data] of files) {
    if (!path.startsWith(prefix)) throw new Error('all skill resources must be beside SKILL.md')
    resources.set(path.slice(prefix.length), data)
  }
  const markdown = new TextDecoder('utf-8', { fatal: true }).decode(files.get(definition))
  const match = FRONTMATTER.exec(markdown)
  const [, frontmatter, content] = match ?? []
  if (frontmatter === undefined || content === undefined) throw new Error('SKILL.md requires YAML frontmatter')
  const metadata: unknown = load(frontmatter, { schema: JSON_SCHEMA })
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) throw new Error('skill frontmatter must be an object')
  const fields = metadata as Record<string, unknown>
  if (typeof fields['name'] !== 'string' || !isSkillName(fields['name'])) throw new Error('skill name must be a lowercase hyphenated identifier')
  if (typeof fields['description'] !== 'string' || fields['description'].trim() === '') throw new Error('skill description is required')
  for (const key of ['disable-model-invocation', 'user-invocable']) {
    if (fields[key] !== undefined && typeof fields[key] !== 'boolean') throw new Error(`${key} must be a boolean`)
  }
  return {
    name: fields['name'], description: fields['description'], content, files: resources,
    modelInvocable: fields['disable-model-invocation'] !== true,
    userInvocable: fields['user-invocable'] !== false,
  }
}
