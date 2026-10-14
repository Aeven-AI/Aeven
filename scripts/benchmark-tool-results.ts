/**
 * Tool-result accounting shared by the learning and memory benchmark metrics.
 */

/**
 * Whether one `tool/result` payload records a failed call, either as an event
 * `error` or as an error-marked first content block.
 * @param data - the event's `data` payload.
 * @returns whether the call that produced this result failed.
 */
export function toolResultFailed(data: Record<string, unknown>): boolean {
  const message = data['message'] as { content?: { isError?: boolean }[] } | undefined
  return data['error'] !== undefined || message?.content?.[0]?.isError === true
}
