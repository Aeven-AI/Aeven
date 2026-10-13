/**
 * Learning benchmark: does Aeven get faster and better at a task it has done before?
 *
 * Runs one fixed task several times through the shipped `headless` profile under two conditions, each in its
 * own throwaway `$AVN_HOME`:
 * - `baseline`: no capability layer mounted; every run starts cold.
 * - `learning`: the capability layer with automatic learning; each run may reuse what earlier runs taught.
 *
 * Every run gets a freshly generated fixture workspace with the same structure and traps but different values,
 * so a run cannot pass by repeating values from an earlier one. Success is decided by this script checking the
 * run's output against truth computed from the fixture, never by the model's own report. Tasks: `release` (an
 * unfamiliar project with a misleading README, a hidden runbook, and tools that fail with opaque codes) and
 * `inventory` (careful file accounting). Cost is
 * read from the run's session log: wall time of the turn, tool calls, failed tool calls, and tokens.
 *
 * Usage:
 *   AEVEN_EMAIL=… AEVEN_PASSWORD=… pnpm run benchmark:learning -- --runs 4
 *   AEVEN_TOKEN=… AVN_OWNER=… pnpm run benchmark:learning
 *
 * Options: --task release|inventory (default release), --runs <n> (default 4), --conditions baseline,learning, --out <dir>, --timeout-min <n> (default 10),
 * --provider/--model/--effort (default aeven-cloud / Aeven-1.0-Flash / high).
 * Writes `results.json` and `report.md` to the output directory and prints the report. Needs the `zstd` CLI
 * to read session logs.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

type Condition = 'baseline' | 'learning'

interface Options {
  readonly runs: number
  readonly conditions: readonly Condition[]
  readonly task: 'release' | 'inventory'
  readonly out: string
  readonly timeoutMs: number
  readonly provider: string
  readonly model: string
  readonly effort: string
}

interface InventoryTruth {
  readonly totalBytes: number
  readonly largestFiles: readonly { readonly path: string; readonly bytes: number }[]
  readonly logFiles: number
  readonly csvRows: number
}

interface ReleaseTruth {
  readonly artifact: string
}

interface Check {
  readonly passed: boolean
  /** Each checked field and whether the run got it right. */
  readonly fields: Readonly<Record<string, boolean>>
  readonly error?: string
}

/** One benchmark task: the fixed prompt, a fixture generator, and a checker that never trusts the model's report. */
interface BenchmarkTask {
  readonly prompt: string
  /** Write a fresh fixture with the task's fixed structure and seed-dependent values; return what a correct run must produce. */
  readonly fixture: (root: string, seed: number) => unknown
  readonly check: (workspace: string, truth: unknown) => Check
}

interface RunMetrics {
  readonly durationMs: number
  readonly toolCalls: number
  readonly failedToolCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
  /** Every token the model processed, cached input included. */
  readonly totalTokens: number
  /** Capabilities the run loaded with the skill tool. */
  readonly loaded: readonly string[]
  /** Whether learned procedures were pointed out at the start of the turn. */
  readonly recalled: boolean
}

interface RunResult {
  readonly condition: Condition
  readonly run: number
  readonly exitCode: number | null
  readonly wallMs: number
  readonly check: Check
  readonly metrics?: RunMetrics
  /** Capabilities in the home after the run, with status and revision. */
  readonly capabilities: readonly string[]
}

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const cliEntry = join(repositoryRoot, 'apps', 'cli', 'src', 'bin.ts')
const tsxEsm = import.meta.resolve('tsx/esm')

/** The inventory task: careful file accounting with hidden directories and look-alike names as traps. */
const INVENTORY_PROMPT = [
  'Create inventory.json in the current directory describing this project folder. It must be one JSON object with exactly these fields:',
  '- "totalBytes": the sum of the sizes in bytes of all regular files under data/, including files in hidden directories.',
  '- "largestFiles": the 3 largest files under data/, largest first, as [{"path": <path relative to the current directory>, "bytes": <size in bytes>}].',
  '- "logFiles": the number of files whose name ends in ".log" anywhere under the current directory, including hidden directories.',
  '- "csvRows": the total number of data rows in all files ending in ".csv" under data/, not counting each file\'s header line.',
  'Sizes are exact file sizes in bytes, not disk usage.',
].join('\n')

