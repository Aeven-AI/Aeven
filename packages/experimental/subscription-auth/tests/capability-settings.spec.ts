import { describe, expect, it } from 'vitest'
import {
  assertCapabilitySettingsPatch,
  CAPABILITY_SETTINGS_BOUNDS,
  CAPABILITY_SETTINGS_NAMESPACE,
  CAPABILITY_SETTINGS_SCHEMA_JSON,
  type CapabilitySettings,
  CapabilitySettingsConflictError,
  CapabilitySettingsController,
  type CapabilitySettingsDescriptor,
  type CapabilitySettingsPatch,
  CapabilitySettingsReadOnlyError,
  CapabilitySettingsSchema,
  type CapabilitySettingsSchemaType,
  type CapabilitySettingsScope,
  type CapabilitySettingsService,
  capabilityFlags,
  capabilityLimits,
  createCapabilitySettingsController,
  DEFAULT_CAPABILITY_SETTINGS,
  FIXED_CAPABILITIES,
  isCapabilitySettingsConflictError,
  isCapabilitySettingsReadOnlyError,
  normalizeCapabilitySettings,
  normalizeCapabilitySettingsPatch,
  resolveCapabilitySettings,
} from '../src/capability-settings.ts'

class SettingsConflictError extends Error {
  readonly code = 'SETTINGS_CONFLICT'
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`conflict ${String(expected)} -> ${String(actual)}`)
    this.name = 'SettingsConflictError'
  }
}

/** In-memory structural stand-in for `ctx.settings`. */
class FakeSettingsService implements CapabilitySettingsService {
  writable: boolean
  private readonly document = new Map<string, Record<string, unknown>>()
  private readonly registrations = new Map<
    string,
    {
      schema: CapabilitySettingsSchemaType
      base: CapabilitySettingsPatch
      revision: number
      watchers: Set<() => void>
    }
  >()

  constructor(writable = true, seed?: Record<string, unknown>) {
    this.writable = writable
    if (seed !== undefined) this.document.set(CAPABILITY_SETTINGS_NAMESPACE, { ...seed })
  }

  register(
    ns: string,
    schema: CapabilitySettingsSchemaType,
    options?: { readonly base?: CapabilitySettingsPatch; readonly applies?: 'live' | 'restart' },
  ): CapabilitySettingsScope {
    if (this.registrations.has(ns)) throw new Error(`settings namespace "${ns}" is already registered`)
    const registration = {
      schema,
      base: options?.base ?? {},
      revision: 0,
      watchers: new Set<() => void>(),
    }
    this.registrations.set(ns, registration)
    return {
      get: () => this.resolved(ns),
      watch: (callback) => {
        const watcher = (): void => {
          void callback(this.resolved(ns), this.resolved(ns))
        }
        registration.watchers.add(watcher)
        return () => {
          registration.watchers.delete(watcher)
        }
      },
      update: patch => this.update(ns, patch),
      replace: section => this.replace(ns, section),
    }
  }

  describe(): CapabilitySettingsDescriptor[] {
    return [...this.registrations.entries()].map(([ns, registration]) => {
      const user = this.document.get(ns)
      return {
        ns,
        value: this.resolved(ns),
        base: { ...registration.base },
        ...(user === undefined ? {} : { user: { ...user } }),
        revision: registration.revision,
        applies: 'live' as const,
        secrets: [],
      }
    })
  }

  get(ns: string): unknown {
    return this.registrations.has(ns) ? this.resolved(ns) : undefined
  }

  async update(ns: string, patch: object, expectedRevision?: number): Promise<void> {
    this.assertWritable(ns)
    const current = this.document.get(ns) ?? {}
    this.assertRevision(ns, expectedRevision)
    this.document.set(ns, { ...current, ...(patch as Record<string, unknown>) })
    this.bump(ns)
  }

  async replace(ns: string, section: object, expectedRevision?: number): Promise<void> {
    this.assertWritable(ns)
    this.assertRevision(ns, expectedRevision)
    this.document.set(ns, { ...(section as Record<string, unknown>) })
    this.bump(ns)
  }

  /** External edit used to exercise reconcile() without going through the controller. */
  publish(ns: string, section: Record<string, unknown>): void {
    this.document.set(ns, { ...section })
    this.bump(ns)
  }

  private resolved(ns: string): CapabilitySettings {
    const registration = this.registrations.get(ns)
    const schema = registration?.schema ?? CapabilitySettingsSchema
    // The schema now carries only the writable fields; the fixed media
    // capabilities and their pinned limits come from the resolved defaults.
    return { ...DEFAULT_CAPABILITY_SETTINGS, ...schema({ ...registration?.base, ...this.document.get(ns) }) }
  }

