import Schema from '@deepseek-ai/schemastery'
import { CAPABILITY_SETTINGS_NAMESPACE } from './ids.ts'

/**
 * Integration-ready capability settings controller for the
 * `coding-subscription-oauth` namespace. Schema defaults sit under the
 * composition/YAML `base`, and the user section layers on top. The controller
 * talks to an injected structural settings service while registering a real
 * Schemastery section that the Host settings service can render and validate.
 * @module @aeven/subscription-auth/capability-settings
 */

/** Settings namespace owned by this plugin. */
export { CAPABILITY_SETTINGS_NAMESPACE } from './ids.ts'

/** Default-off capability flags. Presence in the user section marks an override. */
export const CAPABILITY_FLAG_KEYS = ['codexSearch', 'codexFast'] as const

/**
 * Media generation is part of the subscription rather than a per-deployment
 * choice: image and video generation are always on, and their limits sit at the
 * provider maximum. They stay on {@link CapabilitySettings} so the runtime reads
 * one shape, but they are not writable and never appear in Settings.
 */
export const FIXED_CAPABILITIES = {
  codexImages: true,
  codexImageEdits: true,
  codexImagesAnyModel: true,
  grokImagineImage: true,
  grokImagineVideo: true,
} as const

/** Conservative numeric limits persisted beside the flags. */
export const CAPABILITY_LIMIT_KEYS = ['searchResults'] as const

/** Every key the controller admits into secret-free state. */
export const CAPABILITY_SETTINGS_KEYS = [...CAPABILITY_FLAG_KEYS, ...CAPABILITY_LIMIT_KEYS] as const

/** A default-off boolean capability key. */
export type CapabilityFlagKey = (typeof CAPABILITY_FLAG_KEYS)[number]
/** A bounded numeric capability key. */
export type CapabilityLimitKey = (typeof CAPABILITY_LIMIT_KEYS)[number]

/** Resolved, secret-free capability section. */
export interface CapabilitySettings {
  /** Publish Codex-backed web search, which spends the Codex subscription's quota. */
  readonly codexSearch: boolean
  /** Publish the Codex image generation tool. Fixed on; see {@link FIXED_CAPABILITIES}. */
  readonly codexImages: boolean
  /** Publish the Codex image edit tool. Fixed on; see {@link FIXED_CAPABILITIES}. */
  readonly codexImageEdits: boolean
  /** Allow non-Codex-route models to use the Codex image generate/edit tools. Fixed on. */
  readonly codexImagesAnyModel: boolean
  /** Publish the Codex Fast route when the live catalogue confirms priority eligibility. */
  readonly codexFast: boolean
  /** Publish the Grok Imagine image tool. Fixed on; see {@link FIXED_CAPABILITIES}. */
  readonly grokImagineImage: boolean
  /** Publish the Grok Imagine video tools. Fixed on; see {@link FIXED_CAPABILITIES}. */
  readonly grokImagineVideo: boolean
  /** Upper bound on results returned by Codex-backed search. */
  readonly searchResults: number
  /** Images one generate call may return. Pinned to the provider maximum. */
  readonly imageCount: number
  /** How long a generated video artifact is retained. Pinned to the provider maximum. */
  readonly videoArtifactTtlMs: number
}

/** Sparse overlay used for YAML/composition `base` and the user section. */
export type CapabilitySettingsPatch = Partial<CapabilitySettings>

/** Inclusive bounds and schema defaults for each numeric limit. */
export const CAPABILITY_SETTINGS_BOUNDS = {
  searchResults: { min: 1, max: 20, default: 5 },
  imageCount: { min: 1, max: 4, default: 1 },
  videoArtifactTtlMs: {
    min: 60 * 60 * 1000,
    max: 7 * 24 * 60 * 60 * 1000,
    default: 7 * 24 * 60 * 60 * 1000,
  },
} as const

/** Schema defaults: every flag off, every limit at its conservative default. */
export const DEFAULT_CAPABILITY_SETTINGS: CapabilitySettings = Object.freeze({
  codexSearch: false,
  codexFast: false,
  ...FIXED_CAPABILITIES,
  searchResults: CAPABILITY_SETTINGS_BOUNDS.searchResults.default,
  imageCount: CAPABILITY_SETTINGS_BOUNDS.imageCount.max,
  videoArtifactTtlMs: CAPABILITY_SETTINGS_BOUNDS.videoArtifactTtlMs.max,
})