function parseOptions(argv: readonly string[]): Options {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  const conditions = (value('--conditions') ?? 'baseline,learning').split(',').map(item => item.trim())
  for (const condition of conditions) {
    if (condition !== 'baseline' && condition !== 'learning') throw new Error(`unknown condition: ${condition}`)
  }
  const task = value('--task') ?? 'release'
  if (task !== 'release' && task !== 'inventory') throw new Error(`unknown task: ${task}`)
  const runs = Number(value('--runs') ?? 4)
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer')
  return {
    runs,
    task,
    conditions: conditions as Condition[],
    out: value('--out') ?? join(tmpdir(), `aeven-learning-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}`),
    timeoutMs: Number(value('--timeout-min') ?? 10) * 60_000,
    provider: value('--provider') ?? 'aeven-cloud',
    model: value('--model') ?? 'Aeven-1.0-Flash',
    effort: value('--effort') ?? 'high',
  }
}

/** Seeded pseudo-random numbers, so a run's fixture is reproducible from its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Write one fixture workspace. The structure and its traps are fixed: hidden directories, CSV headers, files
 * whose names contain but do not end in `.log` or `.csv`, and sizes that differ from disk usage. The values vary
 * with the seed.
 */
function inventoryFixture(root: string, seed: number): InventoryTruth {
  const next = random(seed)
  const between = (low: number, high: number): number => low + Math.floor(next() * (high - low + 1))
  const usedSizes = new Set<number>()
  const uniqueSize = (low: number, high: number): number => {
    let size = between(low, high)
    while (usedSizes.has(size)) size++
    usedSizes.add(size)
    return size
  }
  const write = (path: string, content: string): void => {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const filler = (bytes: number): string => {
    let text = ''
    while (text.length < bytes) text += `line ${text.length} ${Math.floor(next() * 1e9).toString(36)}\n`
    return text.slice(0, bytes)
  }
  const csv = (rows: number): string => {
    let text = 'id,sensor,value\n'
    for (let row = 1; row <= rows; row++) text += `${row},s${between(1, 9)},${(next() * 100).toFixed(3)}\n`
    return text
  }

  write('README.md', '# Sensor project\n\nRaw readings live in data/.\n')
  const csvFiles = ['data/raw/readings-a.csv', 'data/raw/readings-b.csv', 'data/processed/summary.csv', 'data/.cache/partial.csv']
  for (const path of csvFiles) write(path, csv(between(8, 60)))
  write('data/raw/readings-a.csv.bak', csv(between(5, 20)))
  const blobs = ['data/raw/capture-1.bin', 'data/raw/capture-2.bin', 'data/processed/model.bin', 'data/.cache/index.bin', 'data/archive/2024/old.bin']
  for (const path of blobs) write(path, filler(uniqueSize(4_000, 90_000)))
  const logs = ['debug.log', 'logs/app.log', 'logs/worker.log', 'logs/.old/app-1.log', 'data/.cache/fetch.log', 'data/archive/2024/import.log']
  for (const path of logs.slice(0, between(4, logs.length))) write(path, filler(between(100, 3_000)))
  write('logs/app.log.gz', filler(500))
  write('notes.log.txt', 'not a log file\n')

  const files: { path: string; bytes: number }[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) files.push({ path: relative(root, path).split(sep).join('/'), bytes: statSync(path).size })
    }
  }
  walk(root)
  const data = files.filter(file => file.path.startsWith('data/'))
  return {
    totalBytes: data.reduce((sum, file) => sum + file.bytes, 0),
    largestFiles: [...data].sort((a, b) => b.bytes - a.bytes).slice(0, 3),
    logFiles: files.filter(file => file.path.endsWith('.log')).length,
    csvRows: data.filter(file => file.path.endsWith('.csv'))
      .reduce((sum, file) => sum + readFileSync(join(root, file.path), 'utf8').trimEnd().split('\n').length - 1, 0),
  }
}

