/**
 * Per-account daily totals of the bytes bash calls share, kept as one small
 * JSON file per account in a Host directory confined commands cannot reach.
 * Calls of one account are serialized here, so concurrent calls cannot both
 * spend the same remainder.
 *
 * @module @aeven/tool-bash/share-ledger
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** An owner id usable as one file name. */
const OWNER_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/u

/** One account's bytes shared on one UTC day. */
interface DayTotal {
  day: string
  bytes: number
}

/** The share totals of every account served by this Host. */
export class ShareLedger {
  private readonly queues = new Map<string, Promise<unknown>>()

  /**
   * @param directory - Host directory holding one file per account; created when missing.
   * @param dailyBytes - bytes one account may share per UTC day.
   */
  constructor(private readonly directory: string, private readonly dailyBytes: number) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  }

  /**
   * Run one share with the bytes the account may still share today, and record what it shared.
   * @param owner - the calling session's owner.
   * @param share - receives the remaining bytes and returns the bytes it stored.
   * @returns what `share` returned.
   * @throws when the owner id is not a plain file name.
   */
  async spend<T>(owner: string, share: (remaining: number) => Promise<{ result: T; bytes: number }>): Promise<T> {
    if (!OWNER_SEGMENT.test(owner)) throw new Error(`tool-bash: owner "${owner}" cannot key the share ledger`)
    const previous = this.queues.get(owner) ?? Promise.resolve()
    const next = previous.then(async () => {
      const file = join(this.directory, `${owner}.json`)
      const today = new Date().toISOString().slice(0, 10)
      const total = this.read(file)
      const spent = total.day === today ? total.bytes : 0
      const { result, bytes } = await share(Math.max(0, this.dailyBytes - spent))
      if (bytes > 0) {
        writeFileSync(`${file}.tmp`, JSON.stringify({ day: today, bytes: spent + bytes } satisfies DayTotal))
        renameSync(`${file}.tmp`, file)
      }
      return result
    })
    this.queues.set(owner, next.catch(() => undefined))
    return next
  }

  private read(file: string): DayTotal {
    try {
      const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<DayTotal>
      return { day: typeof value.day === 'string' ? value.day : '', bytes: typeof value.bytes === 'number' ? value.bytes : 0 }
    } catch {
      // ENOENT or a torn file: the account has shared nothing recorded today.
      return { day: '', bytes: 0 }
    }
  }
}
