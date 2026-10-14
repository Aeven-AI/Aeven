import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { withTransientProbeWindow } from './transient-probe-window.ts'

/**
 * Run one `tsc -b` project while no transient probe window is open.
 *
 * `scripts/oxlint-contract.spec.ts` writes probes into the trees these projects
 * read; a program that reads one of those directories while a probe exists and
 * finds it gone by the time it reads the file fails with TS6053. This runner
 * allocates the shared window, so the compiler never reads a directory a probe
 * is passing through. See `scripts/transient-probe-window.ts`.
 */

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const tscBin = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))

/**
 * Run the requested project and exit with its status.
 * @returns nothing; the process exits with the compiler's own status.
 */
async function main(): Promise<void> {
  const [project, ...nodeFlags] = process.argv.slice(2)
  if (project === undefined) {
    throw new Error('run-tsc: pass one project, for example `tsconfig.host.json`')
  }
  process.exitCode = await withTransientProbeWindow(() => {
    const result = spawnSync(process.execPath, [...nodeFlags, tscBin, '-b', project], {
      cwd: repositoryRoot,
      stdio: 'inherit',
    })
    if (result.error !== undefined) throw result.error
    return Promise.resolve(result.status ?? 1)
  })
}

await main()