function inventoryCheck(workspace: string, truth: InventoryTruth): Check {
  const fields = { totalBytes: false, largestFiles: false, logFiles: false, csvRows: false }
  let answer: Record<string, unknown>
  try {
    answer = JSON.parse(readFileSync(join(workspace, 'inventory.json'), 'utf8')) as Record<string, unknown>
  } catch (error) {
    // A missing or unreadable file is a failed run, reported with its reason.
    return { passed: false, fields, error: error instanceof Error ? error.message : String(error) }
  }
  const normalize = (path: unknown): string => String(path).replace(/^\.\//, '')
  fields.totalBytes = answer['totalBytes'] === truth.totalBytes
  fields.logFiles = answer['logFiles'] === truth.logFiles
  fields.csvRows = answer['csvRows'] === truth.csvRows
  const largest = answer['largestFiles']
  fields.largestFiles = Array.isArray(largest) && largest.length === 3 && largest.every((item, index) => {
    const expected = truth.largestFiles[index]
    const entry = item as Record<string, unknown>
    return expected !== undefined && normalize(entry['path']) === expected.path && entry['bytes'] === expected.bytes
  })
  return { passed: Object.values(fields).every(Boolean), fields }
}

/**
 * The release task: an unfamiliar project whose README is out of date, whose real runbook sits in a hidden
 * directory, and whose tools fail with opaque codes when a step, flag, or credential is wrong. The version,
 * track, and token change with the seed.
 */
const RELEASE_PROMPT = 'Release this project: build the release artifact for the current version and verify it with the project\'s own verification tool. Tell me the artifact name when it is verified.'

function releaseFixture(root: string, seed: number): ReleaseTruth {
  const next = random(seed)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T
  const version = `${1 + Math.floor(next() * 4)}.${Math.floor(next() * 20)}.${Math.floor(next() * 50)}`
  const track = pick(['stable', 'beta', 'edge', 'lts'])
  const token = Math.floor(next() * 1e12).toString(36)
  const write = (path: string, content: string, executable = false): void => {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content, { mode: executable ? 0o755 : 0o644 })
  }
  write('README.md', '# Telemetry agent\n\nCollects device telemetry.\n\n## Development\n\nRun `npm test` to test.\n\n## Releasing\n\nRun `make release`.\n')
  write('docs/RELEASING.md', '# Releasing\n\nReleases are cut with the scripts in tools/. The exact steps live in the ops runbook, next to the release credentials.\n')
  write('release.json', `{\n  "name": "telemetry-agent",\n  "version": "${version}",\n  "track": "${track}"\n}\n`)
  write('src/agent.js', 'export function collect() { return { ok: true } }\n')
  write('src/transport.js', 'export function send(payload) { return JSON.stringify(payload) }\n')
  write('.ops/release.token', `${token}\n`)
  write('.ops/runbook.md', [
    '# Ops runbook',
    '',
    '## Release',
    '',
    '1. Stamp the build: `./tools/prepare --stamp`',
    '2. Cut: `RELEASE_TOKEN=<token> ./tools/cut --channel <channel>`',
    '   The token is in this directory. The channel is the release track.',
    '3. Verify the artifact `cut` prints: `./tools/verify dist/<artifact>`',
    '',
    '## Error codes',
    '',
    '- E17: build not stamped',
    '- E22: wrong channel',
    '- 401: bad or missing token',
    '',
  ].join('\n'))
  write('tools/prepare', [
    '#!/usr/bin/env bash',
    'cd "$(dirname "$0")/.." || exit 1',
    'if [ "$1" != "--stamp" ]; then echo "prepare: nothing to do" >&2; exit 2; fi',
    'mkdir -p build && date +%s > build/.stamp && echo "prepared"',
    '',
  ].join('\n'), true)
  write('tools/cut', [
    '#!/usr/bin/env bash',
    'cd "$(dirname "$0")/.." || exit 1',
    '[ -f build/.stamp ] || { echo "cut: E17" >&2; exit 3; }',
    '[ -n "$RELEASE_TOKEN" ] && [ "$RELEASE_TOKEN" = "$(tr -d "[:space:]" < .ops/release.token)" ] || { echo "cut: 401" >&2; exit 4; }',
    'channel=""',
    'while [ $# -gt 0 ]; do case "$1" in --channel) channel="$2"; shift 2;; *) echo "cut: unknown argument $1" >&2; exit 5;; esac; done',
    'track=$(sed -n \'s/.*"track": *"\\([^"]*\\)".*/\\1/p\' release.json)',
    'version=$(sed -n \'s/.*"version": *"\\([^"]*\\)".*/\\1/p\' release.json)',
    '[ "$channel" = "$track" ] || { echo "cut: E22" >&2; exit 6; }',
    'mkdir -p dist',
    'name="telemetry-agent-$version-$track.tar"',
    'tar -cf "dist/$name" src release.json && echo "$name"',
    '',
  ].join('\n'), true)
  write('tools/verify', [
    '#!/usr/bin/env bash',
    'cd "$(dirname "$0")/.." || exit 1',
    'f="$1"; [ -f "$f" ] || { echo "verify: no such artifact" >&2; exit 2; }',
    'sum=$(cksum < "$f" | awk \'{print $1}\')',
    'echo "OK $(basename "$f") $sum" | tee dist/VERIFIED',
    '',
  ].join('\n'), true)
  return { artifact: `telemetry-agent-${version}-${track}.tar` }
}

