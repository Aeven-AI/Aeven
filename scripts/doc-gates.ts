/**
 * Run the documentation gates in one process.
 *
 * Each gate keeps its own CLI entry, but a lane of them pays process startup and
 * a fresh TypeScript compile per gate. Importing the exported entry points and
 * calling them in order shares both, which is what makes the documentation loop
 * fast enough to run on every change.
 *
 * Run: `tsx scripts/doc-gates.ts [--fix]`.
 */

import { main as checkWorkspaceConstraints } from './check-workspace-constraints.ts'
import { runMdWrap } from './verify-md-wrap.ts'

/** One in-process gate: a name, its entry point, and whether `--fix` applies. */
interface DocGate {
  name: string
  run: (argv: readonly string[]) => number
}

const GATES: readonly DocGate[] = [
  { name: 'constraints', run: argv => checkWorkspaceConstraints(argv) },
  { name: 'md-wrap', run: argv => runMdWrap(argv) },
]

const argv = process.argv.slice(2)
const failures: string[] = []
const startedAt = performance.now()

for (const gate of GATES) {
  const gateStartedAt = performance.now()
  const code = gate.run(argv)
  const elapsed = Math.round(performance.now() - gateStartedAt)
  console.log(`[doc-gates] ${gate.name}: ${code === 0 ? 'passed' : 'failed'} in ${elapsed}ms`)
  if (code !== 0) failures.push(gate.name)
}

const total = Math.round(performance.now() - startedAt)
if (failures.length > 0) {
  console.error(`[doc-gates] ${failures.length} gate(s) failed: ${failures.join(', ')} (${total}ms)`)
  process.exit(1)
}
console.log(`[doc-gates] ${GATES.length} gate(s) passed in ${total}ms`)