/**
 * Real Schemastery schema registered with the Host settings service. Defaults
 * remain conservative, and bounds are enforced before a user document commits.
 */
export const CapabilitySettingsSchema = Schema.object({
  codexSearch: Schema.boolean().default(false),
  codexFast: Schema.boolean().default(false),
  searchResults: Schema.number()
    .step(1)
    .min(CAPABILITY_SETTINGS_BOUNDS.searchResults.min)
    .max(CAPABILITY_SETTINGS_BOUNDS.searchResults.max)
    .default(CAPABILITY_SETTINGS_BOUNDS.searchResults.default),
})

/** Serialized schema metadata consumed by Settings UI tests and diagnostics. */
export const CAPABILITY_SETTINGS_SCHEMA_JSON = CapabilitySettingsSchema.toJSON()

/** Static type of the capability settings schema. */
export type CapabilitySettingsSchemaType = typeof CapabilitySettingsSchema

/** Revision-bearing, secret-free snapshot used for CAS writes and UI. */
export interface CapabilitySettingsSnapshot {
  readonly ns: typeof CAPABILITY_SETTINGS_NAMESPACE
  readonly value: CapabilitySettings
  readonly base?: CapabilitySettingsPatch
  readonly user?: CapabilitySettingsPatch
  readonly revision: number
  readonly writable: boolean
  readonly applies: 'live'
  readonly secrets: readonly []
}

/** Owner-facing subset of `ctx.settings.register()` used when the parent injects a provider. */
export interface CapabilitySettingsScope {
  get(): unknown
  watch(callback: (next: unknown, prev: unknown) => void | Promise<void>): () => void
  update(patch: object): Promise<void>
  replace(section: object): Promise<void>
}

/** One namespace descriptor as returned by a structural `describe()`. */
export interface CapabilitySettingsDescriptor {
  readonly ns: string
  readonly value?: unknown
  readonly base?: unknown
  readonly user?: unknown
  readonly revision?: number
  readonly applies?: 'live' | 'restart'
  readonly secrets?: readonly { readonly path?: readonly string[]; readonly set?: boolean }[]
}

/**
 * Duck-typed settings service. A real `ctx.settings` satisfies this without a
 * compile-time dependency on `@aeven/settings`.
 */
export interface CapabilitySettingsService {
  readonly writable?: boolean
  describe?(options?: { readonly redactSecrets?: boolean }): readonly CapabilitySettingsDescriptor[]
  get?(ns: string): unknown
  update?(ns: string, patch: object, expectedRevision?: number): Promise<void>
  replace?(ns: string, section: object, expectedRevision?: number): Promise<void>
  register?(
    ns: string,
    schema: CapabilitySettingsSchemaType,
    options?: {
      readonly base?: CapabilitySettingsPatch
      readonly applies?: 'live' | 'restart'
      readonly validate?: (value: CapabilitySettings) => void
    },
  ): CapabilitySettingsScope
}

/** Construction options. `base` is the YAML / composition entry layered under the user section. */
export interface CapabilitySettingsControllerOptions {
  readonly settings?: CapabilitySettingsService | undefined
  readonly base?: CapabilitySettingsPatch | undefined
  /** Contain both synchronous and asynchronous observer failures. */
  readonly onListenerError?: ((error: unknown) => void) | undefined
}

/** Listener invoked after a committed snapshot change. */
export type CapabilitySettingsListener = (snapshot: CapabilitySettingsSnapshot) => void | Promise<void>

const SECRET_KEY = /secret|token|password|passphrase|apikey|api_key|authorization|credential|cookie|private[_-]?key/iu
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const KNOWN_KEYS = new Set<string>(CAPABILITY_SETTINGS_KEYS)

/**
 * A write refused because the namespace moved since the caller read it.
 * `code` matches the Host settings seam so a later wire layer can map it.
 */
