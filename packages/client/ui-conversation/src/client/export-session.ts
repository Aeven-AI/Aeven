/** Download a complete, point-in-time Session history as a ZIP archive. */
import { strToU8, zipSync } from 'fflate/browser'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/api-remotes/client'
import type { SessionHistoryRecord, SessionWireHeader } from '@aeven/api-session-controller/types'
import type { SessionId } from '@aeven/session/types'

/** Read the durable history through the cursor captured when the export begins. */
export async function exportSessionLog(remote: Context['remote']['session'], sessionId: SessionId): Promise<void> {
  const signal = new AbortController().signal
  const address = { kind: 'session' as const, sessionId }
  let cursor = -1
  let header: SessionWireHeader | undefined
  for await (const frame of remote.follow({ address, maxMessages: 1 }, signal)) {
    if (frame.type !== 'snapshot') throw new Error('Session export did not receive a history snapshot')
    cursor = frame.cursor
    header = frame.header
    break
  }
  if (header === undefined) throw new Error('Session export did not receive a history snapshot')

  const pages: (readonly SessionHistoryRecord[])[] = []
  let beforeSeq: number | undefined
  if (cursor >= 0) {
    while (true) {
      const result = await remote.page({ address, throughSeq: cursor, maxMessages: 200, ...beforeSeq === undefined ? {} : { beforeSeq } }, signal)
      if (!result.ok) throw result.error
      const page = result.value
      pages.unshift(page.records)
      if (!page.hasMore) break
      const first = page.records[0]
      if (first === undefined) throw new Error('Session export received an empty history page')
      beforeSeq = first.event.seq
    }
  }

  const payload = JSON.stringify({ header, throughSeq: cursor, records: pages.flat() })
  const zip = zipSync({ 'session.json': strToU8(payload) })
  const url = URL.createObjectURL(new Blob([new Uint8Array(zip)], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `session-${String(sessionId)}.zip`
  link.click()
  URL.revokeObjectURL(url)
}
