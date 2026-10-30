/** Per-language voice preference, stored in the browser so a reader keeps the voice it picked. */
import type { ConversationNode } from '@aeven/client-ui-conversation/client'

/** Voice roster and language mapping the picker draws. */
export interface ReadAloudCatalog {
  readonly voices: readonly {
    readonly id: string
    readonly name: string
    readonly language: string
    readonly gender?: 'female' | 'male'
  }[]
  readonly voiceByLanguage: Readonly<Record<string, string>>
}

/** Storage key holding the language-to-voice preference. */
export const STORAGE_KEY = 'aeven.read-aloud.voices'

/** Storage key holding whether reading was switched on, which outlives the Session it was switched on in. */
export const ENABLED_KEY = 'aeven.read-aloud.enabled'

/**
 * Read the reader's standing choice of whether replies are read aloud.
 * @returns whether reading was on when the reader last touched the toggle.
 */
export function readEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(ENABLED_KEY) === 'on'
}

/**
 * Store the reader's standing choice, so the next Session — or the next launch — starts the same way.
 * @param enabled - whether reading is on.
 */
export function writeEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? 'on' : 'off')
  } catch {
    // Private-mode storage rejects writes; the choice then lasts for this page only.
  }
}

/**
 * Read the stored preference map.
 * @returns language subtag to voice id, empty when storage holds nothing usable.
 */
export function readPreferences(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const stored: unknown = JSON.parse(raw)
    if (typeof stored !== 'object' || stored === null) return {}
    const preferences: Record<string, string> = {}
    for (const [language, voice] of Object.entries(stored)) {
      if (typeof voice === 'string') preferences[language] = voice
    }
    return preferences
  } catch {
    return {}
  }
}

/**
 * Store one language's voice, or forget it when the reader chooses the default again.
 * @param language - primary language subtag, such as `nl`.
 * @param voiceId - voice the reader picked, or null to fall back to the Host default.
 * @returns the preference map after the change.
 */
export function writePreference(language: string, voiceId: string | null): Record<string, string> {
  const preferences = readPreferences()
  const next = voiceId === null
    ? Object.fromEntries(Object.entries(preferences).filter(([stored]) => stored !== language))
    : { ...preferences, [language]: voiceId }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Private-mode storage rejects writes; the choice then lasts for this page only.
    }
  }
  return next
}

/**
 * The voice the reader chose for one language.
 * @param language - primary language subtag of the fragment.
 * @returns the preferred voice id, or nothing when the language follows the Host default.
 */
export function preferredVoice(language: string): string | undefined {
  return readPreferences()[language]
}

/**
 * Group a catalogue's voices by language, most spoken language first, so the picker reads as a list
 * of languages rather than a flat voice dump.
 * @param catalog - voices and the Host language mapping.
 * @returns one entry per language, each with the mapped voice and its own voices sorted by name.
 */
export function groupVoices(catalog: ReadAloudCatalog): {
  readonly language: string
  readonly name: string
  readonly mapped: string | undefined
  /** Voice the language falls back to when the reader keeps the default. */
  readonly defaultVoice: { readonly id: string; readonly name: string } | undefined
  readonly voices: readonly { readonly id: string; readonly name: string }[]
}[] {
  const grouped = new Map<string, { id: string; name: string; gender: 'female' | 'male' | undefined }[]>()
  for (const voice of catalog.voices) {
    const list = grouped.get(voice.language) ?? []
    list.push({ id: voice.id, name: voice.name, gender: voice.gender })
    grouped.set(voice.language, list)
  }
  const names = languageNames()
  return [...grouped.entries()]
    .map(([language, voices]) => ({
      language,
      name: names.of(language) ?? language,
      mapped: catalog.voiceByLanguage[language],
      defaultVoice: pickDefault(voices, catalog.voiceByLanguage[language]),
      voices: [...voices]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(voice => ({ id: voice.id, name: voice.name })),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * The voice a language falls back to: the configured mapping when the deployment names one, otherwise
 * the first female voice of the language, which is the rule the Host resolves with.
 * @param voices - one language's voices.
 * @param mapped - voice id the deployment mapped to the language.
 * @returns the chosen voice, or nothing when the language has no voices.
 */
function pickDefault(
  voices: readonly { readonly id: string; readonly name: string; readonly gender: 'female' | 'male' | undefined }[],
  mapped: string | undefined,
): { readonly id: string; readonly name: string } | undefined {
  const known = mapped === undefined ? undefined : voices.find(voice => voice.id === mapped)
  if (known !== undefined) return { id: known.id, name: known.name }
  const chosen = voices.find(voice => voice.gender === 'female') ?? voices[0]
  return chosen === undefined ? undefined : { id: chosen.id, name: chosen.name }
}

/**
 * The text of one assistant message, which the read-aloud action beside it speaks.
 * @param nodes - flattened conversation nodes in log order.
 * @param messageId - message whose text is wanted.
 * @returns its prose blocks joined, or an empty string when the message holds none.
 */
export function messageText(nodes: readonly ConversationNode[], messageId: string): string {
  for (const node of nodes) {
    if (node.kind !== 'assistant' || node.messageId !== messageId) continue
    const text = node.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('\n\n').trim()
    return text
  }
  return ''
}

/**
 * @returns localized language names for the browsing locale, falling back to the raw subtag.
 */
function languageNames(): Intl.DisplayNames {
  try {
    return new Intl.DisplayNames([navigator.language], { type: 'language' })
  } catch {
    return { of: (code: string) => code } as unknown as Intl.DisplayNames
  }
}

/** The tool an agent calls to switch reading on or off; its settled calls are the only source. */
const READ_ALOUD_TOOL = 'read_aloud'

/**
 * Read the newest settled `read_aloud` call out of the conversation as a value stable between
 * renders: `'<seq>:on'`, `'<seq>:off'`, or `''` before any call.
 * @param nodes - flattened conversation nodes in log order.
 * @returns the request identity and switch, or an empty string.
 */
export function latestReadAloudRequest(nodes: readonly ConversationNode[]): string {
  let latest = ''
  let seq = 0
  for (const node of nodes) {
    if (node.kind !== 'tool-result' || node.call?.name !== READ_ALOUD_TOOL) continue
    if (node.seq <= seq) continue
    seq = node.seq
    latest = `${String(node.seq)}:${readSwitch(node.call.argsRaw) ? 'on' : 'off'}`
  }
  return latest
}

/**
 * Read the `enabled` argument of a call, treating anything unreadable as a request to read.
 * @param argsRaw - the call's arguments as the model sent them.
 * @returns whether the agent asked for reading.
 */
function readSwitch(argsRaw: string): boolean {
  try {
    const args: unknown = JSON.parse(argsRaw)
    if (typeof args !== 'object' || args === null) return true
    return (args as { enabled?: unknown }).enabled !== false
  } catch {
    // A truncated argument tail still belongs to a call that asked to read.
    return true
  }
}
