/**
 * File layout of learned capabilities: one directory per capability under the owner's directory,
 * holding an agentskills-compatible `SKILL.md`, supporting files, and `capability.json` metadata.
 */
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import type { Capability, CapabilityEvidenceEntry, CapabilityRecord, CapabilityVersion } from './types.ts'

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_NAME_LENGTH = 64

/** Supporting-file folders, as in the agentskills layout. */
export const FILE_FOLDERS = ['references', 'scripts', 'templates', 'assets', 'examples'] as const

/**
 * Validate a capability name.
 * @param name - proposed name.
 * @returns the name.
 * @throws when the name is not kebab-case or too long.
 */
export function capabilityName(name: string): string {
  if (!NAME.test(name) || name.length > MAX_NAME_LENGTH) {
    throw new Error(`capability name must be kebab-case (a-z, 0-9, -) and at most ${MAX_NAME_LENGTH} characters: ${name}`)
  }
  return name
}

/**
 * Validate a supporting-file path: relative, inside one of the supporting-file folders.
 * @param path - proposed path relative to the capability directory.
 * @returns the normalized path.
 * @throws when the path escapes the capability or sits outside the supporting-file folders.
 */
export function supportingPath(path: string): string {
  const normalized = normalize(path).split(sep).join('/')
  const [folder, ...rest] = normalized.split('/')
  if (normalized.startsWith('/') || normalized.split('/').includes('..') || rest.length === 0
    || !(FILE_FOLDERS as readonly string[]).includes(folder ?? '')) {
    throw new Error(`supporting files must be relative paths inside ${FILE_FOLDERS.join('/, ')}/: ${path}`)
  }
  return normalized
}

/** Files of one owner's capabilities. */
export class CapabilityStore {
  constructor(private readonly root: string) {}

  /**
   * Directory of one capability.
   * @param owner - account id.
   * @param name - capability name.
   * @returns absolute directory path.
   */
  directory(owner: string, name: string): string {
    return join(this.root, encodeURIComponent(owner), capabilityName(name))
  }

