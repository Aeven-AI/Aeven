import { describe, expect, it, vi } from 'vitest'
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
  type CapabilitySettingsSnapshot,
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

describe('capability settings serviceability guard', () => {
  /** Reach the validator the controller hands to `settings.register()`. */
  function captureValidator(): (value: CapabilitySettings) => void {
    const captured: Array<(value: CapabilitySettings) => void> = []
    const settings: CapabilitySettingsService = {
      register: (_ns, _schema, options) => {
        if (options?.validate !== undefined) captured.push(options.validate)
        return {
          get: () => undefined,
          watch: () => () => undefined,
          update: async () => undefined,
          replace: async () => undefined,
        }
      },
    }
    createCapabilitySettingsController({ settings })
    expect(captured).toHaveLength(1)
    const [validate] = captured
    if (validate === undefined) throw new Error('the controller did not hand a validator to register()')
    return validate
  }

  it('rejects a resolved section whose flags could not be acted on', () => {
    const validate = captureValidator()
    expect(() => {
      validate({ ...DEFAULT_CAPABILITY_SETTINGS, codexSearch: 'yes' } as unknown as CapabilitySettings)
    }).toThrow('capability settings: codexSearch must be a boolean')
    expect(() => {
      validate({ ...DEFAULT_CAPABILITY_SETTINGS, codexFast: 1 } as unknown as CapabilitySettings)
    }).toThrow('capability settings: codexFast must be a boolean')
    expect(() => {
      validate({ ...DEFAULT_CAPABILITY_SETTINGS })
    }).not.toThrow()
  })

  it('rejects a resolved section whose limit is not an in-range integer', () => {
    const validate = captureValidator()
    for (const searchResults of [Number.NaN, 1.5, 0, 21]) {
      expect(() => {
        validate({ ...DEFAULT_CAPABILITY_SETTINGS, searchResults })
      }).toThrow('capability settings: searchResults must be an integer in [1, 20]')
    }
    expect(() => {
      validate({ ...DEFAULT_CAPABILITY_SETTINGS, searchResults: 20 })
    }).not.toThrow()
  })
})

describe('capability settings write surface', () => {
  it('routes writes through the registered scope when the provider exposes no namespaced method', async () => {
    const written: Array<{ mode: 'update' | 'replace'; patch: object }> = []
    let stored: Record<string, unknown> = {}
    const scope: CapabilitySettingsScope = {
      get: () => ({ ...DEFAULT_CAPABILITY_SETTINGS, ...stored }),
      watch: () => () => undefined,
      update: async (patch) => {
        written.push({ mode: 'update', patch })
        stored = { ...stored, ...(patch as Record<string, unknown>) }
      },
      replace: async (section) => {
        written.push({ mode: 'replace', patch: section })
        stored = { ...(section as Record<string, unknown>) }
      },
    }
    const controller = createCapabilitySettingsController({ settings: { register: () => scope } })
    const initial = controller.snapshot()
    expect(initial.writable).toBe(true)
    expect(initial.value).toEqual(DEFAULT_CAPABILITY_SETTINGS)

    const patched = await controller.patch({ codexSearch: true }, initial.revision)
    expect(written).toEqual([{ mode: 'update', patch: { codexSearch: true } }])
    expect(patched.value.codexSearch).toBe(true)
    expect(patched.revision).toBe(initial.revision + 1)

    const replaced = await controller.replace({ codexFast: true }, patched.revision)
    expect(written[1]).toEqual({ mode: 'replace', patch: { codexFast: true } })
    expect(replaced.value).toEqual({ ...DEFAULT_CAPABILITY_SETTINGS, codexFast: true })
  })

  it('reports read-only for the write mode a provider does not offer', async () => {
    const replace = vi.fn(async () => undefined)
    const controller = createCapabilitySettingsController({ settings: { writable: true, replace } })
    const initial = controller.snapshot()
    expect(initial.writable).toBe(true)

    await expect(controller.patch({ codexSearch: true }, initial.revision)).rejects.toMatchObject({
      name: 'CapabilitySettingsReadOnlyError',
      code: 'SETTINGS_READ_ONLY',
      reason: 'read-only',
    })
    expect(replace).not.toHaveBeenCalled()

    const replaced = await controller.replace({ codexFast: true }, initial.revision)
    expect(replace).toHaveBeenCalledWith(CAPABILITY_SETTINGS_NAMESPACE, { codexFast: true }, initial.revision)
    expect(replaced.revision).toBe(initial.revision + 1)
  })

  it('reports read-only when the provider exposes no write surface at all', async () => {
    const controller = createCapabilitySettingsController({ settings: { get: () => DEFAULT_CAPABILITY_SETTINGS } })
    const initial = controller.snapshot()
    expect(initial.writable).toBe(false)
    await expect(controller.patch({ codexSearch: true }, initial.revision)).rejects.toMatchObject({
      code: 'SETTINGS_READ_ONLY',
      reason: 'read-only',
    })
  })

  it('reports an absent provider rather than a read-only one', async () => {
    const controller = createCapabilitySettingsController()
    const initial = controller.snapshot()
    expect(initial.writable).toBe(false)
    expect(initial.value).toEqual(DEFAULT_CAPABILITY_SETTINGS)
    await expect(controller.replace({ codexSearch: true }, initial.revision)).rejects.toMatchObject({
      name: 'CapabilitySettingsReadOnlyError',
      code: 'SETTINGS_PROVIDER_ABSENT',
      reason: 'absent',
      ns: CAPABILITY_SETTINGS_NAMESPACE,
      message: expect.stringContaining('settings provider is absent') as string,
    })
  })
})

