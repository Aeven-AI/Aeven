/**
 * Shared HTTP plumbing for vendor media providers.
 *
 * Every vendor adapter resolves one credential, calls one pinned origin for
 * JSON, retrieves clip bytes under a ceiling, and maps a job body onto the
 * seam's status union. Those four are the same operation at each vendor and
 * differ only in the origin, the paths, the name in failure text, and the
 * status vocabulary — so they live here once and each adapter keeps only what
 * its route actually shapes differently.
 * @module @aeven/media/vendor-route
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@aeven/credentials'
import type {} from '@aeven/credentials'
import { MediaError } from './types.ts'
import type {
  GeneratedMedia, MediaVideoJob, MediaVideoProvider, MediaVideoRequest, MediaVideoStatus,
} from './types.ts'

/** What one vendor's route needs beyond the shared behavior. */
export interface VendorRouteConfig {
  /** Registry key under `ctx.media`, named in credential failures. */
  readonly id: string
  /** Credential reference resolved through `ctx.credentials`. */
  readonly apiKeyEnv: string
  /** The one origin this provider contacts. */
  readonly origin: string
  /** Vendor name as it reads in failure text. */
  readonly vendor: string
}

/** One job body as a vendor returns it; unknown fields are ignored. */
export interface VendorJobBody {
  id?: unknown
  status?: unknown
  error?: unknown
}

/**
 * The shared operations a vendor adapter builds its provider on.
 *
 * Declared as properties rather than methods: adapters hand these straight to
 * a provider field, and a detached method would carry no receiver.
 */
export interface VendorRoute {
  /** Whether a credential could be resolved at all. */
  readonly available: () => boolean
  /** Resolve the bearer token, failing loud when the deployment configured none. */
  readonly apiKey: () => Promise<string>
  /**
   * One JSON call against the pinned origin.
   * @param path - route path, resolved against the origin.
   * @param init - method, headers, and body for this call.
   * @param signal - cancellation forwarded to fetch.
   * @returns the decoded JSON body.
   */
  readonly json: (
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
  ) => Promise<Record<string, unknown>>
  /**
   * Retrieve bytes from the pinned origin under a size ceiling.
   * @param path - route path serving the bytes.
   * @param maxBytes - ceiling on the retrieved payload.
   * @param fallbackMediaType - media type to report when the response states none.
   * @param signal - cancellation forwarded to fetch.
   * @returns the retrieved bytes and their media type.
   */
  readonly bytes: (
    path: string,
    maxBytes: number,
    fallbackMediaType: string,
    signal?: AbortSignal,
  ) => Promise<GeneratedMedia>
}

/**
 * Request headers for one JSON call. `HeadersInit` may be an array or a
 * `Headers`, so it is normalized rather than spread.
 * @param base - the caller's own headers, if any.
 * @param apiKey - the resolved bearer token.
 * @returns the merged header record.
 */
function jsonHeaders(base: HeadersInit | undefined, apiKey: string): Record<string, string> {
  const headers = new Headers(base)
  headers.set('Authorization', `Bearer ${apiKey}`)
  headers.set('Accept', 'application/json')
  return Object.fromEntries(headers.entries())
}

/**
 * Build the shared route operations for one vendor adapter.
 * @param ctx - context carrying the media seam and, optionally, credentials.
 * @param config - the vendor's identity, credential, origin, and display name.
 * @returns the operations that adapter's provider methods call.
 */
export function vendorRoute(ctx: Context, config: VendorRouteConfig): VendorRoute {
  const { id, apiKeyEnv, origin, vendor } = config

  const apiKey = async (): Promise<string> => {
    const resolved = await ctx.get('credentials')?.resolve(credentialRef(apiKeyEnv))
    const value = resolved?.value ?? process.env[apiKeyEnv]
    if (value === undefined || value === '') {
      throw new MediaError(
        `no credential resolved from ${apiKeyEnv} for media provider "${id}"`,
        'MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE',
      )
    }
    return value
  }

  return {
    available: () => process.env[apiKeyEnv] !== undefined || ctx.get('credentials') !== undefined,
    apiKey,

    json: async (path, init, signal) => {
      const response = await fetch(new URL(path, origin), {
        ...init,
        headers: jsonHeaders(init.headers, await apiKey()),
        redirect: 'error',
        ...signal === undefined ? {} : { signal },
      })
      const text = await response.text()
      if (!response.ok) {
        throw new MediaError(
          `${vendor} request failed with HTTP ${String(response.status)}${text === '' ? '' : `: ${text}`}`,
          'MEDIA_UPSTREAM',
        )
      }
      try {
        return JSON.parse(text) as Record<string, unknown>
      } catch (cause) {
        throw new MediaError(`${vendor} returned a non-JSON body`, 'MEDIA_UPSTREAM', { cause })
      }
    },

    bytes: async (path, maxBytes, fallbackMediaType, signal) => {
      const response = await fetch(new URL(path, origin), {
        headers: { Authorization: `Bearer ${await apiKey()}` },
        redirect: 'error',
        ...signal === undefined ? {} : { signal },
      })
      if (!response.ok) {
        throw new MediaError(
          `${vendor} video content failed with HTTP ${String(response.status)}`,
          'MEDIA_UPSTREAM',
        )
      }
      // The declared length is checked before the body is read so an oversized
      // clip is refused without buffering it; the read is checked too, because
      // a response may declare no length at all.
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new MediaError(`video exceeds the ${String(maxBytes)} byte ceiling`, 'MEDIA_UPSTREAM')
      }
      const data = new Uint8Array(await response.arrayBuffer())
      if (data.byteLength > maxBytes) {
        throw new MediaError(`video exceeds the ${String(maxBytes)} byte ceiling`, 'MEDIA_UPSTREAM')
      }
      const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? fallbackMediaType
      return { mediaType, data }
    },
  }
}