function releaseCheck(workspace: string, truth: ReleaseTruth): Check {
  const fields = { artifact: false, verified: false }
  const artifact = join(workspace, 'dist', truth.artifact)
  fields.artifact = existsSync(artifact)
  if (fields.artifact) {
    const sum = execFileSync('sh', ['-c', 'cksum < "$1" | awk \'{print $1}\'', 'sh', artifact]).toString().trim()
    const verified = existsSync(join(workspace, 'dist', 'VERIFIED')) ? readFileSync(join(workspace, 'dist', 'VERIFIED'), 'utf8').trim() : ''
    fields.verified = verified === `OK ${truth.artifact} ${sum}`
  }
  return { passed: fields.artifact && fields.verified, fields }
}

const TASKS: Readonly<Record<Options['task'], BenchmarkTask>> = {
  release: { prompt: RELEASE_PROMPT, fixture: releaseFixture, check: (workspace, truth) => releaseCheck(workspace, truth as ReleaseTruth) },
  inventory: { prompt: INVENTORY_PROMPT, fixture: inventoryFixture, check: (workspace, truth) => inventoryCheck(workspace, truth as InventoryTruth) },
}

/** Session logs under a home, newest last. */
function sessionLogs(home: string): string[] {
  const root = join(home, 'sessions')
  if (!existsSync(root)) return []
  const logs: string[] = []
  for (const workspace of readdirSync(root)) {
    for (const session of readdirSync(join(root, workspace))) {
      const path = join(root, workspace, session, 'session.jsonl.zstd')
      if (existsSync(path)) logs.push(path)
    }
  }
  return logs.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
}

function metricsOf(logPath: string): RunMetrics {
  // Session logs are appended as many zstd frames; the zstd CLI decodes all of them.
  const lines = execFileSync('zstd', ['-dc', logPath], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8').split('\n').filter(Boolean)
  let started: number | undefined
  let ended: number | undefined
  let toolCalls = 0
  let failedToolCalls = 0
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let recalled = false
  const loaded: string[] = []
  for (const line of lines) {
    const event = JSON.parse(line) as { type?: string; time?: number; data?: Record<string, unknown> }
    const data = event.data ?? {}
    switch (event.type) {
      case 'turn/start':
        started ??= event.time
        break
      case 'turn/end':
        ended = event.time
        break
      case 'tool/call': {
        toolCalls++
        if (data['name'] === 'skill') {
          try {
            const name = (JSON.parse(String(data['arguments'])) as { name?: unknown }).name
            if (typeof name === 'string') loaded.push(name)
          } catch {
            // Arguments that are not JSON name no skill.
          }
        }
        break
      }
      case 'tool/result': {
        const message = data['message'] as { content?: { isError?: boolean }[] } | undefined
        if (data['error'] !== undefined || message?.content?.[0]?.isError === true) failedToolCalls++
        break
      }
      case 'assistant/message': {
        const usage = data['usage'] as { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined
        inputTokens += usage?.inputTokens ?? 0
        outputTokens += usage?.outputTokens ?? 0
        totalTokens += usage?.totalTokens ?? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
        break
      }
      case 'user/message':
        if (line.includes('learned_procedures')) recalled = true
        break
      default:
        break
    }
  }
  return { durationMs: (ended ?? 0) - (started ?? 0), toolCalls, failedToolCalls, inputTokens, outputTokens, totalTokens, loaded, recalled }
}

function capabilitiesOf(home: string, owner: string): string[] {
  const root = join(home, 'capabilities', encodeURIComponent(owner))
  if (!existsSync(root)) return []
  return readdirSync(root).flatMap((name) => {
    const record = join(root, name, 'capability.json')
    if (!existsSync(record)) return []
    const parsed = JSON.parse(readFileSync(record, 'utf8')) as { status: string; revision: number }
    return [`${name} (${parsed.status}, r${parsed.revision})`]
  })
}

function runOnce(prompt: string, workspace: string, env: NodeJS.ProcessEnv, timeoutMs: number, logPrefix: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', tsxEsm, cliEntry, '--profile', 'headless', '--patch', env['AVN_BENCHMARK_PATCH'] ?? '', prompt], { cwd: workspace, env })
    const output: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk))
    const timer = setTimeout(() => { child.kill('SIGKILL') }, timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      writeFileSync(`${logPrefix}.log`, Buffer.concat(output))
      resolve(code)
    })
  })
}

