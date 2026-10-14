/**
 * React-free snapshot store engine (zustand vanilla + immer + subscribeWithSelector +
 * rafFlush middleware + opt-in persist + dev freeze) plus the declarative
 * shell over it: {@link defineStore} bakes an init/persist/actions literal
 * into a {@link StoreHandle}, the registration-side store seat of slot
 * terminals. Engine products are bare observables — subscribe/getSnapshot/
 * update/set, NO selector hook. Hook synthesis is ui-renderer's (the one
 * uSES bridge, cached per source at the binding site).
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import { subscribeWithSelector } from 'zustand/middleware'
import { shallow } from 'zustand/shallow'
import { freeze, produce } from 'immer'
import type {
  ActionsDecl, BakedActions, ObservableSnapshot, StoreHandle, StoreInstance, StoreSpec,
} from './contract.ts'

// Store contract types are ui-slots authority; re-exported beside the engine
// so store consumers get one import path.
export type {
  ActionsDecl, BakedActions, BoundActions, DefineStore, HandleOf, MaybeSnapshotSelectorHook,
  ObservableSnapshot, PersistFields, PropsStore, SnapshotSelectorHook, StoreDecl, StoreFactory,
  StoreHandle, StoreInstance, StoreSpec,
} from './contract.ts'

export { createReadCache } from './read-cache.ts'
export type { ReadCache } from './read-cache.ts'

/** Writable snapshot store (bare data face; React selector hooks are synthesized in ui-renderer). */
export interface SnapshotStore<T> extends ObservableSnapshot<T> {
  /**
   * Mutate the state through an immer draft.
   * @param mutator - draft mutator.
   */
  update(mutator: (draft: T) => void): void
  /**
   * Replace the state wholesale.
   * @param next - next state.
   */
  set(next: T): void
}

/**
 * Notify an observer set without allowing one callback to starve the rest.
 * @param listeners - current observer callbacks; copied before dispatch.
 * @param label - diagnostic owner prefix.
 * @param args - callback arguments.
 */
export function notifySubscribers<Args extends readonly unknown[]>(
  listeners: Iterable<(...args: Args) => void>,
  label: string,
  ...args: Args
): void {
  for (const listener of [...listeners]) {
    try {
      listener(...args)
    } catch (error) {
      console.error(`${label} subscriber failed:`, error)
    }
  }
}

/**
 * Shallow equality for selector slices (zustand/shallow semantics; travels
 * with the engine so hook consumers need no zustand dependency).
 * @param a - left value.
 * @param b - right value.
 * @returns whether the values are shallowly equal.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  return shallow(a, b)
}

/** Batches subscriber notification into one flush per animation frame. */
function rafBatch(notify: () => void): () => void {
  // Fall back to microtask batching where rAF is absent (node unit tests);
  // both preserve the N-changes=1-notification contract within a tick.
  const schedule: (fn: () => void) => void =
    typeof requestAnimationFrame === 'function'
      ? (fn) => { requestAnimationFrame(() => { fn() }) }
      : (fn) => { queueMicrotask(fn) }
  let scheduled = false
  return () => {
    if (scheduled) return
    scheduled = true
    schedule(() => {
      scheduled = false
      notify()
    })
  }
}

/**
 * Create a snapshot store.
 *
 * Flush default is 'sync' (controlled inputs need same-tick echo); frame-driven
 * stores opt into 'raf', where a frame's worth of updates coalesces into one
 * notification. Known raf-mode tradeoff: a component mounting mid-frame reads
 * fresh state while existing subscribers hear it next flush — transient
 * frame-level skew, same nature as the object layer's microtask batching.
 *
 * @param init - initial state.
 * @param opts - flush mode and opt-in persistence (localStorage, keyed by
 * name; `fields` narrows it to those state fields, leaving the rest per-page).
 * @returns the store.
 */