  /**
   * Read every capability record of an owner.
   * @param owner - account id.
   * @returns records sorted by name.
   */
  async list(owner: string): Promise<CapabilityRecord[]> {
    let names: string[]
    try {
      names = await readdir(join(this.root, encodeURIComponent(owner)))
    } catch (error) {
      // An owner without a directory has no capabilities yet.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const records = await Promise.all(names.filter(name => NAME.test(name)).map(name => this.record(owner, name)))
    return records.filter((record): record is CapabilityRecord => record !== undefined).sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Read one capability record.
   * @param owner - account id.
   * @param name - capability name.
   * @returns the record, or undefined when it does not exist.
   */
  async record(owner: string, name: string): Promise<CapabilityRecord | undefined> {
    try {
      return JSON.parse(await readFile(join(this.directory(owner, name), 'capability.json'), 'utf8')) as CapabilityRecord
    } catch (error) {
      // A missing record means the capability does not exist.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  /**
   * Read one capability with its body.
   * @param owner - account id.
   * @param name - capability name.
   * @returns the capability, or undefined when it does not exist.
   */
  async get(owner: string, name: string): Promise<Capability | undefined> {
    const record = await this.record(owner, name)
    if (record === undefined) return undefined
    const directory = this.directory(owner, name)
    const markdown = await readFile(join(directory, 'SKILL.md'), 'utf8')
    return { ...record, content: skillBody(markdown), directory }
  }

  /**
   * Write a capability's body and record.
   * @param owner - account id.
   * @param capability - record and body to store.
   */
  async write(owner: string, capability: CapabilityRecord & { readonly content: string }): Promise<void> {
    const directory = this.directory(owner, capability.name)
    await mkdir(directory, { recursive: true })
    const { content, ...record } = capability
    const markdown = skillMarkdown(capability.name, capability.description, content)
    await atomicWrite(join(directory, 'SKILL.md'), markdown)
    // Each revision keeps its procedure, so executions stay attributable to the text they followed.
    await mkdir(join(directory, 'versions'), { recursive: true })
    await atomicWrite(join(directory, 'versions', `${capability.revision}.md`), markdown)
    await atomicWrite(join(directory, 'capability.json'), `${JSON.stringify(record, null, 2)}\n`)
  }

  /**
   * Append one execution or amendment to a capability's execution log.
   * @param owner - account id.
   * @param name - capability name.
   * @param entry - evidence to append.
   */
  async appendEvidence(owner: string, name: string, entry: CapabilityEvidenceEntry): Promise<void> {
    await appendFile(join(this.directory(owner, name), 'executions.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8')
  }

  /**
   * Read the body and description kept for one revision.
   *
   * Every write keeps its revision's `SKILL.md` under `versions/`, so a revision the user wants back is on disk
   * even though `capability.json` describes only the current one. The kept file is what a restore reads, because
   * the description it carried may have changed since.
   * @param owner - account id.
   * @param name - capability name.
   * @param revision - revision number to read.
   * @returns the kept revision, or undefined when no body was kept for that number.
   */
  async version(owner: string, name: string, revision: number): Promise<CapabilityVersion | undefined> {
    const file = join(this.directory(owner, name), 'versions', `${revision}.md`)
    let markdown: string
    try {
      markdown = await readFile(file, 'utf8')
    } catch (error: unknown) {
      // A revision whose body was never kept is indistinguishable to a caller from one that never existed, and
      // the only other failure this read reports is a permission or handle error on that same path.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    const match = /^---\nname: [^\n]*\ndescription: (.*)\n/u.exec(markdown)
    const description = match?.[1]
    return {
      revision,
      ...description === undefined ? {} : { description: JSON.parse(description) as string },
      content: skillBody(markdown),
    }
  }

  /**
   * List the revisions whose body is still kept, oldest first.
   * @param owner - account id.
   * @param name - capability name.
   * @returns one entry per kept revision, or none before the first write.
   */
  async versions(owner: string, name: string): Promise<CapabilityVersion[]> {
    const directory = join(this.directory(owner, name), 'versions')
    let names: string[]
    try {
      names = await readdir(directory)
    } catch (error: unknown) {
      // No directory means nothing was written yet, so a caller asking for the versions of a fresh capability
      // gets none; the only other failure this read reports is a permission or handle error on that path.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const revisions = names
      .flatMap((file) => {
        const match = /^([0-9]+)\.md$/u.exec(file)
        return match === null ? [] : [Number(match[1])]
      })
      .sort((left, right) => left - right)
    const versions: CapabilityVersion[] = []
    for (const revision of revisions) {
      const kept = await this.version(owner, name, revision)
      if (kept !== undefined) versions.push(kept)
    }
    return versions
  }

  /**
   * Read a capability's execution log.
   * @param owner - account id.
   * @param name - capability name.
   * @returns entries in append order; an unreadable line is skipped.
   */
  async evidence(owner: string, name: string): Promise<CapabilityEvidenceEntry[]> {
    let text: string
    try {
      text = await readFile(join(this.directory(owner, name), 'executions.jsonl'), 'utf8')
    } catch (error) {
      // A capability that never ran has no log.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return text.split('\n').flatMap((line) => {
      if (!line.trim()) return []
      try {
        return [JSON.parse(line) as CapabilityEvidenceEntry]
      } catch {
        // A line cut short by a crash during append carries no usable evidence.
        return []
      }
    })
  }

  /**
   * Write one supporting file.
   * @param owner - account id.
   * @param name - capability name.
   * @param path - validated supporting-file path.
   * @param content - file content.
   */
  async writeFile(owner: string, name: string, path: string, content: string): Promise<void> {
    const target = join(this.directory(owner, name), supportingPath(path))
    await mkdir(dirname(target), { recursive: true })
    await atomicWrite(target, content)
  }

  /**
   * Delete a capability directory.
   * @param owner - account id.
   * @param name - capability name.
   */
  async remove(owner: string, name: string): Promise<void> {
    await rm(this.directory(owner, name), { recursive: true, force: true })
  }

  /**
   * Read every file of one capability, keyed by its path relative to the capability's directory. The execution
   * log is this device's record of the runs it saw, so it is not part of what the capability holds.
   * @param owner - account id.
   * @param name - capability name.
   * @returns file contents by path.
   */
  async files(owner: string, name: string): Promise<Record<string, string>> {
    const root = this.directory(owner, name)
    const found: Record<string, string> = {}
    const walk = async (relative: string): Promise<void> => {
      for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
        const path = relative === '' ? entry.name : `${relative}/${entry.name}`
        if (entry.isDirectory()) {
          await walk(path)
          continue
        }
        if (path === 'executions.jsonl') continue
        found[path] = await readFile(join(root, path), 'utf8')
      }
    }
    await walk('')
    return found
  }

  /**
   * Replace one capability's files with another device's copy, leaving nothing the copy does not hold except
   * this device's execution log.
   * @param owner - account id.
   * @param name - capability name.
   * @param files - file contents by path relative to the capability's directory.
   */
  async replaceFiles(owner: string, name: string, files: Readonly<Record<string, string>>): Promise<void> {
    const root = this.directory(owner, name)
    const held = await this.files(owner, name).catch(() => ({}))
    for (const path of Object.keys(held)) {
      if (!Object.hasOwn(files, path)) await rm(join(root, relativePath(path)), { force: true })
    }
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, relativePath(path))
      await mkdir(dirname(target), { recursive: true })
      await atomicWrite(target, content)
    }
  }
}

/** A path relative to a capability's directory, refused when it leaves that directory. */
function relativePath(path: string): string {
  const normalized = normalize(path).split(sep).join('/')
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`capability files must stay inside the capability: ${path}`)
  }
  return normalized
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, path)
}

/** agentskills `SKILL.md`: YAML frontmatter with name and description, then the procedure. */
function skillMarkdown(name: string, description: string, content: string): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${content.trim()}\n`
}

function skillBody(markdown: string): string {
  if (!markdown.startsWith('---\n')) return markdown.trim()
  const end = markdown.indexOf('\n---\n', 4)
  return end === -1 ? markdown.trim() : markdown.slice(end + 5).trim()
}