describe('capability settings conflict translation', () => {
  async function rejectionFromWriter(thrown: unknown): Promise<unknown> {
    const settings: CapabilitySettingsService = {
      writable: true,
      update: async () => {
        throw thrown
      },
    }
    const controller = createCapabilitySettingsController({ settings })
    try {
      await controller.patch({ codexSearch: true }, 0)
    } catch (error: unknown) {
      return error
    }
    throw new Error('the write was expected to fail')
  }

  it('rethrows a provider failure it cannot translate into a conflict', async () => {
    const native = new CapabilitySettingsConflictError(3, 4)
    expect(await rejectionFromWriter(native)).toBe(native)
    expect(await rejectionFromWriter('provider offline')).toBe('provider offline')
    expect(await rejectionFromWriter(null)).toBeNull()

    const opaque = new Error('provider offline')
    expect(await rejectionFromWriter(opaque)).toBe(opaque)

    const codeOnly = { code: 'SETTINGS_CONFLICT' }
    expect(await rejectionFromWriter(codeOnly)).toBe(codeOnly)

    const halfRevisions = { code: 'SETTINGS_CONFLICT', expected: 1 }
    expect(await rejectionFromWriter(halfRevisions)).toBe(halfRevisions)
  })

  it('translates a foreign SETTINGS_CONFLICT-shaped rejection into its own error', async () => {
    const translated = await rejectionFromWriter({ code: 'SETTINGS_CONFLICT', expected: 2, actual: 5 })
    expect(isCapabilitySettingsConflictError(translated)).toBe(true)
    expect(translated).toMatchObject({ ns: CAPABILITY_SETTINGS_NAMESPACE, expected: 2, actual: 5 })
  })
})

describe('capability settings provider describe pitfalls', () => {
  it('ignores a describe() result that is not a list of descriptors', () => {
    const controller = createCapabilitySettingsController({
      settings: { describe: () => 'not-a-list' as unknown as readonly CapabilitySettingsDescriptor[] },
      base: { searchResults: 3 },
    })
    expect(controller.snapshot()).toMatchObject({
      revision: 0,
      base: { searchResults: 3 },
      value: { searchResults: 3 },
    })
  })

  it('ignores a describe() call that throws', () => {
    const controller = createCapabilitySettingsController({
      settings: {
        describe: () => {
          throw new Error('settings churn')
        },
      },
      base: { codexSearch: true },
    })
    expect(controller.snapshot()).toMatchObject({ revision: 0, value: { codexSearch: true } })
  })

  it('re-publishes when only the composition base layer changed shape', () => {
    let base: CapabilitySettingsPatch = { codexSearch: true }
    const settings: CapabilitySettingsService = {
      describe: () => [
        {
          ns: CAPABILITY_SETTINGS_NAMESPACE,
          value: { ...DEFAULT_CAPABILITY_SETTINGS, codexSearch: true },
          base,
          revision: 0,
        },
      ],
    }
    const controller = createCapabilitySettingsController({ settings })
    const seen: number[] = []
    controller.subscribe((snapshot) => {
      seen.push(snapshot.revision)
    })

    base = { codexSearch: true, codexFast: true }
    const reconciled = controller.reconcile()
    expect(reconciled.base).toEqual({ codexSearch: true, codexFast: true })
    expect(seen).toHaveLength(1)
  })

  it('re-publishes when the composition base layer disappears', () => {
    let base: CapabilitySettingsPatch | undefined = { codexSearch: true }
    const settings: CapabilitySettingsService = {
      describe: () => [
        {
          ns: CAPABILITY_SETTINGS_NAMESPACE,
          value: { ...DEFAULT_CAPABILITY_SETTINGS, codexSearch: true },
          ...(base === undefined ? {} : { base }),
          revision: 0,
        },
      ],
    }
    const controller = createCapabilitySettingsController({ settings })
    expect(controller.snapshot().base).toEqual({ codexSearch: true })
    const seen: CapabilitySettingsSnapshot[] = []
    controller.subscribe((snapshot) => {
      seen.push(snapshot)
    })

    base = undefined
    const reconciled = controller.reconcile()
    expect(reconciled.base).toBeUndefined()
    expect(seen).toHaveLength(1)
  })
})