export class CapabilitySettingsConflictError extends Error {
  /** Matches the Host settings seam's conflict code. */
  readonly code = 'SETTINGS_CONFLICT'
  /** The settings namespace the write targeted. */
  readonly ns = CAPABILITY_SETTINGS_NAMESPACE
  /** Revision the caller read before writing. */
  readonly expected: number
  /** Revision the namespace holds now. */
  readonly actual: number

  constructor(expected: number, actual: number) {
    super(
      `settings namespace "${CAPABILITY_SETTINGS_NAMESPACE}" changed since it was read ` +
				`(expected revision ${String(expected)}, now ${String(actual)})`,
    )
    this.name = 'CapabilitySettingsConflictError'
    this.expected = expected
    this.actual = actual
  }
}

/** A write refused because no writable settings provider is attached. */
export class CapabilitySettingsReadOnlyError extends Error {
  /** Host settings seam code for `reason`. */
  readonly code: 'SETTINGS_PROVIDER_ABSENT' | 'SETTINGS_READ_ONLY' | 'SETTINGS_DISPOSED'
  /** The settings namespace the write targeted. */
  readonly ns = CAPABILITY_SETTINGS_NAMESPACE
  /** Why no write is possible: no provider, a read-only provider, or a disposed controller. */
  readonly reason: 'absent' | 'read-only' | 'disposed'

  constructor(reason: 'absent' | 'read-only' | 'disposed') {
    const code =
      reason === 'absent'
        ? 'SETTINGS_PROVIDER_ABSENT'
        : reason === 'disposed'
          ? 'SETTINGS_DISPOSED'
          : 'SETTINGS_READ_ONLY'
    const detail =
      reason === 'absent'
        ? `settings provider is absent: "${CAPABILITY_SETTINGS_NAMESPACE}" cannot be updated`
        : reason === 'disposed'
          ? `settings controller is disposed: "${CAPABILITY_SETTINGS_NAMESPACE}" cannot be updated`
          : `settings provider is read-only: "${CAPABILITY_SETTINGS_NAMESPACE}" cannot be updated in-process`
    super(detail)
    this.name = 'CapabilitySettingsReadOnlyError'
    this.code = code
    this.reason = reason
  }
}

/**
 * Narrow to a compare-and-swap conflict.
 * @param error - any thrown value.
 * @returns true for a {@link CapabilitySettingsConflictError}.
 */
export function isCapabilitySettingsConflictError(error: unknown): error is CapabilitySettingsConflictError {
  return error instanceof CapabilitySettingsConflictError
}

/**
 * Narrow to a refused write.
 * @param error - any thrown value.
 * @returns true for a {@link CapabilitySettingsReadOnlyError}.
 */
export function isCapabilitySettingsReadOnlyError(error: unknown): error is CapabilitySettingsReadOnlyError {
  return error instanceof CapabilitySettingsReadOnlyError
}

/**
 * Pick every independently default-off flag from a resolved section.
 * @param settings - a resolved section.
 * @returns its boolean flags.
 */
export function capabilityFlags(settings: CapabilitySettings): Pick<CapabilitySettings, CapabilityFlagKey> {
  return { codexSearch: settings.codexSearch, codexFast: settings.codexFast }
}

/**
 * Pick the conservative numeric limits from a resolved section.
 * @param settings - a resolved section.
 * @returns its numeric limits.
 */
export function capabilityLimits(settings: CapabilitySettings): Pick<CapabilitySettings, CapabilityLimitKey> {
  return { searchResults: settings.searchResults }
}

/**
 * Layer schema defaults, then YAML/composition `base`, then the user section.
 * @param base - the composition's `cordis.yml` layer.
 * @param user - the user's settings layer.
 * @returns the resolved, frozen section.
 */
export function resolveCapabilitySettings(
  base?: CapabilitySettingsPatch  ,
  user?: CapabilitySettingsPatch  ,
): CapabilitySettings {
  return normalizeCapabilitySettings({
    ...DEFAULT_CAPABILITY_SETTINGS,
    ...normalizeCapabilitySettingsPatch(base),
    ...normalizeCapabilitySettingsPatch(user),
  })
}

