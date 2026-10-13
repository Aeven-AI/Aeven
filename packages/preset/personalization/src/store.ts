/**
 * One document per person holding how they want Aeven to talk with them, and the prompt block rendered from it.
 *
 * The block is read at every prompt assembly, which cannot await a file, so every operation is synchronous and a
 * read is cached against the document's size and modification time. A person's Settings edit and the next
 * request read the same file, so both see one state with no cache to invalidate.
 *
 * @module @aeven/personalization/store
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  Personalization, PersonalizationChange, PersonalizationUpdate, PersonalizationView, PersonalizationVoice,
} from './types.ts'

/** Format version of the stored document; a document this version cannot read yields the defaults. */
export const PERSONALIZATION_VERSION = 1

/** Every voice a person can choose. */
export const PERSONALIZATION_VOICES: readonly PersonalizationVoice[] = ['automatic', 'warm', 'direct', 'playful']

/** Preferences of a person who has set none: the persona reads the moment. */
export const DEFAULT_PERSONALIZATION: Personalization = { voice: 'automatic', notes: '' }

/** What each fixed voice asks of the model; `automatic` adds nothing to the persona. */
const VOICE_TEXT: Readonly<Record<Exclude<PersonalizationVoice, 'automatic'>, string>> = {
  warm: 'Really warm and friendly in every reply, technical work included: encouraging, kind and conversational, like a friend who is glad to help, while staying exact.',
  direct: 'Straight to the point in every reply, personal topics included: brief and plain, no small talk, and still kind.',
  playful: 'Light and playful: humour and casual language are welcome, while the substance stays accurate.',
}

/** What the model reads above the person's own preferences: whose they are and what outranks them. */
const GUIDANCE = 'How this person asked you to talk with them. It outranks the voice defaults above; '
  + 'something they ask for in the conversation outranks it.'

/**
 * Parse a stored document. A document this version cannot read, or one with malformed fields, yields the defaults
 * for those fields: a wrong preference would be asserted on every request, while a default costs nothing.
 * @param raw - the file's text.
 * @returns the stored preferences.
 */
export function parsePersonalization(raw: string): Personalization {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A partially written or hand-edited file is not a reason to assert a preference on every request.
    return DEFAULT_PERSONALIZATION
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PERSONALIZATION
  const { version, voice, notes } = parsed as Record<string, unknown>
  if (version !== PERSONALIZATION_VERSION) return DEFAULT_PERSONALIZATION
  return {
    voice: PERSONALIZATION_VOICES.includes(voice as PersonalizationVoice) ? voice as PersonalizationVoice : 'automatic',
    notes: typeof notes === 'string' ? notes : '',
  }
}

/**
 * Render the block for one person's preferences.
 * @param preferences - the stored preferences.
 * @returns the model-facing block, or the empty string when every preference is the default.
 */
export function renderPersonalization(preferences: Personalization): string {
  const lines: string[] = []
  if (preferences.voice !== 'automatic') lines.push(`Voice: ${VOICE_TEXT[preferences.voice]}`)
  if (preferences.notes !== '') lines.push(`In their own words: ${preferences.notes}`)
  return lines.length === 0 ? '' : `${GUIDANCE}\n<personalization>\n${lines.join('\n')}\n</personalization>`
}

/** Where one person's preferences are stored; the owner id is escaped because it names a file. */
export function personalizationPath(root: string, owner: string): string {
  return join(root, `${encodeURIComponent(owner)}.json`)
}

/** Reads, renders and changes per-person preferences, re-reading a document only when its file moved. */
export class PersonalizationStore {
  // Size and modification time are compared as bigints: at millisecond granularity two writes of the same length
  // within one tick are indistinguishable, and a session would then render the block it already read.
  private readonly cache = new Map<string, { size: bigint; mtime: bigint; preferences: Personalization; block: string }>()

  /**
   * @param root - absolute directory holding the per-person documents.
   * @param maxNotesChars - longest notes text a change may store.
   */
  constructor(private readonly root: string, private readonly maxNotesChars: number) {}

  /**
   * One person's preferences and the bounds a change must fit.
   * @param owner - the signed-in account id.
   * @returns the current view.
   */
  read(owner: string): PersonalizationView {
    return this.view(this.state(owner).preferences)
  }

  /**
   * The block rendered into the person's requests.
   * @param owner - the signed-in account id.
   * @returns the model-facing block, or the empty string when the person kept every default.
   */
  block(owner: string): string {
    return this.state(owner).block
  }

  /**
   * Change some of one person's preferences. The notes are trimmed, and notes over their bound are refused
   * whole rather than clipped.
   * @param owner - the signed-in account id.
   * @param update - the fields to change.
   * @returns what changed, with the reason when the change was refused.
   * @throws when the update names a voice this store does not offer.
   */
  update(owner: string, update: PersonalizationUpdate): PersonalizationChange {
    const current = this.state(owner).preferences
    if (update.voice !== undefined && !PERSONALIZATION_VOICES.includes(update.voice)) {
      throw new Error(`unknown personalization voice: ${String(update.voice)}`)
    }
    const next: Personalization = {
      voice: update.voice ?? current.voice,
      notes: update.notes === undefined ? current.notes : update.notes.trim(),
    }
    if (next.notes.length > this.maxNotesChars) {
      return { changed: false, reason: 'too-long', view: this.view(current) }
    }
    if (next.voice === current.voice && next.notes === current.notes) {
      return { changed: false, view: this.view(current) }
    }
    const path = personalizationPath(this.root, owner)
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp`
    writeFileSync(temporary, `${JSON.stringify({ version: PERSONALIZATION_VERSION, ...next }, null, 2)}\n`)
    // A rename replaces the document in one step, so a prompt assembly reading it concurrently sees either the
    // previous document or this one, never a half-written one.
    renameSync(temporary, path)
    const stat = statSync(path, { bigint: true })
    this.cache.set(owner, { size: stat.size, mtime: stat.mtimeNs, preferences: next, block: renderPersonalization(next) })
    return { changed: true, view: this.view(next) }
  }

  private view(preferences: Personalization): PersonalizationView {
    return { ...preferences, maxNotesChars: this.maxNotesChars }
  }

  /** The person's preferences and block, re-read only when the document on disk moved. */
  private state(owner: string): { preferences: Personalization; block: string } {
    const path = personalizationPath(this.root, owner)
    let size = 0n
    let mtime = 0n
    if (existsSync(path)) {
      const stat = statSync(path, { bigint: true })
      size = stat.size
      mtime = stat.mtimeNs
    }
    const cached = this.cache.get(owner)
    if (cached !== undefined && cached.size === size && cached.mtime === mtime) return cached
    const preferences = size === 0n ? DEFAULT_PERSONALIZATION : parsePersonalization(readFileSync(path, 'utf8'))
    const entry = { size, mtime, preferences, block: renderPersonalization(preferences) }
    this.cache.set(owner, entry)
    return entry
  }
}
