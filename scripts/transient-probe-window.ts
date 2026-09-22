import { readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { withFileLock } from '@aeven/atomic-write'

/**
 * Exclusive window around the probe files `scripts/oxlint-contract.spec.ts`
 * writes into compiled trees.
 *
 * That spec proves which TypeScript project owns each file class, so its probes
 * have to sit at the exact paths whose owning project it asserts — inside the
 * `include` patterns of the programs `tsc -b` builds. A program that reads such
 * a directory while a probe is there and finds it gone by the time it reads the
 * file fails with TS6053, which is what a `build` or `typecheck` gate running
 * beside the `test` gate hit.
 *
 * No configuration separates the two readers: `exclude` would also stop Oxlint
 * from resolving the project the spec asserts, and `--excludeFiles` governs
 * watch mode rather than program membership. The probe window and the compiler
 * run therefore allocate one lock, so they cannot overlap.
 */

/** How long a contender waits for the other side, in milliseconds. */
const DEFAULT_WAIT_MS = 15 * 60 * 1000

/** Options for one {@link createTransientProbeWindow} holder. */
export interface TransientProbeWindowOptions {
  /** Maximum time to wait for the window to close or the compiler run to end. */
  waitMs?: number
}

/** Filename whose `<filename>.lock` sibling both sides allocate. */
export const TRANSIENT_PROBE_WINDOW = fileURLToPath(new URL('../.avn-transient-probes', import.meta.url))

/**
 * Report whether one process id still exists.
 * @param pid - the recorded owner of a probe window.
 * @returns true when the process exists, including one this process may not signal.
 */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists under another owner; ESRCH means it is gone.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Drop a lock whose recorded owner no longer exists.
 *
 * The shared lock primitive refuses to remove an existing lock because file age
 * cannot prove that its owner stopped. A process id can: a killed gate leaves
 * the lock behind, and every later contender would otherwise wait out its
 * deadline.
 * @param lockPath - the `<filename>.lock` path to inspect.
 * @returns nothing; the path is removed only when its owner is gone.
 */
async function reapDeadHolder(lockPath: string): Promise<void> {
  let recorded: string
  try {
    recorded = await readFile(lockPath, 'utf8')
  } catch {
    // No lock file means no window to reap.
    return
  }
  const pid = Number.parseInt(recorded.trim(), 10)
  if (Number.isSafeInteger(pid) && pid > 0 && processAlive(pid)) return
  await rm(lockPath, { force: true })
}

/**
 * Build one holder for a probe-window lock.
 *
 * The returned function runs its operation while holding the lock, and releases
 * it on both outcomes so a failing assertion cannot leave the window open.
 * @param lockFilename - the lock's filename; its `<filename>.lock` sibling is the lock itself.
 * @param options - acquisition options; omitted waits {@link DEFAULT_WAIT_MS}.
 * @returns a function that runs one operation inside its own window.
 */
export function createTransientProbeWindow(
  lockFilename: string,
  options: TransientProbeWindowOptions = {},
): <T>(operation: () => Promise<T>) => Promise<T> {
  const lockPath = `${lockFilename}.lock`
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS
  return async function hold<T>(operation: () => Promise<T>): Promise<T> {
    await reapDeadHolder(lockPath)
    return withFileLock(lockFilename, operation, { waitMs })
  }
}

/** Hold the repository probe window around one operation. */
export const withTransientProbeWindow = createTransientProbeWindow(TRANSIENT_PROBE_WINDOW)
