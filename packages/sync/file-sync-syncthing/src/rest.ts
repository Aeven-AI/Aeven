/** Typed client for the Syncthing REST API on its loopback address, authenticated by the API key the provider sets. */

import { z } from 'zod'

const statusSchema = z.object({ myID: z.string().min(1) })

/** Folder summary fields of `/rest/db/status` and of the `FolderSummary` event's `summary`. */
export const folderSummarySchema = z.object({
  state: z.string(),
  globalBytes: z.number(),
  globalFiles: z.number(),
  needBytes: z.number(),
  needFiles: z.number(),
  error: z.string().optional(),
})

/** One folder summary as Syncthing reports it. */
export type FolderSummary = z.infer<typeof folderSummarySchema>

const eventSchema = z.object({
  id: z.number(),
  type: z.string(),
  data: z.unknown(),
})

/** One entry of `/rest/events`. */
export type SyncthingEvent = z.infer<typeof eventSchema>

const eventsSchema = z.array(eventSchema)

const folderConfigSchema = z.object({ id: z.string(), label: z.string() })
const deviceConfigSchema = z.object({ deviceID: z.string(), name: z.string() })

/** A configured folder as `/rest/config/folders` lists it, reduced to the fields the provider reads. */
export type FolderConfig = z.infer<typeof folderConfigSchema>

/** A configured device as `/rest/config/devices` lists it, reduced to the fields the provider reads. */
export type DeviceConfig = z.infer<typeof deviceConfigSchema>

/** Failure of one REST request: the endpoint answered with a non-success status or the request failed. */
export class SyncthingRequestError extends Error {
  /**
   * @param message - what failed, naming the method and path.
   * @param status - the HTTP status, absent when no response arrived.
   */
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'SyncthingRequestError'
  }
}

/** REST client bound to one running Syncthing process. */
export class SyncthingRest {
  /**
   * @param base - `http://127.0.0.1:<port>` of the process's GUI listener.
   * @param apiKey - the key the process was started with.
   * @param timeoutMs - longest one request may take; a long poll adds its own wait to it.
   */
  constructor(private readonly base: string, private readonly apiKey: string, private readonly timeoutMs: number) {}

  /**
   * Send one request and parse its JSON answer.
   * @param method - HTTP method.
   * @param path - path and query under the base.
   * @param body - JSON body, when the request carries one.
   * @param waitMs - extra time a long poll may hold the request open.
   * @returns the parsed answer, or undefined for an empty one.
   */
  async request(method: string, path: string, body?: unknown, waitMs = 0): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(`${this.base}${path}`, {
        method,
        headers: { 'X-API-Key': this.apiKey, ...body === undefined ? {} : { 'content-type': 'application/json' } },
        ...body === undefined ? {} : { body: JSON.stringify(body) },
        signal: AbortSignal.timeout(this.timeoutMs + waitMs),
      })
    } catch (error) {
      throw new SyncthingRequestError(`syncthing: ${method} ${path} failed: ${String(error)}`)
    }
    const text = await response.text()
    if (!response.ok) throw new SyncthingRequestError(`syncthing: ${method} ${path} returned ${String(response.status)}: ${text}`, response.status)
    return text === '' ? undefined : JSON.parse(text) as unknown
  }

  /**
   * Whether the process answers its health endpoint.
   * @returns true once it does.
   */
  async healthy(): Promise<boolean> {
    try {
      await this.request('GET', '/rest/noauth/health')
      return true
    } catch (error) {
      if (error instanceof SyncthingRequestError) return false
      throw error
    }
  }

  /**
   * This process's device id.
   * @returns the id.
   */
  async deviceId(): Promise<string> {
    return statusSchema.parse(await this.request('GET', '/rest/system/status')).myID
  }

  /**
   * List configured folders.
   * @returns their ids and labels.
   */
  async folders(): Promise<FolderConfig[]> {
    return z.array(folderConfigSchema).parse(await this.request('GET', '/rest/config/folders'))
  }

  /**
   * List configured devices.
   * @returns their ids and names.
   */
  async devices(): Promise<DeviceConfig[]> {
    return z.array(deviceConfigSchema).parse(await this.request('GET', '/rest/config/devices'))
  }

  /**
   * Read one folder's summary.
   * @param folder - the folder id.
   * @returns its summary.
   */
  async folderStatus(folder: string): Promise<FolderSummary> {
    return folderSummarySchema.parse(await this.request('GET', `/rest/db/status?folder=${encodeURIComponent(folder)}`))
  }

  /**
   * Wait for events after a known id.
   * @param since - the last event id already handled.
   * @param types - event types to receive.
   * @param waitS - longest the request waits for an event, in seconds.
   * @returns the events, possibly none.
   */
  async events(since: number, types: readonly string[], waitS: number): Promise<SyncthingEvent[]> {
    const query = `since=${String(since)}&timeout=${String(waitS)}&events=${types.join(',')}`
    return eventsSchema.parse(await this.request('GET', `/rest/events?${query}`, undefined, waitS * 1_000))
  }
}
