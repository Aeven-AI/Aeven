/**
 * Precheck for the Typert Remote-boundary analysis.
 *
 * The Host build runs `typertPlugin({ mode: 'workspace', faces: ['host'] })`
 * from inside tsdown, so a wire type the generator rejects is only discovered
 * after the whole workspace has been bundled — a multi-gigabyte pass whose
 * failure surfaces as an out-of-memory abort rather than the analysis error
 * that caused it. That is a slow and misleading way to learn that a Remote
 * boundary type is not plain JSON.
 *
 * This gate runs the very same generator pass directly, from source, before any
 * bundling. It takes seconds and a few hundred megabytes, needs neither `tsc`
 * output nor a prior build (the generator builds its own programs from the face
 * aggregate tsconfigs), and reports the offending declaration instead of an
 * allocation failure.
 *
 * It is deliberately the plugin's own `writeBundle` rather than a
 * reimplementation of its discovery/filter/generate sequence: a gate that
 * restates the build's rules is a gate that can drift from them. The pass also
 * emits the contract artifacts it validates, exactly as the build does, so a
 * green run additionally means those artifacts are current.
 *
 * Only the `host` face is checked, because that is the only face the root
 * tsdown config generates; the Client pass mounts no Typert plugin.
 * @module scripts/verify-typert
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { typertPlugin } from '../packages/typert/generator/src/tsdown-plugin.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * The repository's own `lib` location — the path the Host build's workspace
 * config passes to `writeBundle`.
 *
 * This anchor is deliberately NOT inside a package. The plugin derives the
 * workspace root by walking up to the nearest `tsconfig.host.json`, and every
 * package ships its own, so anchoring on a package directory would resolve the
 * "workspace root" to that single package, discover no contributors, and exit
 * successfully without analysing anything — a green result that means nothing.
 * Starting one level below the repository root reaches the root's own
 * `tsconfig.host.json` before any package's, which is the input the real build
 * uses. The directory need not exist; only its ancestors are inspected.
 */
const ANCHOR = resolve(ROOT, 'lib')

/** Run the Host-face generator pass and translate its outcome into an exit code. */
function main(): void {
  const started = Date.now()
  try {
    typertPlugin({ mode: 'workspace', faces: ['host'] }).writeBundle({ dir: ANCHOR })
  } catch (error: unknown) {
    console.error('verify-typert: the Typert Remote-boundary analysis rejected the workspace:')
    console.error(`  ${error instanceof Error ? error.message : String(error)}`)
    console.error('')
    console.error('A Remote boundary type must be plain JSON. An optional (`| undefined`) property is')
    console.error('not JSON: declare the field as `| null` on the wire and map it on the domain side of')
    console.error('the projection, the way `workspaceView` maps an absent path.')
    process.exit(1)
  }
  console.log(`verify-typert: host boundary analysis clean in ${String(Date.now() - started)}ms.`)
  process.exit(0)
}

main()
