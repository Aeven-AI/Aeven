/**
 * Waiting for a transfer folder to hold what another device shared through it.
 * @module @aeven/workspace-git-sync/wait
 */
import type { Context } from '@deepseek-ai/cordis'
import type { FileSync, FileSyncFolderId } from '@aeven/file-sync'

/**
 * Resolve true once a shared folder holds everything its peers have and `complete` agrees, or false at the deadline.
 * @param ctx - context whose `file-sync/folder` events report progress.
 * @param fileSync - the file transport.
 * @param folder - the transfer folder.
 * @param deadline - epoch milliseconds after which the wait gives up.
 * @param complete - checks that the expected content arrived, such as a file of the announced size.
 * @returns whether the folder completed in time.
 */
export function untilFolder(
  ctx: Context,
  fileSync: FileSync,
  folder: FileSyncFolderId,
  deadline: number,
  complete: () => Promise<boolean>,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      dispose()
      clearTimeout(timer)
      resolve(value)
    }
    const check = async (): Promise<void> => {
      const status = fileSync.status(folder)
      if (status?.state === 'idle' && status.needFiles === 0 && await complete()) finish(true)
    }
    const dispose = ctx.on('file-sync/folder', (changed) => {
      if (changed === folder) void check()
    })
    const timer = setTimeout(() => { finish(false) }, Math.max(0, deadline - Date.now()))
    void check()
  })
}
