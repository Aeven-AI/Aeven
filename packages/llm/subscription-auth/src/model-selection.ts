/**
 * Per-provider model selection for the subscription providers, persisted as
 * the ids the user switched off.
 *
 * Storing exclusions rather than a selected list keeps the selection valid
 * while the provider's catalog changes: a model the provider adds later is
 * selected by default, and a model it drops leaves the list without touching
 * any other choice. A dropped id that stays in the file is inert.
 * @module @aeven/subscription-auth/model-selection
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { writeFileAtomic } from '@aeven/atomic-write'
import { resolveAvnHome } from '@aeven/home-paths'

/** Basename of the selection document under `${AVN_HOME}`. */
export const MODEL_SELECTION_FILENAME = 'subscription-model-selection.json'

const DOCUMENT_VERSION = 1

interface SelectionDocument {
  version: typeof DOCUMENT_VERSION
  deselected: Record<string, string[]>
}

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function parseDocument(text: string): Map<string, ReadonlySet<string>> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`${MODEL_SELECTION_FILENAME} is not valid JSON`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${MODEL_SELECTION_FILENAME} is not an object`)
  }
  const document = value as Record<string, unknown>
  if (document['version'] !== DOCUMENT_VERSION) {
    throw new Error(`${MODEL_SELECTION_FILENAME} has unsupported version ${String(document['version'])}`)
  }
  const deselected = document['deselected']
  const parsed = new Map<string, ReadonlySet<string>>()
  if (typeof deselected !== 'object' || deselected === null || Array.isArray(deselected)) return parsed
  for (const [provider, ids] of Object.entries(deselected)) {
    if (!Array.isArray(ids)) continue
    parsed.set(provider, new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)))
  }
  return parsed
}

/** Model selection of every subscription provider, owned by one plugin instance. */
export class ModelSelection {
  private deselected = new Map<string, ReadonlySet<string>>()
  private readonly filename: string

  /**
   * @param onChange - called after a selection change is persisted.
   * @param filename - selection document path; defaults under `${AVN_HOME}`.
   */
  constructor(
    private readonly onChange?: (provider: string) => void,
    filename: string = join(resolveAvnHome(), MODEL_SELECTION_FILENAME),
  ) {
    this.filename = resolve(filename)
  }

  /**
   * Load the persisted document. A missing file means every model is selected.
   * @returns once the document is loaded; rejects when it exists but cannot be parsed.
   */
  async load(): Promise<void> {
    try {
      this.deselected = parseDocument(await readFile(this.filename, 'utf8'))
    } catch (error) {
      if (!isENOENT(error)) throw error
    }
  }

  /**
   * Whether a model is selected.
   * @param provider - provider slug.
   * @param modelId - the provider's model id.
   * @returns false only when the user switched the model off.
   */
  isSelected(provider: string, modelId: string): boolean {
    return this.deselected.get(provider)?.has(modelId) !== true
  }

  /**
   * Replace one provider's selection with exactly `selected` among `available`.
   * Ids outside `available` keep their stored state, so a model the provider
   * lists again later returns with the choice the user last made.
   * @param provider - provider slug.
   * @param available - every model id the provider currently offers.
   * @param selected - the ids that should be on.
   */
  async setSelected(provider: string, available: readonly string[], selected: readonly string[]): Promise<void> {
    const on = new Set(selected)
    const next = new Set(this.deselected.get(provider) ?? [])
    for (const id of available) {
      if (on.has(id)) next.delete(id)
      else next.add(id)
    }
    this.deselected = new Map(this.deselected).set(provider, next)
    const document: SelectionDocument = {
      version: DOCUMENT_VERSION,
      deselected: Object.fromEntries([...this.deselected].map(([key, ids]) => [key, [...ids].sort()])),
    }
    await writeFileAtomic(this.filename, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
    this.onChange?.(provider)
  }
}