export function createSnapshotStore<T>(
  init: T,
  opts?: { flush?: 'raf' | 'sync'; persist?: { name: string; fields?: readonly string[] } },
): SnapshotStore<T> {
  // Immer enters through produce() in update() below (identical semantics to
  // the immer middleware without its setState-signature mutator generics).
  const withSelector = subscribeWithSelector(() => init)
  const api: StoreApi<T> = createStore<T>()(withSelector)
  if (opts?.persist) attachPersistence(api, opts.persist.name, opts.persist.fields)

  let subscribe = (fn: () => void) => api.subscribe(() => {
    notifySubscribers([fn], '[client-store]')
  })
  if (opts?.flush === 'raf') {
    const listeners = new Set<() => void>()
    const flush = rafBatch(() => { notifySubscribers(listeners, '[client-store]') })
    api.subscribe(flush)
    subscribe = (fn: () => void) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    }
  }

  return {
    getSnapshot: () => api.getState(),
    subscribe: fn => subscribe(fn),
    update: (mutator) => {
      // Immer's produce (not setState's partial-merge path) so scalar and
      // array roots replace correctly; produce also freezes in dev.
      api.setState(produce(api.getState(), (draft) => { mutator(draft as T) }), true)
    },
    set: (next) => {
      api.setState(devFreeze(next), true)
    },
  }
}

/**
 * The Web Storage this runtime actually offers, or undefined where persistence
 * must stay off.
 *
 * A browser answers through `window`. A Host has no `window`, and Node defines
 * `localStorage` as an accessor that warns when Web Storage is off, so reading
 * that global to find out whether it works is itself what prints
 * `ExperimentalWarning: localStorage is not available` over the Host's own
 * startup output. Only an own data property is read there, which is what a test
 * installs through `vi.stubGlobal`; Node's accessor is never invoked.
 *
 * @returns The storage to persist through, or undefined to disable persistence.
 */
function webStorage(): Storage | undefined {
  if (typeof window !== 'undefined') return window.localStorage
  const own = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  return own === undefined || own.get !== undefined ? undefined : own.value as Storage | undefined
}

/**
 * JSON persistence to localStorage: the whole value by default, or only the
 * named `fields` when the declaration lists them. Hand-rolled instead of the
 * zustand persist middleware: its write path spreads state into an object
 * (`partialize({ ...get() })`), exploding primitive state (a persisted string
 * draft becomes {0:'h',1:'e',...}) — not fixable via merge/deserialize options
 * because the corruption happens before serialization. Storage failures
 * (quota, private mode) only disable persistence, never break the store.
 * @param api - the engine store to hydrate and follow.
 * @param name - localStorage key.
 * @param fields - durable state fields; absent persists the whole value.
 */
function attachPersistence<T>(api: StoreApi<T>, name: string, fields?: readonly string[]): void {
  // A runtime without Web Storage persists nothing: this disables silently, on
  // the same contract as a storage failure.
  const storage = webStorage()
  if (storage === undefined) return
  try {
    const raw = storage.getItem(name)
    if (raw !== null) {
      const stored: unknown = JSON.parse(raw)
      api.setState(
        devFreeze(fields === undefined ? stored as T : adoptFields(api.getState(), stored, fields)),
        true)
    }
  } catch (error) {
    console.error(`snapshot store '${name}' rehydration failed:`, error)
  }
  api.subscribe((state) => {
    try {
      storage.setItem(name, JSON.stringify(fields === undefined ? state : pickFields(state, fields)))
    } catch (error) {
      console.error(`snapshot store '${name}' persistence failed:`, error)
    }
  })
}

/**
 * Seed the initial state with the durable fields of a stored value. This is
 * the durable boundary: a field is adopted only when the revived value is
 * non-null and carries the initial value's `typeof`, so a truncated, stale, or
 * hand-edited entry loses that field rather than the store.
 * @param init - the state the store was constructed with.
 * @param stored - the revived localStorage value.
 * @param fields - the durable field names.
 * @returns the state to hydrate with.
 */
function adoptFields<T>(init: T, stored: unknown, fields: readonly string[]): T {
  if (typeof stored !== 'object' || stored === null) return init
  const source = stored as Record<string, unknown>
  const next = { ...init as unknown as Record<string, unknown> }
  for (const field of fields) {
    const value = source[field]
    if (value !== null && typeof value === typeof next[field]) next[field] = value
  }
  return next as unknown as T
}

/**
 * Project the durable fields out of a state value for writing.
 * @param state - current state.
 * @param fields - the durable field names.
 * @returns the object written to storage.
 */