/**
 * Admit a candidate section: known keys only, flags default off, limits clamped,
 * secret-shaped keys dropped. Used for both reads and the structural schema.
 * @param input - a candidate section of any shape.
 * @returns the admitted, frozen section with fixed capabilities spread in last.
 */
export function normalizeCapabilitySettings(input?: unknown): CapabilitySettings {
  const patch = normalizeCapabilitySettingsPatch(input)
  return Object.freeze({
    codexSearch: patch.codexSearch ?? DEFAULT_CAPABILITY_SETTINGS.codexSearch,
    codexFast: patch.codexFast ?? DEFAULT_CAPABILITY_SETTINGS.codexFast,
    searchResults: patch.searchResults ?? DEFAULT_CAPABILITY_SETTINGS.searchResults,
    // Fixed by the subscription, so a stale document cannot turn them down.
    ...FIXED_CAPABILITIES,
    imageCount: CAPABILITY_SETTINGS_BOUNDS.imageCount.max,
    videoArtifactTtlMs: CAPABILITY_SETTINGS_BOUNDS.videoArtifactTtlMs.max,
  })
}

/**
 * Normalize a sparse overlay. Invalid or secret fields are omitted so a lower
 * layer (YAML base / schema default) remains authoritative for that key.
 *
 * Unknown keys are dropped rather than rejected, which is what retires the
 * former `codexUsage` flag: a settings document written before usage became
 * unconditional still loads, and the stale key simply stops meaning anything.
 * Writes stay strict — {@link assertCapabilitySettingsPatch} rejects it — so a
 * caller cannot keep setting a flag that no longer gates anything.
 * @param input - a candidate overlay of any shape.
 * @returns the admitted keys only, frozen.
 */
export function normalizeCapabilitySettingsPatch(input?: unknown): CapabilitySettingsPatch {
  if (!isPlainObject(input)) return {}
  const patch: {
    codexSearch?: boolean
    codexFast?: boolean
    searchResults?: number
  } = {}
  const flags = input
  assignFlag(patch, 'codexSearch', flags['codexSearch'])
  assignFlag(patch, 'codexFast', flags['codexFast'])
  assignLimit(patch, 'searchResults', flags['searchResults'])
  return Object.freeze(patch)
}

/**
 * Strictly admit a caller-authored sparse section before normalizing it. Reads
 * remain compatibility-tolerant, but writes must never silently drop unknown
 * fields, coerce types, truncate decimals, or clamp out-of-range limits.
 * @param input - the caller-authored section.
 * @param label - prefix for the thrown messages.
 * @returns nothing; narrows `input` when it does not throw.
 * @throws TypeError naming the first unknown key, wrong type, or out-of-range limit.
 */
export function assertCapabilitySettingsPatch(
  input: unknown,
  label = 'capability settings',
): asserts input is CapabilitySettingsPatch {
  assertPlainObject(input, label)
  for (const [key, value] of Object.entries(input)) {
    if (!KNOWN_KEYS.has(key)) throw new TypeError(`${label} contains unknown key ${key}`)
    if ((CAPABILITY_FLAG_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') throw new TypeError(`${label}.${key} must be a boolean`)
      continue
    }
    const limitKey = key as CapabilityLimitKey
    const bounds = CAPABILITY_SETTINGS_BOUNDS[limitKey]
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      throw new TypeError(`${label}.${key} must be an integer`)
    }
    if (value < bounds.min || value > bounds.max) {
      throw new TypeError(`${label}.${key} must be in [${String(bounds.min)}, ${String(bounds.max)}]`)
    }
  }
}

/** Reject a resolved section the owner could not act on. Schema-valid by construction after normalize. */
function assertServiceableCapabilitySettings(value: CapabilitySettings): void {
  for (const key of CAPABILITY_FLAG_KEYS) {
    if (typeof value[key] !== 'boolean') {
      throw new TypeError(`capability settings: ${key} must be a boolean`)
    }
  }
  for (const key of CAPABILITY_LIMIT_KEYS) {
    const bounds = CAPABILITY_SETTINGS_BOUNDS[key]
    const numeric = value[key]
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < bounds.min || numeric > bounds.max) {
      throw new TypeError(
        `capability settings: ${key} must be an integer in [${String(bounds.min)}, ${String(bounds.max)}]`,
      )
    }
  }
}

