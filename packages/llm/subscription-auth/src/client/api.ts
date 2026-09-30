/** Same-origin JSON helpers for the Coding OAuth plugin HTTP API. */

import type { PluginRequestError } from './types.ts'

/**
 * Narrow to a plain object record.
 * @param value - any parsed JSON value.
 * @returns true for a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Send one same-origin JSON request to the plugin API.
 * @param path - the plugin route to call.
 * @param method - the HTTP method.
 * @param body - JSON body to send; omitted for a bodiless request.
 * @returns the parsed response body, typed by the caller.
 * @throws PluginRequestError carrying the Host's `error` or `message` text, the status, and any `code`.
 */
export async function jsonRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    credentials: 'same-origin',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const record = isRecord(value) ? value : undefined
    const message =
      record !== undefined && typeof record['error'] === 'string'
        ? record['error']
        : record !== undefined && typeof record['message'] === 'string'
          ? record['message']
          : `${response.status} ${response.statusText}`.trim()
    const code = record !== undefined && typeof record['code'] === 'string' ? record['code'] : undefined
    const error = new Error(message) as PluginRequestError
    error.name = 'PluginRequestError'
    error.status = response.status
    if (code !== undefined) error.code = code
    throw error
  }
  return value as T
}

/**
 * Copy text to the clipboard, falling back to `execCommand` where the async clipboard is unavailable.
 * @param text - the text to copy.
 * @returns whether the copy succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- some runtimes omit clipboard
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to execCommand
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    // oxlint-disable-next-line typescript/no-deprecated -- deliberate legacy fallback for browsers without the async clipboard API
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
