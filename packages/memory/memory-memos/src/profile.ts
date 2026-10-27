/**
 * The person profile: what a close friend would always know about the owner, distilled from all of their person
 * memories regardless of age and kept up to date in the background as new memories are recorded.
 * @module @aeven/memory-memos/profile
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** One person memory the profile is distilled from. */
export interface PersonFact {
  readonly id: string
  readonly text: string
  /** Epoch milliseconds the memory was stored. */
  readonly time: number
  /** How the memory is dated for the distiller, such as `recorded 2026-10-05` or `imported, undated`. */
  readonly label: string
}

/** The stored profile of one owner. */
export interface StoredProfile {
  readonly version: 1
  readonly text: string
  /** The newest memory folded into `text`, as a `(time, id)` cursor. */
  readonly through: { readonly time: number; readonly id: string }
  /** Epoch milliseconds `text` was last written. */
  readonly updatedAt: number
}

/** Options of {@link PersonProfiles}. */
export interface PersonProfilesOptions {
  /** File holding one owner's stored profile. */
  readonly file: (owner: string) => string
  /** Longest profile, in characters. */
  readonly maxChars: number
  /** Memories folded into the profile per distillation call. */
  readonly batchFacts: number
  /** Shortest interval between two refresh checks of one owner, in milliseconds. */
  readonly refreshMs: number
  /** Longest one distillation call may take, in milliseconds. */
  readonly timeoutMs: number
  readonly warn: (message: string) => void
  readonly info: (message: string) => void
}

/** Runs one distillation call on the route of the session that asked for the profile. */
export type ProfileDistill = (system: string, user: string, timeoutMs: number) => Promise<string>

/**
 * System prompt of one distillation call.
 * @param maxChars - longest profile, in characters.
 * @returns the prompt.
 */
export function profilePrompt(maxChars: number): string {
  return `You keep the profile an assistant reads at the start of every conversation with one person, so that it knows what a close friend would always know about them, however long ago it was said.

You receive the CURRENT PROFILE and NEW MEMORIES recorded since it was written, oldest first, each with the date it was recorded. Return the updated profile.

Write these sections as short bullet lines, leaving out a section with nothing in it:
Identity: full name, names they go by, birth date with year, where they live and come from, languages, work.
People: everyone who matters in their life: name, relation to them, birth date when known, and what matters about them.
Dates: birthdays, wedding day, deaths and other yearly dates, with the year when known.
History: major life events, each with its year or date.
Current situation: what they are going through now, each item ending with when it was last mentioned, as (as of YYYY-MM-DD).
Preferences: how they want to be talked to and treated, and what they care about.

Rules:
- State only what the memories say. Copy names and dates exactly; never guess a date or a year.
- Never write anyone's age: write the birth date, from which the reader works out the age on the day.
- A newer memory replaces an older one about the same thing; keep the older fact only when it still holds.
- Move a current-situation item into History once newer memories show it is over.
- A memory marked imported states what an earlier conversation or document said at the time.
- The assistant's opinions, advice and assessments are not facts about the person: leave them out.
- Stay under ${maxChars} characters: drop minor details before anything in Identity, People or Dates.

Answer with only the profile.`
}

/** Whether a `(time, id)` position comes after the cursor. */
function after(fact: PersonFact, cursor: StoredProfile['through'] | undefined): boolean {
  if (cursor === undefined) return true
  return fact.time > cursor.time || (fact.time === cursor.time && fact.id > cursor.id)
}

/** The owners' stored profiles and the single background refresh of each. */
export class PersonProfiles {
  private readonly cache = new Map<string, StoredProfile | undefined>()
  private readonly checkedAt = new Map<string, number>()
  private readonly running = new Map<string, Promise<void>>()
  private disposed = false

  constructor(private readonly options: PersonProfilesOptions) {}