  private assertWritable(ns: string): void {
    if (!this.writable) throw new Error(`settings provider is read-only: "${ns}" cannot be updated in-process`)
  }

  private assertRevision(ns: string, expectedRevision: number | undefined): void {
    const actual = this.registrations.get(ns)?.revision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== actual) {
      throw new SettingsConflictError(expectedRevision, actual)
    }
  }

  private bump(ns: string): void {
    const registration = this.registrations.get(ns)
    if (registration === undefined) return
    registration.revision += 1
    for (const watcher of [...registration.watchers]) watcher()
  }
}

describe('capability settings schema', () => {
  it('defaults the choosable flags off and pins media generation on at its provider maximum', () => {
    expect(normalizeCapabilitySettings(undefined)).toEqual(DEFAULT_CAPABILITY_SETTINGS)
    expect(normalizeCapabilitySettings({})).toEqual(DEFAULT_CAPABILITY_SETTINGS)
    expect(capabilityFlags(DEFAULT_CAPABILITY_SETTINGS)).toEqual({ codexSearch: false, codexFast: false })
    expect(capabilityLimits(DEFAULT_CAPABILITY_SETTINGS)).toEqual({
      searchResults: CAPABILITY_SETTINGS_BOUNDS.searchResults.default,
    })
    // Media generation is part of the subscription, not a deployment choice.
    expect(DEFAULT_CAPABILITY_SETTINGS).toMatchObject({
      ...FIXED_CAPABILITIES,
      imageCount: CAPABILITY_SETTINGS_BOUNDS.imageCount.max,
      videoArtifactTtlMs: CAPABILITY_SETTINGS_BOUNDS.videoArtifactTtlMs.max,
    })
  })

  it('refuses to let a stored document turn the fixed media capabilities down', () => {
    const forced = normalizeCapabilitySettings({
      codexImages: false,
      codexImageEdits: false,
      codexImagesAnyModel: false,
      grokImagineImage: false,
      grokImagineVideo: false,
      imageCount: 1,
      videoArtifactTtlMs: 60 * 60 * 1000,
    })
    expect(forced).toMatchObject({
      ...FIXED_CAPABILITIES,
      imageCount: CAPABILITY_SETTINGS_BOUNDS.imageCount.max,
      videoArtifactTtlMs: CAPABILITY_SETTINGS_BOUNDS.videoArtifactTtlMs.max,
    })
  })

  it('clamps limits, ignores unserviceable values, and drops secret-shaped keys', () => {
    expect(
      normalizeCapabilitySettings({
        codexSearch: true,
        codexFast: 1,
        searchResults: 99,
        apiKey: 'sk-secret',
        access_token: 'tok',
        extra: { nested: true },
      }),
    ).toEqual({
      ...DEFAULT_CAPABILITY_SETTINGS,
      codexSearch: true,
      searchResults: CAPABILITY_SETTINGS_BOUNDS.searchResults.max,
    })
    expect(
      normalizeCapabilitySettingsPatch({ searchResults: Number.NaN }),
    ).toEqual({})
    expect(CapabilitySettingsSchema({ searchResults: 3 }).searchResults).toBe(3)
    expect(CapabilitySettingsSchema.toJSON()).toEqual(CAPABILITY_SETTINGS_SCHEMA_JSON)
  })

  it('strictly rejects caller-authored invalid patches instead of silently normalizing them', () => {
    expect(() =>{  assertCapabilitySettingsPatch({ codexSearch: 'yes' }, 'patch') }).toThrow(/must be a boolean/)
    expect(() =>{  assertCapabilitySettingsPatch({ searchResults: 2.5 }, 'patch') }).toThrow(/must be an integer/)
    expect(() =>{  assertCapabilitySettingsPatch({ searchResults: 21 }, 'patch') }).toThrow(/must be in/)
    expect(() =>{  assertCapabilitySettingsPatch({ unexpected: true }, 'patch') }).toThrow(/unknown key/)
    expect(() =>{  assertCapabilitySettingsPatch({ apiKey: 'not-admitted' }, 'patch') }).toThrow(/secret-free/)
    expect(() =>{  assertCapabilitySettingsPatch({ searchResults: 20 }, 'patch') }).not.toThrow()
    // The fixed media capabilities are no longer settings, so naming one is an unknown key.
    expect(() =>{  assertCapabilitySettingsPatch({ imageCount: 4 }, 'patch') }).toThrow(/unknown key/)
  })

  it('layers YAML/default base under the user section', () => {
    expect(
      resolveCapabilitySettings({ searchResults: 3, codexSearch: true }, { searchResults: 7, codexFast: true }),
    ).toEqual({
      ...DEFAULT_CAPABILITY_SETTINGS,
      codexSearch: true,
      codexFast: true,
      searchResults: 7,
    })
  })

  it('registers the namespace and treats the user section as authoritative when writable', async () => {
    const settings = new FakeSettingsService(true, { searchResults: 2, codexFast: true })
    const controller = new CapabilitySettingsController({
      settings,
      base: { searchResults: 6, codexSearch: true },
    })
    const initial = controller.snapshot()
    expect(initial.writable).toBe(true)
    expect(initial.revision).toBe(0)
    expect(initial.secrets).toEqual([])
    expect(initial.base).toEqual({ searchResults: 6, codexSearch: true })
    expect(initial.user).toEqual({ searchResults: 2, codexFast: true })
    expect(initial.value).toEqual({
      ...DEFAULT_CAPABILITY_SETTINGS,
      codexSearch: true,
      codexFast: true,
      searchResults: 2,
    })

    const next = await controller.patch({ searchResults: 20 }, initial.revision)
    expect(next.revision).toBe(1)
    expect(next.user).toEqual({ searchResults: 20, codexFast: true })
    expect(next.value.searchResults).toBe(20)
    expect(next.value.codexSearch).toBe(true)
    expect(next.secrets).toEqual([])
  })

  it('rejects invalid writes before they can reach the settings provider', async () => {
    const settings = new FakeSettingsService()
    const controller = createCapabilitySettingsController({ settings })
    const revision = controller.snapshot().revision

    await expect(
      controller.patch({ codexSearch: 'yes' } as unknown as CapabilitySettingsPatch, revision),
    ).rejects.toThrow(/must be a boolean/)
    await expect(controller.patch({ searchResults: 2.5 }, revision)).rejects.toThrow(/must be an integer/)
    await expect(controller.patch({ searchResults: 21 }, revision)).rejects.toThrow(/must be in/)
    await expect(
      controller.replace({ unexpected: true } as unknown as CapabilitySettingsPatch, revision),
    ).rejects.toThrow(/unknown key/)
    expect(controller.snapshot()).toMatchObject({ revision, value: DEFAULT_CAPABILITY_SETTINGS })
  })

  it('treats an empty PATCH as a revision-checked no-op', async () => {
    const settings = new FakeSettingsService()
    const controller = createCapabilitySettingsController({ settings })
    const initial = controller.snapshot()
    const unchanged = await controller.patch({}, initial.revision)
    expect(unchanged).toEqual(initial)
    expect(controller.snapshot().revision).toBe(initial.revision)
    await controller.patch({ codexFast: true }, initial.revision)
    await expect(controller.patch({}, initial.revision)).rejects.toMatchObject({
      code: 'SETTINGS_CONFLICT',
      expected: initial.revision,
      actual: initial.revision + 1,
    })
  })

  it('refuses a stale PATCH and wraps a provider SETTINGS_CONFLICT', async () => {
    const settings = new FakeSettingsService()
    const controller = createCapabilitySettingsController({ settings })
    const first = controller.snapshot()
    await controller.patch({ codexFast: true }, first.revision)

    await expect(controller.patch({ codexSearch: true }, first.revision)).rejects.toSatisfy((error: unknown) => {
      expect(isCapabilitySettingsConflictError(error)).toBe(true)
      expect(error).toMatchObject({
        code: 'SETTINGS_CONFLICT',
        expected: first.revision,
        actual: first.revision + 1,
      })
      return error instanceof CapabilitySettingsConflictError
    })
    expect(controller.current().codexSearch).toBe(false)
    expect(controller.current().codexFast).toBe(true)
  })

  it('resets inherited defaults through replace({}) and keeps state secret-free', async () => {
    const settings = new FakeSettingsService()
    const controller = createCapabilitySettingsController({
      settings,
      base: { searchResults: 3 },
    })
    const enabled = await controller.patch({ codexFast: true, searchResults: 4 }, 0)
    expect(enabled.value.codexFast).toBe(true)
    const reset = await controller.replace({}, enabled.revision)
    expect(reset.user).toBeUndefined()
    expect(reset.value).toEqual({ ...DEFAULT_CAPABILITY_SETTINGS, searchResults: 3 })
    expect(reset.secrets).toEqual([])
    await expect(controller.patch({ access_token: 'nope' } as CapabilitySettingsPatch, reset.revision)).rejects.toThrow(
      /secret-free/,
    )
  })

  it('notifies listeners on write and reconcile, and the disposer stops further delivery', async () => {
    const settings = new FakeSettingsService()
    const controller = createCapabilitySettingsController({ settings })
    const seen: number[] = []
    const dispose = controller.subscribe((snapshot) => {
      seen.push(snapshot.revision)
    })

    const afterWrite = await controller.patch({ codexSearch: true }, 0)
    expect(seen).toEqual([afterWrite.revision])

    settings.publish(CAPABILITY_SETTINGS_NAMESPACE, { codexSearch: true, codexFast: true })
    const reconciled = controller.reconcile()
    expect(reconciled.value.codexFast).toBe(true)
    expect(seen).toEqual([afterWrite.revision, reconciled.revision])

    dispose()
    await controller.patch({ searchResults: 9 }, reconciled.revision)
    expect(seen).toEqual([afterWrite.revision, reconciled.revision])
  })

  it('contains asynchronous listener failures and reports them', async () => {
    const settings = new FakeSettingsService()
    const failures: unknown[] = []
    const controller = createCapabilitySettingsController({
      settings,
      onListenerError: error => failures.push(error),
    })
    const failure = new Error('async observer failed')
    controller.subscribe(async () => {
      throw failure
    })
    const next = await controller.patch({ codexSearch: true }, 0)
    expect(next.value.codexSearch).toBe(true)
    await Promise.resolve()
    expect(failures).toEqual([failure])
  })

  it('stays read-only when the injected provider is not writable', async () => {
    const settings = new FakeSettingsService(false, { grokImagineImage: true })
    const controller = createCapabilitySettingsController({
      settings,
      base: { searchResults: 4 },
    })
    const snapshot = controller.snapshot()
    expect(snapshot.writable).toBe(false)
    expect(snapshot.value.grokImagineImage).toBe(true)
    expect(snapshot.value.searchResults).toBe(4)
    await expect(controller.patch({ codexSearch: true }, snapshot.revision)).rejects.toMatchObject({
      name: 'CapabilitySettingsReadOnlyError',
      code: 'SETTINGS_READ_ONLY',
      reason: 'read-only',
    })
    expect(isCapabilitySettingsReadOnlyError(new CapabilitySettingsReadOnlyError('read-only'))).toBe(true)
  })

  it('contains a throwing scope disposer and still finishes disposal idempotently', async () => {
    const failure = new Error('watch disposer failed')
    const failures: unknown[] = []
    const scope: CapabilitySettingsScope = {
      get: () => ({}),
      watch: () => () => {
        throw failure
      },
      update: async () => undefined,
      replace: async () => undefined,
    }
    const settings: CapabilitySettingsService = {
      writable: true,
      register: () => scope,
    }
    const controller = createCapabilitySettingsController({
      settings,
      onListenerError: error => failures.push(error),
    })
    expect(() =>{  controller.dispose() }).not.toThrow()
    expect(() =>{  controller.dispose() }).not.toThrow()
    expect(failures).toEqual([failure])
    await expect(controller.patch({ codexSearch: true }, 0)).rejects.toMatchObject({
      code: 'SETTINGS_DISPOSED',
    })
  })

  it('fails writes after dispose and never leaks provider secret slots', async () => {
    const settings: CapabilitySettingsService = {
      writable: true,
      describe: () => [
        {
          ns: CAPABILITY_SETTINGS_NAMESPACE,
          value: { ...DEFAULT_CAPABILITY_SETTINGS, apiKey: 'leak' },
          revision: 4,
          secrets: [{ path: ['apiKey'], set: true }],
        },
      ],
      update: async () => undefined,
    }
    const controller = createCapabilitySettingsController({ settings })
    const snapshot = controller.snapshot()
    expect(snapshot.revision).toBe(4)
    expect(snapshot.secrets).toEqual([])
    expect(snapshot.value).toEqual(DEFAULT_CAPABILITY_SETTINGS)
    expect(snapshot.value).not.toHaveProperty('apiKey')

    controller.dispose()
    await expect(controller.patch({ codexSearch: true }, snapshot.revision)).rejects.toMatchObject({
      code: 'SETTINGS_DISPOSED',
      reason: 'disposed',
    })
  })
})