describe('capability settings dispose', () => {
  it('ignores a subscription made after dispose', () => {
    const settings = new FakeSettingsService()
    const controller = createCapabilitySettingsController({ settings })
    controller.dispose()

    const revisions: number[] = []
    const unsubscribe = controller.subscribe((snapshot) => {
      revisions.push(snapshot.revision)
    })
    settings.publish(CAPABILITY_SETTINGS_NAMESPACE, { codexSearch: true })
    expect(controller.reconcile().value.codexSearch).toBe(true)
    expect(revisions).toEqual([])
    expect(() => {
      unsubscribe()
    }).not.toThrow()
  })

  it('stops re-reading the provider from a retained scope watcher once disposed', () => {
    let notifyWatcher: (() => void) | undefined
    const describe = vi.fn((): readonly CapabilitySettingsDescriptor[] => [])
    const settings: CapabilitySettingsService = {
      register: () => ({
        get: () => undefined,
        watch: (callback) => {
          notifyWatcher = (): void => {
            void callback(undefined, undefined)
          }
          return () => undefined
        },
        update: async () => undefined,
        replace: async () => undefined,
      }),
      describe,
    }

    const live = createCapabilitySettingsController({ settings })
    expect(describe).toHaveBeenCalledTimes(1)
    notifyWatcher?.()
    expect(describe).toHaveBeenCalledTimes(2)

    const disposed = createCapabilitySettingsController({ settings })
    expect(describe).toHaveBeenCalledTimes(3)
    disposed.dispose()
    notifyWatcher?.()
    expect(describe).toHaveBeenCalledTimes(3)
    expect(live.snapshot().value).toEqual(DEFAULT_CAPABILITY_SETTINGS)
  })

  it('survives a scope that notifies synchronously while it is being registered', () => {
    const settings: CapabilitySettingsService = {
      register: () => ({
        get: () => undefined,
        watch: (callback) => {
          void callback(undefined, undefined)
          return () => undefined
        },
        update: async () => undefined,
        replace: async () => undefined,
      }),
    }
    const controller = createCapabilitySettingsController({ settings, base: { codexSearch: true } })
    expect(controller.snapshot()).toMatchObject({ revision: 0, base: { codexSearch: true } })
    expect(controller.current().codexSearch).toBe(true)
  })

  it('contains a synchronous listener failure when no error sink is configured', async () => {
    const settings = new FakeSettingsService()
    const controller = createCapabilitySettingsController({ settings })
    const survivor = vi.fn()
    controller.subscribe(() => {
      throw new Error('sync observer failed')
    })
    controller.subscribe(survivor)

    const next = await controller.patch({ codexSearch: true }, 0)
    expect(next.value.codexSearch).toBe(true)
    expect(survivor).toHaveBeenCalledWith(next)
  })
})

describe('capability settings layer admission', () => {
  it('admits a prototype-less object as a plain settings layer', () => {
    const layer = Object.assign(Object.create(null) as Record<string, unknown>, {
      codexSearch: true,
      searchResults: 3,
    })
    expect(resolveCapabilitySettings(layer)).toMatchObject({ codexSearch: true, searchResults: 3 })
  })

  it('refuses a non-object patch before inspecting its keys', () => {
    expect(() => {
      assertCapabilitySettingsPatch(null)
    }).toThrow('capability settings must be a plain object')
    expect(() => {
      assertCapabilitySettingsPatch([])
    }).toThrow('capability settings must be a plain object')
  })
})