/**
 * Translate one vendor job body into the seam's job.
 *
 * An unrecognized status keeps the job `running` rather than inventing a
 * terminal state: a vendor may add one, and a caller that keeps polling
 * recovers while a caller told `failed` cannot. An explicit `error` is
 * terminal regardless, because it is the one signal that does not depend on
 * recognizing the vocabulary.
 * @param options - the owning provider, vendor name, status table, and body.
 * @returns the seam's job record.
 */
export function vendorJob(options: {
  readonly provider: string
  readonly vendor: string
  readonly statuses: Readonly<Record<string, MediaVideoStatus>>
  readonly body: VendorJobBody
}): MediaVideoJob {
  const { provider, vendor, statuses, body } = options
  const id = typeof body.id === 'string' ? body.id : undefined
  if (id === undefined) {
    throw new MediaError(`${vendor} video job carried no id`, 'MEDIA_UPSTREAM')
  }
  const error = typeof body.error === 'string' && body.error.length > 0 ? body.error : undefined
  const raw = typeof body.status === 'string' ? body.status : ''
  const status: MediaVideoStatus = error !== undefined ? 'failed' : statuses[raw] ?? 'running'
  return {
    provider,
    id,
    status,
    ...status === 'failed'
      ? { error: error ?? `${vendor} reported video status "${raw}"` }
      : {},
  }
}

/** The three paths one vendor serves a video job through. */
export interface VendorVideoRoutes {
  /** Path that starts a job. */
  readonly start: string
  /**
   * Path reporting one job's status.
   * @param jobId - the vendor's job id.
   * @returns the status path.
   */
  status: (jobId: string) => string
  /**
   * Path serving one finished job's bytes.
   * @param jobId - the vendor's job id.
   * @returns the content path.
   */
  content: (jobId: string) => string
}

/**
 * Build a video provider from the parts that actually differ per vendor.
 *
 * Starting a job, polling it, and retrieving its bytes are the same three
 * operations everywhere; a vendor differs only in its paths, the request body
 * its route accepts, and its status vocabulary. Retrieval goes through the
 * vendor's own content route rather than any URL in the job body, so egress
 * stays on the one pinned origin.
 * @param options - the registry key, shared route, paths, ceiling, status table, and body mapping.
 * @returns the seam's video provider.
 */
export function vendorVideoProvider(options: {
  readonly id: string
  readonly vendor: string
  readonly route: VendorRoute
  readonly routes: VendorVideoRoutes
  readonly maxBytes: number
  readonly statuses: Readonly<Record<string, MediaVideoStatus>>
  readonly requestBody: (request: MediaVideoRequest) => Record<string, unknown>
}): MediaVideoProvider {
  const { id, vendor, route, routes, maxBytes, statuses, requestBody } = options
  const job = (body: VendorJobBody): MediaVideoJob =>
    vendorJob({ provider: id, vendor, statuses, body })

  return {
    id,
    available: route.available,

    async startVideo(request: MediaVideoRequest, signal?: AbortSignal): Promise<MediaVideoJob> {
      return job(await route.json(routes.start, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(request)),
      }, signal))
    },

    async videoStatus(jobId: string, signal?: AbortSignal): Promise<MediaVideoJob> {
      return job(await route.json(routes.status(jobId), { method: 'GET' }, signal))
    },

    async fetchVideo(jobId: string, signal?: AbortSignal): Promise<GeneratedMedia> {
      return route.bytes(routes.content(jobId), maxBytes, 'video/mp4', signal)
    },
  }
}
