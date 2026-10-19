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
  Personalization, PersonalizationReason, PersonalizationState, PersonalizationUpdate, PersonalizationVoice,
} from './types.ts'

/** Format version of the stored document; a document this version cannot read yields the defaults. */
export const PERSONALIZATION_VERSION = 2

/** Every voice a person can choose. */
export const PERSONALIZATION_VOICES: readonly PersonalizationVoice[] = ['automatic', 'warm', 'direct', 'playful']

/** Preferences of a person who has set none: the persona reads the moment, and the shipped master prompt stands. */
export const DEFAULT_PERSONALIZATION: Personalization = { voice: 'automatic', notes: '', masterPrompt: '' }

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
  const { version, voice, notes, masterPrompt } = parsed as Record<string, unknown>
  if (version !== PERSONALIZATION_VERSION) return DEFAULT_PERSONALIZATION
  return {
    voice: PERSONALIZATION_VOICES.includes(voice as PersonalizationVoice) ? voice as PersonalizationVoice : 'automatic',
    notes: typeof notes === 'string' ? notes : '',
    masterPrompt: typeof masterPrompt === 'string' ? masterPrompt : '',
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

/**
 * Where one person's preferences are stored; the owner id is escaped because it names a file.
 * @param root - the directory holding one document per person.
 * @param owner - the person whose document is addressed.
 * @returns the path of that person's JSON document.
 */
export function personalizationPath(root: string, owner: string): string {
  return join(root, `${encodeURIComponent(owner)}.json`)
}

/** What one stored change did, before the controller composes the view a Settings surface reads. */
export interface StoredChange {
  readonly changed: boolean
  readonly reason?: PersonalizationReason
  readonly state: PersonalizationState
}

/** Reads, renders and changes per-person preferences, re-reading a document only when its file moved. */
export class PersonalizationStore {
  // Size and modification time are compared as bigints: at millisecond granularity two writes of the same length
  // within one tick are indistinguishable, and a session would then render the block it already read.
  private readonly cache = new Map<string, { size: bigint; mtime: bigint; preferences: Personalization; block: string }>()

  /**
   * @param root - absolute directory holding the per-person documents.
   * @param maxNotesChars - longest notes text a change may store.
   * @param maxMasterPromptChars - longest master prompt a change may store.
   */
  constructor(
    private readonly root: string,
    private readonly maxNotesChars: number,
    private readonly maxMasterPromptChars: number,
  ) {}

  /**
   * One person's preferences and the bounds a change must fit.
   * @param owner - the signed-in account id.
   * @returns the current state.
   */
  read(owner: string): PersonalizationState {
    return this.stateOf(this.state(owner).preferences)
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
   * Change some of one person's preferences. Text is trimmed, and text over its bound is refused whole rather
   * than clipped.
   * @param owner - the signed-in account id.
   * @param update - the fields to change.
   * @returns what changed, with the reason when the change was refused.
   * @throws when the update names a voice this store does not offer.
   */
  update(owner: string, update: PersonalizationUpdate): StoredChange {
    const current = this.state(owner).preferences
    if (update.voice !== undefined && !PERSONALIZATION_VOICES.includes(update.voice)) {
      throw new Error(`unknown personalization voice: ${update.voice}`)
    }
    const next: Personalization = {
      voice: update.voice ?? current.voice,
      notes: update.notes === undefined ? current.notes : update.notes.trim(),
      masterPrompt: update.masterPrompt === undefined ? current.masterPrompt : update.masterPrompt.trim(),
    }
    const refusal = this.refusal(next)
    if (refusal !== undefined) return { changed: false, reason: refusal, state: this.stateOf(current) }
    if (next.voice === current.voice && next.notes === current.notes && next.masterPrompt === current.masterPrompt) {
      return { changed: false, state: this.stateOf(current) }
    }
    return { changed: true, state: this.stateOf(this.persist(owner, next)) }
  }

  /**
   * Put the shipped master prompt back in charge for one person.
   * @param owner - the signed-in account id.
   * @returns what changed; `changed` is false when the shipped prompt already stood.
   */
  resetMasterPrompt(owner: string): StoredChange {
    const current = this.state(owner).preferences
    if (current.masterPrompt === '') return { changed: false, state: this.stateOf(current) }
    return { changed: true, state: this.stateOf(this.persist(owner, { ...current, masterPrompt: '' })) }
  }

  private refusal(preferences: Personalization): PersonalizationReason | undefined {
    if (preferences.notes.length > this.maxNotesChars) return 'notes-too-long'
    if (preferences.masterPrompt.length > this.maxMasterPromptChars) return 'master-prompt-too-long'
    return undefined
  }

  private stateOf(preferences: Personalization): PersonalizationState {
    return { ...preferences, maxNotesChars: this.maxNotesChars, maxMasterPromptChars: this.maxMasterPromptChars }
  }

  private persist(owner: string, next: Personalization): Personalization {
    const path = personalizationPath(this.root, owner)
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp`
    writeFileSync(temporary, `${JSON.stringify({ version: PERSONALIZATION_VERSION, ...next }, null, 2)}\n`)
    // A rename replaces the document in one step, so a prompt assembly reading it concurrently sees either the
    // previous document or this one, never a half-written one.
    renameSync(temporary, path)
    const stat = statSync(path, { bigint: true })
    this.cache.set(owner, { size: stat.size, mtime: stat.mtimeNs, preferences: next, block: renderPersonalization(next) })
    return next
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
