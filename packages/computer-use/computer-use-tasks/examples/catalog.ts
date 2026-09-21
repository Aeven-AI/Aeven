/**
 * Build the task-intent catalog from the source task sets.
 *
 * The sources are fetched, not vendored: they are large (about 9 MB of JSON across
 * the three), they change, and their licenses are not ours to redistribute. So this
 * example expects them already cloned and takes their paths as arguments.
 *
 * Sparse clones are enough, and are what the recorded numbers came from:
 *
 *   git clone --depth 1 --filter=blob:none --sparse https://github.com/xlang-ai/OSWorld.git
 *   cd OSWorld && git sparse-checkout set evaluation_examples
 *
 *   git clone --depth 1 --filter=blob:none --sparse https://github.com/JetAstra/MacAgentBench.git
 *   cd MacAgentBench && git sparse-checkout set tasks
 *
 *   git clone --depth 1 --filter=blob:none --sparse https://github.com/microsoft/WindowsAgentArena.git
 *   cd WindowsAgentArena && git sparse-checkout set src/win-arena-container/client/evaluation_examples_windows
 *
 * Run it with the three roots:
 *
 *   npx tsx packages/computer-use/computer-use-tasks/examples/catalog.ts \
 *     <osworld>/evaluation_examples/examples \
 *     <macagentbench>/tasks \
 *     <windowsagentarena>/src/win-arena-container/client/evaluation_examples_windows/examples
 *
 * @module @aeven/computer-use-tasks/examples/catalog
 */

import { writeFileSync } from 'node:fs'
import {
  checkVocabulary,
  countBySource,
  groupByApp,
  harnessOnlyCount,
  normalizeIntents,
  readTaskSets,
  renameReport,
  renderCatalog,
  type TaskSource,
} from '../src/index.ts'

const [osworld, macagentbench, windowsagentarena] = process.argv.slice(2)
if (osworld === undefined || macagentbench === undefined || windowsagentarena === undefined) {
  process.stderr.write('usage: catalog.ts <osworld examples> <macagentbench tasks> <waa examples> [out.md]\n')
  process.exit(2)
}
const out = process.argv[5] ?? 'task-intent-catalog.md'

const sources: Array<{ root: string; source: TaskSource }> = [
  { root: osworld, source: 'osworld' },
  { root: macagentbench, source: 'macagentbench' },
  { root: windowsagentarena, source: 'windowsagentarena' },
]

const raw = readTaskSets(sources)
const intents = normalizeIntents(raw.intents)

process.stdout.write(`intents read      : ${String(raw.intents.length)}\n`)
process.stdout.write(`parse failures    : ${String(raw.failures.length)}\n`)
process.stdout.write(`by source         : ${JSON.stringify(countBySource(raw.intents))}\n`)
process.stdout.write(`harness-only      : ${String(harnessOnlyCount(raw.intents))} intents set aside\n`)
process.stdout.write(`canonical domains : ${String(groupByApp(intents).size)}\n\n`)

process.stdout.write('domains after normalization (top 25):\n')
for (const [app, list] of [...groupByApp(intents).entries()].sort((left, right) => right[1].length - left[1].length).slice(0, 25)) {
  process.stdout.write(`  ${app.padEnd(24)}${String(list.length)}\n`)
}

process.stdout.write('\nrenames applied (raw -> canonical):\n')
for (const [canonical, raws] of renameReport(raw.intents)) {
  process.stdout.write(`  ${raws.join(', ').padEnd(36)}-> ${canonical}\n`)
}

process.stdout.write('\nend-state checks that assert content (top 20):\n')
const structural = /^(sleep|execute|activate_window|launch|download)$/
const contentChecks = [...checkVocabulary(intents).entries()]
  .filter(([name]) => /^(compare_|check_|find_str)/.test(name) && !structural.test(name))
for (const [name, count] of contentChecks.slice(0, 20)) {
  process.stdout.write(`  ${name.padEnd(46)}${String(count)}\n`)
}

writeFileSync(out, renderCatalog(intents, 'Desktop task-intent catalog'))
process.stdout.write(`\ncatalog written: ${out}\n`)

if (raw.failures.length > 0) {
  process.stdout.write('\nfiles that failed to parse (reported, not dropped):\n')
  for (const failure of raw.failures.slice(0, 20)) {
    process.stdout.write(`  ${failure.path} :: ${failure.reason}\n`)
  }
}