async function token(): Promise<{ token: string; owner: string }> {
  let value = process.env['AEVEN_TOKEN']
  if (value === undefined) {
    const email = process.env['AEVEN_EMAIL']
    const password = process.env['AEVEN_PASSWORD']
    if (!email || !password) throw new Error('set AEVEN_TOKEN, or AEVEN_EMAIL and AEVEN_PASSWORD to sign in')
    const response = await fetch(`${process.env['AEVEN_API_URL'] ?? 'http://localhost:9000'}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!response.ok) throw new Error(`sign-in failed: HTTP ${response.status}`)
    value = (await response.json() as { accessToken: string }).accessToken
  }
  const claims = JSON.parse(Buffer.from(value.split('.')[1] ?? '', 'base64url').toString('utf8')) as { userId?: unknown }
  const owner = process.env['AVN_OWNER'] ?? (typeof claims.userId === 'string' ? claims.userId : undefined)
  if (owner === undefined) throw new Error('the token names no userId; set AVN_OWNER')
  return { token: value, owner }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] ?? Number.NaN : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function report(options: Options, results: readonly RunResult[]): string {
  const seconds = (ms: number): string => `${(ms / 1000).toFixed(0)}s`
  const kilo = (tokens: number): string => `${(tokens / 1000).toFixed(1)}K`
  const lines = [
    '# Aeven learning benchmark',
    '',
    `Task \`${options.task}\` (fixed prompt, fresh fixture values every run), ${options.runs} runs per condition, model ${options.provider}/${options.model} (${options.effort}).`,
    '',
    '```text',
    TASKS[options.task].prompt,
    '```',
    '',
    '| Condition | Run | Correct | Time | Tool calls | Failed calls | Tokens (uncached in+out) | Tokens (total) | Used learned procedure | Capabilities after run |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const result of results) {
    const metrics = result.metrics
    const fields = Object.entries(result.check.fields).filter(([, ok]) => !ok).map(([name]) => name)
    lines.push(`| ${result.condition} | ${result.run} | ${result.check.passed ? 'yes' : `no${fields.length > 0 ? ` (${fields.join(', ')})` : ''}${result.check.error ? ` (${result.check.error.slice(0, 60)})` : ''}`} | ${metrics ? seconds(metrics.durationMs) : '—'} | ${metrics?.toolCalls ?? '—'} | ${metrics?.failedToolCalls ?? '—'} | ${metrics ? kilo(metrics.inputTokens + metrics.outputTokens) : '—'} | ${metrics ? kilo(metrics.totalTokens) : '—'} | ${metrics?.loaded.length ? metrics.loaded.join(', ') : 'no'} | ${result.capabilities.join('; ') || '—'} |`)
  }
  lines.push('', '## Summary', '', '| Condition | Runs | Correct | Median time | Median tool calls | Median tokens | Median time, runs 2+ | Median tokens, runs 2+ |', '|---|---|---|---|---|---|---|---|')
  for (const condition of options.conditions) {
    const own = results.filter(result => result.condition === condition)
    const measured = own.flatMap(result => result.metrics === undefined ? [] : [result.metrics])
    const later = own.filter(result => result.run > 1).flatMap(result => result.metrics === undefined ? [] : [result.metrics])
    lines.push(`| ${condition} | ${own.length} | ${own.filter(result => result.check.passed).length}/${own.length} | ${seconds(median(measured.map(m => m.durationMs)))} | ${median(measured.map(m => m.toolCalls))} | ${kilo(median(measured.map(m => m.inputTokens + m.outputTokens)))} | ${later.length ? seconds(median(later.map(m => m.durationMs))) : '—'} | ${later.length ? kilo(median(later.map(m => m.inputTokens + m.outputTokens))) : '—'} |`)
  }
  return `${lines.join('\n')}\n`
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const task = TASKS[options.task]
  const { token: aevenToken, owner } = await token()
  mkdirSync(options.out, { recursive: true })
  console.log(`benchmark output: ${options.out}`)
  const results: RunResult[] = []
  for (const condition of options.conditions) {
    const home = join(options.out, condition, 'home')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'settings.yaml'), [
      'agent-default-model:',
      `  provider: ${options.provider}`,
      `  model: ${options.model}`,
      `  reasoningEffort: ${options.effort}`,
      'permission:',
      '  defaultPreset: danger-full-access',
      '',
    ].join('\n'))
    const patch = join(options.out, condition, 'benchmark.cordis.patch.yml')
    // Baseline runs without the capability layer at all: no registry, no tool, no guidance, so nothing can be
    // saved or reused, not even by the model on its own initiative. Memory stays off in both conditions.
    writeFileSync(patch, [
      '- insert:',
      ...condition === 'learning' ? [
        '    - id: capability',
        "      name: '@aeven/capability'",
        '      config:',
        `        root: ${JSON.stringify(join(home, 'capabilities'))}`,
        '    - id: tool-capability',
        "      name: '@aeven/tool-capability'",
      ] : [],
      '    # Plugin logs, including what the learner learned, land in each run\'s avn.log.',
      '    - id: logger-console',
      "      name: '@deepseek-ai/cordis-plugin-logger-console'",
      '',
    ].join('\n'))
    // The run's working directory is its fixture, outside the repository, so tsx is pointed at the repository's
    // tsconfig for the same source resolution `pnpm avn` gets from the repository root.
    const env: NodeJS.ProcessEnv = { ...process.env, AVN_HOME: home, AVN_OWNER: owner, AEVEN_TOKEN: aevenToken, AVN_BENCHMARK_PATCH: patch, TSX_TSCONFIG_PATH: join(repositoryRoot, 'tsconfig.json') }
    for (let run = 1; run <= options.runs; run++) {
      const directory = join(options.out, condition, `run-${run}`)
      const workspace = join(directory, 'workspace')
      mkdirSync(workspace, { recursive: true })
      const truth = task.fixture(workspace, 1000 + run)
      writeFileSync(join(directory, 'truth.json'), `${JSON.stringify(truth, null, 2)}\n`)
      const before = new Set(sessionLogs(home))
      const started = Date.now()
      process.stdout.write(`${condition} run ${run}/${options.runs}… `)
      const exitCode = await runOnce(task.prompt, workspace, env, options.timeoutMs, join(directory, 'avn'))
      const wallMs = Date.now() - started
      const log = sessionLogs(home).filter(path => !before.has(path)).at(-1)
      const result: RunResult = {
        condition,
        run,
        exitCode,
        wallMs,
        check: task.check(workspace, truth),
        ...log === undefined ? {} : { metrics: metricsOf(log) },
        capabilities: capabilitiesOf(home, owner),
      }
      results.push(result)
      console.log(`${result.check.passed ? 'correct' : 'WRONG'} · ${result.metrics ? `${(result.metrics.durationMs / 1000).toFixed(0)}s · ${result.metrics.toolCalls} tool calls · ${((result.metrics.inputTokens + result.metrics.outputTokens) / 1000).toFixed(1)}K tokens${result.metrics.loaded.length ? ` · used ${result.metrics.loaded.join(', ')}` : ''}` : 'no session log'}`)
      writeFileSync(join(options.out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`)
    }
  }
  const markdown = report(options, results)
  writeFileSync(join(options.out, 'report.md'), markdown)
  console.log(`\n${markdown}`)
}

await main()
