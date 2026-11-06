/**
 * Subprocess runtime that starts commands without forking the Host. A large
 * Host process pays for every fork in page-table copies, during which its
 * event loop serves no one: about 35 ms per command at 1.2 GB. This provider
 * keeps the local runtime's process ownership, stdio collection, and tree
 * signalling, and replaces only the spawner: a small helper keeps a pool of
 * idle launchers, and a command `exec`s inside one of them, keeping its pid
 * and process group. A call the pool cannot serve falls back to an ordinary
 * spawn. POSIX only.
 * @module @aeven/subprocess-executor
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { LocalSubprocessRuntime } from '@aeven/subprocess-local'
import { Executor } from './executor.ts'

/** Plugin config. */
export interface Config {
  /** Idle launchers the helper keeps ready; a burst beyond it falls back to ordinary spawns. */
  poolSize?: number
}

/** The helper process script: the source file when running unbuilt, the bundled CommonJS worker otherwise. */
const HELPER_PATH = fileURLToPath(new URL(new URL(import.meta.url).pathname.endsWith('.ts') ? './worker.ts' : './worker.cjs', import.meta.url))

/** Local subprocess runtime whose commands start in pooled launchers. Registers as `ctx.subprocess`. */
export class ExecutorSubprocessRuntime extends LocalSubprocessRuntime {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    poolSize: z.natural().min(1).default(4),
  })

  constructor(ctx: Context, config: Config) {
    super(ctx)
    if (process.platform === 'win32') throw new Error('subprocess-executor: requires a POSIX host')
    // The Host forks only to start the helper (again only if it dies); the helper is small, so its own forks are cheap.
    const startHelper = (): ReturnType<typeof spawn> => {
      const helper = spawn(process.execPath, [HELPER_PATH, String(config.poolSize)], {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      })
      helper.unref()
      helper.channel?.unref()
      return helper
    }
    const executor = new Executor({ startHelper, fallback: spawn, warn: (message) => { ctx.logger.warn(message) } })
    this.internals.spawn = executor.spawnProcess
    ctx.effect(() => {
      // Node's exit phase runs no async teardown; stop the helper so its idle launchers go with it.
      const onHostExit = (): void => { executor.process.kill('SIGTERM') }
      process.prependListener('exit', onHostExit)
      return () => {
        process.off('exit', onHostExit)
        executor.close()
      }
    }, 'subprocess executor helper')
  }
}

export default ExecutorSubprocessRuntime
