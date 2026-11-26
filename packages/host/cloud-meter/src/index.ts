/**
 * Meters an account's Aeven Cloud work on a hosted Host and reports it to the Aeven API, which prices it from its
 * `cloud` configuration and charges it to the account's credit, plan allowance first.
 *
 * Three kinds of work are metered, each under the session owner whose Aeven credential pays for it:
 *
 * - **sandbox**: CPU seconds of the account's confined commands, from `sandbox-jail/usage`.
 * - **storage**: the bytes of the account's folder under `accountsRoot`, measured once a day. Directories the Host
 *   cannot read, such as the private temporary folders a confined command creates, are left out of the figure.
 * - **turn**: each turn on a provider outside `billedProviders`, whose inference the Aeven API never sees.
 *
 * Reports are queued per owner and sent every `flushIntervalMs`; each keeps the id it was queued with, so a report
 * resent after a failed request is charged once. An owner the API reports as unfunded starts no confined command
 * (`sandbox-jail/admit`) and no turn on an unbilled provider until a later quote says otherwise.
 *
 * Each request presents the owner's credentials in `credentialRefs` order and moves to the next one when the API answers
 * 401, so a stored refresh token keeps reports flowing after the browser's two-hour access token has expired.
 *
 * @module @aeven/cloud-meter
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@aeven/credentials'
import { PROVIDER as AEVEN_PROVIDER } from '@aeven/llm-aeven'
import type {} from '@aeven/agent'
import type {} from '@aeven/sandbox-jail'

export const name = 'cloud-meter'
export const inject = ['credentials']

/** Where reports go, how often, and which turns are already billed through inference. */
export interface Config {
  /** Aeven API origin, e.g. `https://aeven.io`. */
  apiUrl: string
  /**
   * Credentials holding each owner's Aeven session, presented in order until the API accepts one; defaults to
   * `['AEVEN_TOKEN']`. A deployment that stores each account's refresh token names it here as well, so reports and quotes
   * keep working while no browser of the account renews its access token.
   */
  credentialRefs?: string[]
  /** Milliseconds between sends of the queued reports. */
  flushIntervalMs?: number
  /** Milliseconds a quote of an owner's funding stays fresh. */
  quoteTtlMs?: number
  /** Directory whose direct children are account folders named by owner; omitted, storage is not metered. */
  accountsRoot?: string
  /** Milliseconds between storage measurements of every account folder. */
  storageIntervalMs?: number
  /**
   * Providers whose turns the Aeven API already bills as inference; a turn on any other provider is metered. Defaults to
   * the provider `@aeven/llm-aeven` registers, read from its own constant so a rename there cannot bill Aeven turns.
   */
  billedProviders?: string[]
  /** Most reports kept per owner while the API is unreachable; older reports are dropped first. */
  maxQueuedPerOwner?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  apiUrl: z.string().required(),
  credentialRefs: z.array(z.string()).min(1).default(['AEVEN_TOKEN']),
  flushIntervalMs: z.natural().min(1000).default(60_000),
  quoteTtlMs: z.natural().min(1000).default(60_000),
  accountsRoot: z.string(),
  storageIntervalMs: z.natural().min(60_000).default(86_400_000),
  billedProviders: z.array(z.string()).default([AEVEN_PROVIDER]),
  maxQueuedPerOwner: z.natural().min(1).default(10_000),
})

/** One metered report, as the Aeven API's `POST /api/cloud/meter/charges` accepts it. */
type Charge =
  | { id: string; kind: 'sandbox' | 'turn'; quantity: number }
  | { id: string; kind: 'storage'; day: string; quantity: number }

/** An owner folder name, as `working-directory` creates them. */
const OWNER_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/u

/** Most reports the API accepts in one request. */
const BATCH_LIMIT = 100

/** Milliseconds one API request may take. */
const REQUEST_TIMEOUT_MS = 10_000

/** Milliseconds after start before the first storage measurement, so it does not compete with Host startup. */
const FIRST_STORAGE_DELAY_MS = 60_000

/** What a refused owner reads, as the confined command's or the turn's failure. */
const UNFUNDED_MESSAGE = 'This account\'s Aeven credit is used up, so Aeven Cloud cannot run this. Add credit or upgrade the plan in Settings, Account, to continue.'

const run = promisify(execFile)

/**
 * Measure one folder with `du -sk`.
 *
 * `du` exits 1 when it cannot read a directory below the folder, yet still prints the total of everything it could
 * read. That total is taken: a confined command creates private directories (mode 0700, such as `mkdtemp` folders and
 * office-suite caches) that the Host user cannot enter, and refusing the whole measurement for them bills no storage at all.
 * @param folder - the folder to measure.
 * @returns the KiB `du` reports.
 * @throws when `du` cannot run or prints no total.
 */