/**
 * Live capability-settings controller. Without an injected provider the
 * resolved state is the YAML/default layer and every write fails explicitly.
 */
export class CapabilitySettingsController {
  /** The settings namespace this controller owns. */
  readonly ns = CAPABILITY_SETTINGS_NAMESPACE
  private readonly settings: CapabilitySettingsService | undefined
  private readonly base: CapabilitySettingsPatch
  private readonly onListenerError: (error: unknown) => void
  private readonly listeners = new Set<CapabilitySettingsListener>()
  private scope: CapabilitySettingsScope | undefined
  private scopeDisposer: (() => void) | undefined
  private localRevision = 0
  private lastSnapshot: CapabilitySettingsSnapshot
  private disposed = false

  constructor(options: CapabilitySettingsControllerOptions = {}) {
    this.settings = options.settings
    this.base = normalizeCapabilitySettingsPatch(options.base)
    this.onListenerError = options.onListenerError ?? (() => undefined)
    this.attachScope()
    this.lastSnapshot = this.readSnapshot()
  }

  /**
   * Current revision-bearing snapshot. Re-reads the injected provider when present.
   * @returns the current snapshot, which also becomes the last published one.
   */
  snapshot(): CapabilitySettingsSnapshot {
    const next = this.readSnapshot()
    this.lastSnapshot = next
    return next
  }

  /**
   * Resolved capability section (schema defaults ← YAML base ← user).
   * @returns the resolved section of a fresh snapshot.
   */
  current(): CapabilitySettings {
    return this.snapshot().value
  }

  /**
	 * Merge a secret-free patch into the user layer using compare-and-swap on
	 * `expectedRevision` from a previously read {@link snapshot}.
   * @param patch - the keys to change.
   * @param expectedRevision - revision from the snapshot the caller read.
   * @returns the snapshot after the write.
   * @throws CapabilitySettingsConflictError when the revision moved; CapabilitySettingsReadOnlyError when no write is possible.
	 */
  async patch(patch: CapabilitySettingsPatch, expectedRevision: number): Promise<CapabilitySettingsSnapshot> {
    return this.write('update', patch, expectedRevision)
  }

  /**
	 * Replace the user section wholesale (`{}` re-inherits YAML base and defaults).
	 * Compare-and-swap uses the same revision token as {@link patch}.
   * @param section - the whole user section.
   * @param expectedRevision - revision from the snapshot the caller read.
   * @returns the snapshot after the write.
   * @throws CapabilitySettingsConflictError when the revision moved; CapabilitySettingsReadOnlyError when no write is possible.
	 */
  async replace(section: CapabilitySettingsPatch, expectedRevision: number): Promise<CapabilitySettingsSnapshot> {
    return this.write('replace', section, expectedRevision)
  }