  /**
   * The owner's stored profile.
   * @param owner - account id.
   * @returns the profile, or undefined before the first distillation finished.
   */
  read(owner: string): StoredProfile | undefined {
    if (!this.cache.has(owner)) this.cache.set(owner, this.load(owner))
    return this.cache.get(owner)
  }

  /**
   * Fold person memories stored after the profile into it, in the background. At most one refresh runs per owner,
   * and an owner is checked at most once per `refreshMs`.
   * @param owner - account id.
   * @param facts - every current person memory of the owner, any order.
   * @param distill - the distillation call on the asking session's route.
   */
  refresh(owner: string, facts: readonly PersonFact[], distill: ProfileDistill): void {
    if (this.disposed || this.running.has(owner)) return
    const now = Date.now()
    if (now - (this.checkedAt.get(owner) ?? 0) < this.options.refreshMs) return
    this.checkedAt.set(owner, now)
    const pending = facts
      .filter(fact => after(fact, this.read(owner)?.through))
      .sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    if (pending.length === 0) return
    const run = this.fold(owner, pending, distill)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        this.options.warn(`person profile refresh failed for ${owner}: ${message}`)
        // The failure stays beside the profile, so a profile that stopped advancing says why.
        writeFileSync(`${this.options.file(owner)}.error`, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 })
      })
      .finally(() => { this.running.delete(owner) })
    this.running.set(owner, run)
  }

  /**
   * Stop starting new distillation calls and wait for the running ones.
   * @returns after every running refresh settled.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.all(this.running.values())
  }

  private async fold(owner: string, pending: readonly PersonFact[], distill: ProfileDistill): Promise<void> {
    const system = profilePrompt(this.options.maxChars)
    for (let start = 0; start < pending.length && !this.disposed; start += this.options.batchFacts) {
      const batch = pending.slice(start, start + this.options.batchFacts)
      const last = batch.at(-1)
      /* v8 ignore next -- slice of a non-empty remainder is non-empty. */
      if (last === undefined) return
      const current = this.read(owner)?.text ?? ''
      const user = `CURRENT PROFILE:\n${current || '(empty)'}\n\nNEW MEMORIES:\n${batch.map(fact => `- (${fact.label}) ${fact.text.replace(/\s+/gu, ' ').trim()}`).join('\n')}`
      const answer = (await distill(system, user, this.options.timeoutMs)).trim()
      // An empty answer would erase the profile; the batch is retried at the next refresh.
      if (!answer) throw new Error('the distillation returned an empty profile')
      const text = answer.length <= this.options.maxChars ? answer : answer.slice(0, this.options.maxChars).replace(/\n[^\n]*$/u, '')
      this.store(owner, { version: 1, text, through: { time: last.time, id: last.id }, updatedAt: Date.now() })
      this.options.info(`person profile of ${owner} folded ${String(start + batch.length)} of ${String(pending.length)} new memories`)
    }
  }

  private load(owner: string): StoredProfile | undefined {
    let raw: string
    try {
      raw = readFileSync(this.options.file(owner), 'utf8')
    } catch {
      // ENOENT: no profile was distilled for this owner yet; any other read error rebuilds it the same way.
      return undefined
    }
    try {
      const parsed = JSON.parse(raw) as Partial<StoredProfile>
      if (parsed.version !== 1 || typeof parsed.text !== 'string' || typeof parsed.updatedAt !== 'number'
        || typeof parsed.through?.time !== 'number' || typeof parsed.through.id !== 'string') throw new Error('unknown format')
      return { version: 1, text: parsed.text, through: { time: parsed.through.time, id: parsed.through.id }, updatedAt: parsed.updatedAt }
    } catch (error) {
      this.options.warn(`person profile of ${owner} is unreadable and is rebuilt: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  private store(owner: string, profile: StoredProfile): void {
    const file = this.options.file(owner)
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    writeFileSync(`${file}.tmp`, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 })
    renameSync(`${file}.tmp`, file)
    rmSync(`${file}.error`, { force: true })
    this.cache.set(owner, profile)
  }
}