function pickFields(state: unknown, fields: readonly string[]): Record<string, unknown> {
  const source = state as Record<string, unknown>
  const picked: Record<string, unknown> = {}
  for (const field of fields) picked[field] = source[field]
  return picked
}

/** Deep-freeze draftable wholesale-set state outside production: set() bypasses immer's freeze. */
function devFreeze<T>(value: T): T {
  if (process.env.NODE_ENV === 'production') return value
  return freeze(value, true)
}

// ui-slots owns the contract; this module supplies the engine implementation.

/** A live engine instance: the contract instance plus the raw engine store. */
export interface EngineStoreInstance<T, A extends ActionsDecl<T>> extends StoreInstance<T, A> {
  /** The underlying engine store (framework/test API; components never see it). */
  readonly store: SnapshotStore<T>
}

/** The engine-backed handle: create() narrowed to the engine instance. */
export interface EngineStoreHandle<T, A extends ActionsDecl<T>> extends StoreHandle<T, A> {
  /**
   * Construct a live engine instance (see the contract JSDoc on
   * {@link StoreHandle.create} for scopeKey/persist semantics).
   *
   * Known boundary: the persist key is the storage identity, so multiple live
   * instances created under the same resolved key share (and cross-pollute)
   * one localStorage entry. Instance uniqueness per key is the caller's
   * responsibility — production is safe because the framework caches one
   * instance per handle x scope key; tests wanting isolation use distinct
   * scope keys or persist-free declarations (multi-create freedom is a
   * feature there, so create() deliberately does not dedupe or throw).
   * @param scopeKey - session id for session-scope instances; omitted for root scope.
   * @returns the engine instance.
   */
  create(scopeKey?: string): EngineStoreInstance<T, A>
}

/**
 * Declare a store: initial state, optional persistence, and the full write
 * set as pure draft mutators. The returned handle is the registration
 * currency of the store seat — its identity keys instance sharing. Satisfies
 * ui-slots' DefineStore contract (the handle/instance are the engine-extended
 * subtypes).
 *
 * The `A & ActionsDecl<T>` actions position is load-bearing: T resolves from
 * `init` in the first inference round, and the intersection then contextually
 * types each mutator's draft parameter (context-sensitive functions defer),
 * so call sites write `(d, x: X) => { ... }` with no draft annotation. If a
 * future TS version breaks this single-literal inference, the design's
 * documented fallback is currying (`defineStore(init).actions({...})`).
 * @param decl - init lambda (fresh state per instance), optional persistence
 * (whole-state key, or key plus durable field list), actions table.
 * @returns the store handle.
 */
export function defineStore<T, A extends ActionsDecl<T>>(
  decl: StoreSpec<T, A> & { actions: A & ActionsDecl<T> }): EngineStoreHandle<T, A> {
  return {
    spec: decl,
    create(scopeKey?: string): EngineStoreInstance<T, A> {
      const slice: { key: string; fields?: readonly string[] } | undefined =
        typeof decl.persist === 'string' ? { key: decl.persist } : decl.persist
      const persist = slice === undefined ? undefined : {
        name: scopeKey === undefined ? slice.key : `${slice.key}.${scopeKey}`,
        ...slice.fields === undefined ? {} : { fields: slice.fields },
      }
      const persistKey = persist?.name
      const store = createSnapshotStore<T>(
        decl.init(), persist === undefined ? undefined : { persist })
      const actions = {} as Record<string, (...params: unknown[]) => void>
      for (const key of Object.keys(decl.actions)) {
        const mutate = decl.actions[key] as (draft: T, ...params: unknown[]) => void
        actions[key] = (...params: unknown[]) => { store.update((draft) => { mutate(draft, ...params) }) }
      }
      return {
        actions: actions as BakedActions<T, A>,
        getSnapshot: () => store.getSnapshot(),
        subscribe: fn => store.subscribe(fn),
        store,
        clearPersisted: () => {
          const clearStorage = webStorage()
          if (persistKey === undefined || clearStorage === undefined) return
          try {
            clearStorage.removeItem(persistKey)
          } catch {
            // Storage failures (private mode, quota teardown races) only skip
            // cleanup — the same non-fatal contract as attachPersistence.
          }
        },
      }
    },
  }
}

export { PendingResult, awaitPendingResult } from './pending-result.ts'
