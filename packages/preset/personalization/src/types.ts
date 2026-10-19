/**
 * The personalization data model: how one person wants Aeven to talk with them, what a Settings surface reads
 * back, and what a change reports. The name Aeven calls them is their account display name, owned by the account,
 * not by this document; what Aeven calls them in conversation is read from the conversation itself.
 *
 * Kept apart from the store so a Remote boundary can name these types without reaching the plugin entry.
 *
 * @module @aeven/personalization/types
 */

/**
 * The voice a person chose. `automatic` keeps the persona's own reading of the moment; every other voice holds
 * across subjects.
 */
export type PersonalizationVoice = 'automatic' | 'warm' | 'direct' | 'playful'

/** One person's stored preferences. */
export interface Personalization {
  /** The voice Aeven uses with this person. */
  readonly voice: PersonalizationVoice
  /** Anything else this person wants Aeven to keep in mind about how it answers, in their own words. */
  readonly notes: string
  /** This person's own master prompt; empty means the deployment's shipped one stands. */
  readonly masterPrompt: string
}

/** One person's stored preferences and the bounds a change must fit. */
export interface PersonalizationState extends Personalization {
  /** Longest notes text the store accepts. */
  readonly maxNotesChars: number
  /** Longest master prompt the store accepts. */
  readonly maxMasterPromptChars: number
}

/** One person's preferences as a Settings surface reads them. */
export interface PersonalizationView extends PersonalizationState {
  /**
   * The master prompt this person's sessions read: their own when they wrote one, otherwise the shipped
   * deployment prompt.
   */
  readonly effectiveMasterPrompt: string
  /** Whether {@link effectiveMasterPrompt} is this person's own, rather than the shipped prompt. */
  readonly customMasterPrompt: boolean
}

/** A partial change; an absent field keeps its stored value. */
export interface PersonalizationUpdate {
  readonly voice?: PersonalizationVoice
  readonly notes?: string
  readonly masterPrompt?: string
}

/** Why a change did not happen; absent when it did. */
export type PersonalizationReason = 'notes-too-long' | 'master-prompt-too-long'

/** What a change did, with the person's preferences as they stand after the attempt. */
export interface PersonalizationChange {
  readonly changed: boolean
  readonly reason?: PersonalizationReason
  readonly view: PersonalizationView
}