async function folderKiB(folder: string): Promise<number> {
  let stdout: string
  try {
    ({ stdout } = await run('du', ['-sk', folder], { timeout: 300_000 }))
  } catch (error) {
    const partial = (error as { code?: unknown; stdout?: unknown }).code === 1 ? (error as { stdout?: unknown }).stdout : undefined
    if (typeof partial !== 'string' || partial.length === 0) throw error
    stdout = partial
  }
  const kib = Number(stdout.split('\t')[0])
  if (!Number.isFinite(kib)) throw new Error(`du printed no total for ${folder}`)
  return kib
}

/**
 * The text of a caught failure.
 * @param error - what was thrown.
 * @returns its message, or its string form when it is not an `Error`.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Meter cloud work and gate new work on the owner's funding.
 * @param ctx - the plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('cloud-meter')
  const apiUrl = config.apiUrl.replace(/\/+$/u, '')
  const refs = (config.credentialRefs as string[]).map(ref => credentialRef(ref))
  const billed = new Set(config.billedProviders)
  const maxQueued = config.maxQueuedPerOwner as number
  /** Sandbox seconds per owner since the last send, not yet given an id. */
  const sandboxSeconds = new Map<string, number>()
  /** Reports per owner awaiting a successful send, each with its final id. */
  const queued = new Map<string, Charge[]>()
  /** The latest funding answer per owner. */
  const quotes = new Map<string, { funded: boolean; at: number }>()
  const quoting = new Map<string, Promise<boolean>>()
  let flushing: Promise<void> | undefined

  const enqueue = (owner: string, charge: Charge) => {
    const list = queued.get(owner) ?? []
    list.push(charge)
    if (list.length > maxQueued) {
      list.splice(0, list.length - maxQueued)
      logger.warn(`dropped the oldest cloud usage reports of ${owner}: more than ${maxQueued} are waiting`)
    }
    queued.set(owner, list)
  }

  // Read once while the plugin is active: the final send runs from the disposer, when `ctx.credentials` throws.
  const credentials = ctx.credentials
  /** The owner's distinct credential values, in `credentialRefs` order. */
  const tokens = async (owner: string): Promise<string[]> => {
    const values: string[] = []
    for (const ref of refs) {
      let value: string | undefined
      try {
        value = (await credentials.resolve(ref, owner))?.value
      } catch {
        // A locked or already stopped credential store: the owner's reports wait for a send that can read a token.
        return values
      }
      if (value !== undefined && !values.includes(value)) values.push(value)
    }
    return values
  }

  /**
   * Make one API request with each of the owner's credentials in turn until the API stops answering 401.
   * @param bearers - the owner's credential values, from {@link tokens}; at least one.
   * @param path - the API path to request.
   * @param init - the method, body, and headers, without the authorization header.
   * @returns the first response that is not 401, or the last 401.
   */
  const callApi = async (bearers: string[], path: string, init: Pick<RequestInit, 'method' | 'body'> & { headers?: Record<string, string> }): Promise<Response> => {
    let response: Response | undefined
    for (const bearer of bearers) {
      response = await fetch(`${apiUrl}${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${bearer}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (response.status !== 401) return response
    }
    // `tokens` returned at least one value, so the loop ran.
    return response as Response
  }

  /** Ask the API whether an owner may start cloud work; an unreachable API admits it. */
  const quote = (owner: string): Promise<boolean> => {
    const cached = quotes.get(owner)
    if (cached !== undefined && Date.now() - cached.at < (config.quoteTtlMs as number)) return Promise.resolve(cached.funded)
    const pending = quoting.get(owner)
    if (pending !== undefined) return pending
    const request = (async () => {
      const bearers = await tokens(owner)
      if (bearers.length === 0) return true
      try {
        const response = await callApi(bearers, '/api/cloud/meter', {})
        if (!response.ok) return cached?.funded ?? true
        const body = await response.json() as { funded?: unknown }
        const funded = body.funded !== false
        quotes.set(owner, { funded, at: Date.now() })
        return funded
      } catch (error) {
        logger.warn(`cannot quote cloud funding for ${owner}: ${messageOf(error)}`)
        return cached?.funded ?? true
      } finally {
        quoting.delete(owner)
      }
    })()
    quoting.set(owner, request)
    return request
  }

  /** Send one owner's queued reports, keeping them when the API does not answer. */
  const send = async (owner: string, list: Charge[]) => {
    const bearers = await tokens(owner)
    if (bearers.length === 0) return
    while (list.length > 0) {
      const batch = list.slice(0, BATCH_LIMIT)
      let response: Response
      try {
        response = await callApi(bearers, '/api/cloud/meter/charges', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ charges: batch }),
        })
      } catch (error) {
        logger.warn(`cannot report cloud usage of ${owner}: ${messageOf(error)}`)
        return
      }
      if (response.status === 400) {
        // The API refused the batch itself, so resending it cannot succeed.
        logger.error(`the Aeven API refused cloud usage reports of ${owner}: ${await response.text()}`)
        list.splice(0, batch.length)
        continue
      }
      if (!response.ok) {
        logger.warn(`cloud usage reports of ${owner} wait: the Aeven API answered ${response.status}`)
        return
      }
      const body = await response.json() as { funded?: unknown }
      quotes.set(owner, { funded: body.funded !== false, at: Date.now() })
      list.splice(0, batch.length)
    }
    // Reports queued while this send ran were pushed onto `list` and sent by the loop above.
    queued.delete(owner)
  }

  const flush = (): Promise<void> => {
    flushing ??= (async () => {
      for (const [owner, seconds] of sandboxSeconds) enqueue(owner, { id: `sandbox:${randomUUID()}`, kind: 'sandbox', quantity: seconds })
      sandboxSeconds.clear()
      for (const [owner, list] of [...queued]) {
        try {
          await send(owner, list)
        } catch (error) {
          // A send that throws must not reject the flush: the disposer's flush has no caller to receive it.
          logger.warn(`cannot report cloud usage of ${owner}: ${messageOf(error)}`)
        }
      }
    })().finally(() => { flushing = undefined })
    return flushing
  }

  /** Measure every account folder once and queue its day's storage report. */
  const measureStorage = async (root: string) => {
    const day = new Date().toISOString().slice(0, 10)
    let owners: string[]
    try {
      owners = readdirSync(root).filter(entry => OWNER_SEGMENT.test(entry))
    } catch (error) {
      logger.warn(`cannot list account folders in ${root}: ${messageOf(error)}`)
      return
    }
    for (const owner of owners) {
      try {
        // POSIX `-k`: the disk space the folder takes, in KiB.
        const bytes = await folderKiB(join(root, owner)) * 1024
        // One report per day: the API bills the first it receives, so a later measurement adds nothing.
        if (!(bytes > 0) || queued.get(owner)?.some(charge => charge.id === `storage:${day}`) === true) continue
        enqueue(owner, { id: `storage:${day}`, kind: 'storage', day, quantity: bytes })
      } catch (error) {
        logger.warn(`cannot measure the folder of ${owner}: ${messageOf(error)}`)
      }
    }
  }

  ctx.on('sandbox-jail/usage', ({ account, cpuSeconds }) => {
    sandboxSeconds.set(account, (sandboxSeconds.get(account) ?? 0) + cpuSeconds)
  })

  ctx.on('sandbox-jail/admit', (account) => {
    // Confinement is synchronous, so this answers from the last quote and refreshes a stale one for the next command.
    void quote(account)
    return quotes.get(account)?.funded === false ? UNFUNDED_MESSAGE : undefined
  })

  ctx.on('agent/request', async ({ agent, turn, step }, next) => {
    const config = await next()
    const owner = agent.session.header.owner
    // Once per turn, on its first request, and only for an owned session on a provider the API does not bill.
    if (step !== 1 || owner === undefined || billed.has(config.provider)) return config
    if (!await quote(owner)) throw new Error(UNFUNDED_MESSAGE)
    enqueue(owner, { id: `turn:${agent.session.id}:${turn}`, kind: 'turn', quantity: 1 })
    return config
  })

  ctx.effect(() => {
    const timer = setInterval(() => { void flush() }, config.flushIntervalMs as number)
    return () => {
      clearInterval(timer)
      void flush()
    }
  }, 'cloud-meter reports')

  const accountsRoot = config.accountsRoot
  if (accountsRoot !== undefined) {
    ctx.effect(() => {
      let interval: ReturnType<typeof setInterval> | undefined
      const first = setTimeout(() => {
        void measureStorage(accountsRoot)
        interval = setInterval(() => { void measureStorage(accountsRoot) }, config.storageIntervalMs as number)
      }, FIRST_STORAGE_DELAY_MS)
      return () => {
        clearTimeout(first)
        if (interval !== undefined) clearInterval(interval)
      }
    }, 'cloud-meter storage measurements')
  }
}