  /**
	 * Observe committed snapshot changes. The disposer removes this listener;
	 * an invocation already running still settles.
   * @param listener - called with each committed snapshot.
   * @returns the disposer; a no-op once the controller is disposed.
	 */
  subscribe(listener: CapabilitySettingsListener): () => void {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
	 * Re-read the injected provider (or the local YAML/default layer) and notify
	 * listeners when the secret-free snapshot moved.
   * @returns the last published snapshot.
	 */
  reconcile(): CapabilitySettingsSnapshot {
    const next = this.readSnapshot()
    this.publish(next)
    return this.lastSnapshot
  }

  /** Drop the register() watcher and every listener. Further writes fail. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const releaseScope = this.scopeDisposer
    this.scopeDisposer = undefined
    this.scope = undefined
    this.listeners.clear()
    try {
      releaseScope?.()
    } catch (error: unknown) {
      this.onListenerError(error)
    }
  }

  private attachScope(): void {
    // oxlint-disable-next-line typescript/unbound-method -- invoked immediately with .call(receiver) below, so `this` is preserved
    const register = this.settings?.register
    if (register === undefined) return
    this.scope = register.call(this.settings, CAPABILITY_SETTINGS_NAMESPACE, CapabilitySettingsSchema, {
      base: this.base,
      applies: 'live',
      validate: assertServiceableCapabilitySettings,
    })
    this.scopeDisposer = this.scope.watch(() => {
      if (this.disposed) return
      this.reconcile()
    })
  }

  private writeReason(): 'absent' | 'read-only' | 'disposed' | undefined {
    if (this.disposed) return 'disposed'
    if (this.settings === undefined) return 'absent'
    if (this.settings.writable === false) return 'read-only'
    const canWrite =
      typeof this.settings.update === 'function' ||
			typeof this.settings.replace === 'function' ||
			this.scope !== undefined
    if (!canWrite) return 'read-only'
    return undefined
  }

  /**
   * The write this settings surface offers for `mode`: the provider's own
   * namespaced method when it has one, else the registered scope.
   */
  private writerFor(mode: 'update' | 'replace'): ((patch: object, expectedRevision: number) => Promise<void>) | undefined {
    const settings = this.settings
    // oxlint-disable-next-line typescript/unbound-method -- invoked immediately with .call(settings) below, so `this` is preserved
    const direct = mode === 'update' ? settings?.update : settings?.replace
    if (settings !== undefined && direct !== undefined) {
      return (patch, expectedRevision) => direct.call(settings, CAPABILITY_SETTINGS_NAMESPACE, patch, expectedRevision)
    }
    const scope = this.scope
    if (scope === undefined) return undefined
    return patch => (mode === 'update' ? scope.update(patch) : scope.replace(patch))
  }

  private isWritable(): boolean {
    return this.writeReason() === undefined
  }

  private async write(
    mode: 'update' | 'replace',
    input: CapabilitySettingsPatch,
    expectedRevision: number,
  ): Promise<CapabilitySettingsSnapshot> {
    const reason = this.writeReason()
    if (reason !== undefined) throw new CapabilitySettingsReadOnlyError(reason)
    assertCapabilitySettingsPatch(input, `capability settings ${mode}`)
    const current = this.readSnapshot()
    if (expectedRevision !== current.revision) {
      throw new CapabilitySettingsConflictError(expectedRevision, current.revision)
    }
    const normalized = normalizeCapabilitySettingsPatch(input)
    if (mode === 'update' && !hasOwnKeys(normalized)) return current
    // A surface can offer one mode and not the other; that mode is then read-only.
    const writer = this.writerFor(mode)
    if (writer === undefined) throw new CapabilitySettingsReadOnlyError('read-only')
    try {
      await writer({ ...normalized }, expectedRevision)
    } catch (error) {
      throw toConflictError(error) ?? error
    }
    this.localRevision = current.revision + 1
    const next = this.readSnapshot()
    this.publish(next)
    return this.lastSnapshot
  }

  private readSnapshot(): CapabilitySettingsSnapshot {
    const writable = this.isWritable()
    const described = this.readDescribed()
    const base = described?.base !== undefined ? normalizeCapabilitySettingsPatch(described.base) : this.base
    const user = described?.user !== undefined ? normalizeCapabilitySettingsPatch(described.user) : undefined
    const resolved =
      described?.value !== undefined
        ? normalizeCapabilitySettings(described.value)
        : this.readResolvedFromService(base, user)
    const revision =
      typeof described?.revision === 'number' && Number.isFinite(described.revision)
        ? described.revision
        : this.localRevision
    return freezeSnapshot({
      ns: CAPABILITY_SETTINGS_NAMESPACE,
      value: resolved,
      revision,
      writable,
      applies: 'live',
      secrets: [],
      ...(hasOwnKeys(base) ? { base } : {}),
      ...(user !== undefined && hasOwnKeys(user) ? { user } : {}),
    })
  }

  private readResolvedFromService(
    base: CapabilitySettingsPatch,
    user: CapabilitySettingsPatch | undefined,
  ): CapabilitySettings {
    const raw = this.scope?.get() ?? this.settings?.get?.(CAPABILITY_SETTINGS_NAMESPACE)
    if (raw !== undefined) return normalizeCapabilitySettings(raw)
    return resolveCapabilitySettings(base, user)
  }

  private readDescribed(): CapabilitySettingsDescriptor | undefined {
    // oxlint-disable-next-line typescript/unbound-method -- invoked immediately with .call(this.settings) below, so `this` is preserved
    const describe = this.settings?.describe
    if (describe === undefined) return undefined
    try {
      const descriptors: unknown = describe.call(this.settings, { redactSecrets: true })
      if (!Array.isArray(descriptors)) return undefined
      const listed = descriptors as CapabilitySettingsDescriptor[]
      return listed.find(entry => entry.ns === CAPABILITY_SETTINGS_NAMESPACE)
    } catch {
      return undefined
    }
  }

  private publish(next: CapabilitySettingsSnapshot): void {
    if (sameSnapshot(this.lastSnapshot, next)) {
      this.lastSnapshot = next
      return
    }
    this.lastSnapshot = next
    for (const listener of [...this.listeners]) {
      try {
        const result = listener(next)
        if (result !== undefined) void Promise.resolve(result).catch(this.onListenerError)
      } catch (error) {
        // One broken observer must not starve the rest or the write path.
        this.onListenerError(error)
      }
    }
  }
}

/**
 * Construct a {@link CapabilitySettingsController}.
 * @param options - the settings provider, YAML base, and listener error sink.
 * @returns a new controller.
 */
export function createCapabilitySettingsController(
  options: CapabilitySettingsControllerOptions = {},
): CapabilitySettingsController {
  return new CapabilitySettingsController(options)
}

function assignFlag<K extends CapabilityFlagKey>(target: { [P in K]?: boolean }, key: K, value: unknown): void {
  if (typeof value === 'boolean') target[key] = value
}

function assignLimit<K extends CapabilityLimitKey>(target: { [P in K]?: number }, key: K, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) return
  const bounds = CAPABILITY_SETTINGS_BOUNDS[key]
  const integer = Math.trunc(value)
  target[key] = Math.min(bounds.max, Math.max(bounds.min, integer))
}

/**
 * Whether a value is a plain data object: not null, not an array, and either an
 * object literal or a null-prototype record. Exported because the route layer
 * admits wire bodies and credential probes by the same rule.
 * @param value - any candidate value.
 * @returns true for a plain object, narrowing it to a string-keyed record.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`)
  for (const key of Object.keys(value)) {
    if (RESERVED_KEYS.has(key) || SECRET_KEY.test(key)) {
      throw new TypeError(`${label} must be secret-free (rejected key ${key})`)
    }
  }
}

function hasOwnKeys(value: object): boolean {
  return Object.keys(value).length > 0
}

function freezeSnapshot(snapshot: CapabilitySettingsSnapshot): CapabilitySettingsSnapshot {
  return Object.freeze(snapshot)
}

function sameSnapshot(left: CapabilitySettingsSnapshot | undefined, right: CapabilitySettingsSnapshot): boolean {
  if (left === undefined) return false
  return (
    left.revision === right.revision &&
		left.writable === right.writable &&
		sameSection(left.value, right.value) &&
		sameSection(left.base, right.base) &&
		sameSection(left.user, right.user)
  )
}

/**
 * Compare two snapshot sections. Every section this module publishes comes from
 * {@link normalizeCapabilitySettings} or {@link normalizeCapabilitySettingsPatch},
 * so both sides hold only flat boolean and number keys: one strict comparison
 * per key already decides every published section exactly.
 * @param left - the previously published section, absent when it carried no keys.
 * @param right - the freshly read section, absent when it carried no keys.
 * @returns whether both sections hold the same keys with the same values.
 */
function sameSection(left: object | undefined, right: object | undefined): boolean {
  const current = { ...left } as Record<string, unknown>
  const next = { ...right } as Record<string, unknown>
  const keys = Object.keys(current)
  return keys.length === Object.keys(next).length && keys.every(key => current[key] === next[key])
}

function toConflictError(error: unknown): CapabilitySettingsConflictError | undefined {
  if (error instanceof CapabilitySettingsConflictError) return error
  if (typeof error !== 'object' || error === null) return undefined
  const candidate = error as { code?: unknown; expected?: unknown; actual?: unknown }
  if (candidate.code !== 'SETTINGS_CONFLICT') return undefined
  if (typeof candidate.expected !== 'number' || typeof candidate.actual !== 'number') return undefined
  return new CapabilitySettingsConflictError(candidate.expected, candidate.actual)
}
