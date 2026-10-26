/**
 * Agent execution-efficiency benchmark: run a fixed task suite headless against
 * one or more Aeven source checkouts, read each run's session log, and compare
 * wall time, model time, steps, tool calls per step, guard refusals, and task
 * success between them.
 *
 * Each run gets a fresh fixture repository generated from `tasks.ts`, so runs
 * are independent and need no dependency install. A variant is an Aeven source
 * checkout (`name=path`), so a baseline is a worktree of an older commit with
 * its own `pnpm install`. Every run uses the deployment's default model route;
 * headless runs need `AEVEN_TOKEN` in the environment.
 *
 * Usage:
 *   tsx scripts/bench/agent-efficiency.ts --variant base=/path/to/old-aeven --variant new=. \
 *     [--runs 5] [--task small-fix] [--out bench.jsonl] [--timeout-ms 900000]
 *   tsx scripts/bench/agent-efficiency.ts --summarize bench.jsonl
 *   tsx scripts/bench/agent-efficiency.ts --measure <session.jsonl.zstd>...   (metrics of existing session logs)
 *
 * @module scripts/bench/agent-efficiency
 */

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { scanZstdFrames } from '../../packages/session/session-persistence-jsonl/src/zstd.ts'
import { TASKS, type BenchTask } from './tasks.ts'

/** One measured run, one JSONL line. */
interface RunRecord {
  variant: string
  task: string
  run: number
  success: boolean
  exitCode: number | null
  timedOut: boolean
  wallSeconds: number
  modelSeconds: number
  steps: number
  toolSteps: number
  toolCalls: number
  singleCallSteps: number
  firstBlockMedianSeconds: number | null
  outputTokens: number
  refusalsNotRead: number
  refusalsStale: number
  toolErrors: number
  sessionLog: string | null
}

interface Options {
  variants: { name: string; root: string }[]
  runs: number
  tasks: readonly BenchTask[]
  out: string
  timeoutMs: number
  workDir: string
}

const avnHome = process.env.AVN_HOME ?? join(homedir(), '.aeven')

/** Metrics of a run that left no session log. */
const EMPTY_METRICS = {
  modelSeconds: 0,
  steps: 0,
  toolSteps: 0,
  toolCalls: 0,
  singleCallSteps: 0,
  firstBlockMedianSeconds: null,
  outputTokens: 0,
  refusalsNotRead: 0,
  refusalsStale: 0,
  toolErrors: 0,
}

/** Parse argv into options; `--summarize` short-circuits to the report. */
function parseArgs(argv: string[]): Options | { summarize: string } {
  const variants: Options['variants'] = []
  const taskIds: string[] = []
  let runs = 5
  let out = resolve(`bench-agent-efficiency-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)
  let timeoutMs = 900_000
  let workDir = join(homedir(), '.cache', 'avn-bench')
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--summarize' && value !== undefined) return { summarize: resolve(value) }
    if (value === undefined) throw new Error(`${flag ?? ''} needs a value`)
    i++
    switch (flag) {
      case '--variant': {
        const at = value.indexOf('=')
        if (at <= 0) throw new Error('--variant takes name=path-to-aeven-checkout')
        const root = resolve(value.slice(at + 1))
        if (!existsSync(join(root, 'apps/cli/src/bin.ts'))) throw new Error(`${root} is not an Aeven source checkout`)
        variants.push({ name: value.slice(0, at), root })
        break
      }
      case '--runs': runs = Number.parseInt(value, 10); break
      case '--task': taskIds.push(value); break
      case '--out': out = resolve(value); break
      case '--timeout-ms': timeoutMs = Number.parseInt(value, 10); break
      case '--work-dir': workDir = resolve(value); break
      default: throw new Error(`unknown flag ${flag ?? ''}`)
    }
  }
  if (variants.length === 0) throw new Error('give at least one --variant name=path')
  if (!Number.isSafeInteger(runs) || runs <= 0) throw new Error('--runs must be a positive integer')
  const tasks = taskIds.length === 0 ? TASKS : taskIds.map((id) => {
    const task = TASKS.find(candidate => candidate.id === id)
    if (task === undefined) throw new Error(`unknown task ${id}; known: ${TASKS.map(t => t.id).join(', ')}`)
    return task
  })
  return { variants, runs, tasks, out, timeoutMs, workDir }
}

/** Write a task's fixture files and commit them, so the agent starts in a clean git repository. */
function createFixture(dir: string, task: BenchTask): void {
  rmSync(dir, { recursive: true, force: true })
  for (const [path, content] of Object.entries(task.files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@example.com', ...args], { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-qm', 'fixture')
}

/** Session-store directory name for a working directory, as the persistence layer spells it. */
function sessionDirName(cwd: string): string {
  return `-${cwd.replace(/[\\/]/g, '-')}--`
}

/** Locate the newest session log recorded for `cwd`. */
function findSessionLog(cwd: string): string | null {
  const dir = join(avnHome, 'sessions', sessionDirName(cwd))
  if (!existsSync(dir)) return null
  const logs = readdirSync(dir)
    .map(entry => join(dir, entry, 'session.jsonl.zstd'))
    .filter(path => existsSync(path))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return logs[0] ?? null
}

/** Read the text of a tool result's content blocks. */
function resultText(data: { message?: { content?: { content?: { type?: string; text?: string }[] }[] } }): string {
  return (data.message?.content ?? [])
    .flatMap(block => Array.isArray(block.content) ? block.content : [])
    .filter(inner => inner.type === 'text')
    .map(inner => inner.text ?? '')
    .join('\n')
}

/** Execution metrics from one session log. */
function measure(path: string): Omit<RunRecord, 'variant' | 'task' | 'run' | 'success' | 'exitCode' | 'timedOut' | 'wallSeconds' | 'sessionLog'> {
  // Session logs are appended as one Zstandard frame per write; decode every complete frame.
  const bytes = readFileSync(path)
  const lines = scanZstdFrames(bytes).frames
    .map(frame => zstdDecompressSync(bytes.subarray(frame.start, frame.end)).toString('utf8'))
    .join('')
    .split('\n')
  const starts = new Map<string, number>()
  const ends = new Map<string, number>()
  const firstChunk = new Map<string, number>()
  const calls = new Map<string, number>()
  let outputTokens = 0
  let refusalsNotRead = 0
  let refusalsStale = 0
  let toolErrors = 0
  for (const line of lines) {
    if (line.length === 0) continue
    let event: { type: string; time?: number; time0?: number; data?: Record<string, unknown> }
    try {
      event = JSON.parse(line) as typeof event
    } catch {
      // A torn final line from an interrupted run carries no complete event.
      continue
    }
    const data = event.data ?? {}
    const key = `${String(data.turn)}:${String(data.step)}`
    switch (event.type) {
      case 'step/start': starts.set(key, event.time ?? 0); break
      case 'assistant/message': ends.set(key, event.time ?? 0); break
      case 'assistant/chunk': {
        const chunk = data.chunk as { type?: string; usage?: { outputTokens?: number } } | undefined
        if (chunk?.type === 'usage') outputTokens += chunk.usage?.outputTokens ?? 0
        break
      }
      case 'reasoning-chunks':
      case 'tool-call-chunks':
      case 'text-chunks': {
        const at = event.time0 ?? 0
        firstChunk.set(key, Math.min(firstChunk.get(key) ?? at, at))
        break
      }
      case 'tool/call': calls.set(key, (calls.get(key) ?? 0) + 1); break
      case 'tool/result': {
        const message = data.message as { isError?: boolean; content?: { isError?: boolean }[] } | undefined
        if (message?.isError !== true && !(message?.content ?? []).some(block => block.isError === true)) break
        toolErrors++
        const text = resultText(data)
        if (/has not been read|FS_NOT_OBSERVED/.test(text)) refusalsNotRead++
        else if (/changed since it was read|FS_STALE_VERSION/.test(text)) refusalsStale++
        break
      }
      default: break
    }
  }
  const stepKeys = [...starts.keys()]
  const elapsed = (marks: Map<string, number>) => [...starts].flatMap(([key, start]) => {
    const at = marks.get(key)
    return at === undefined ? [] : [(at - start) / 1000]
  })
  const latencies = elapsed(firstChunk)
  const toolStepCounts = stepKeys.map(key => calls.get(key) ?? 0).filter(count => count > 0)
  return {
    modelSeconds: elapsed(ends).reduce((sum, seconds) => sum + seconds, 0),
    steps: stepKeys.length,
    toolSteps: toolStepCounts.length,
    toolCalls: toolStepCounts.reduce((sum, count) => sum + count, 0),
    singleCallSteps: toolStepCounts.filter(count => count === 1).length,
    firstBlockMedianSeconds: latencies.length === 0 ? null : median(latencies),
    outputTokens,
    refusalsNotRead,
    refusalsStale,
    toolErrors,
  }
}

/** Run one headless task to completion or timeout. */
function runHeadless(
  root: string,
  cwd: string,
  prompt: string,
  timeoutMs: number,
): Promise<{ exitCode: number | null; timedOut: boolean; seconds: number }> {
  const started = Date.now()
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [
      '--import', join(root, 'node_modules/tsx/dist/esm/index.mjs'),
      join(root, 'apps/cli/src/bin.ts'),
      '--profile', 'headless',
      prompt,
    ], { cwd, env: { ...process.env, TSX_TSCONFIG_PATH: join(root, 'tsconfig.base.json') }, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-4000) })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      if (exitCode !== 0 && !timedOut) process.stderr.write(`  avn exited ${String(exitCode)}: ${stderr.trim().split('\n').slice(-3).join(' | ')}\n`)
      resolveRun({ exitCode, timedOut, seconds: (Date.now() - started) / 1000 })
    })
  })
}

/** Run every variant × task × run, interleaving variants so drift in the model route affects all equally. */
async function bench(options: Options): Promise<void> {
  if (process.env.AEVEN_TOKEN === undefined || process.env.AEVEN_TOKEN === '') {
    throw new Error('headless runs need AEVEN_TOKEN in the environment')
  }
  mkdirSync(options.workDir, { recursive: true })
  const stamp = Date.now().toString(36)
  for (let run = 1; run <= options.runs; run++) {
    for (const task of options.tasks) {
      for (const variant of options.variants) {
        const cwd = join(options.workDir, `${stamp}-${variant.name}-${task.id}-${String(run)}`)
        createFixture(cwd, task)
        process.stderr.write(`[run ${String(run)}/${String(options.runs)}] ${variant.name} ${task.id}\n`)
        const outcome = await runHeadless(variant.root, cwd, task.prompt, options.timeoutMs)
        const [program = 'false', ...programArgs] = task.check
        const check = spawnSync(program, programArgs, { cwd, stdio: 'ignore', timeout: 120_000 })
        const sessionLog = findSessionLog(cwd)
        const metrics = sessionLog === null ? EMPTY_METRICS : measure(sessionLog)
        const record: RunRecord = {
          variant: variant.name,
          task: task.id,
          run,
          success: check.status === 0 && !outcome.timedOut,
          exitCode: outcome.exitCode,
          timedOut: outcome.timedOut,
          wallSeconds: outcome.seconds,
          ...metrics,
          sessionLog,
        }
        appendFileSync(options.out, `${JSON.stringify(record)}\n`)
        process.stderr.write(`  ${record.success ? 'ok' : 'FAILED'} ${record.wallSeconds.toFixed(0)}s, ${String(record.steps)} steps, ${String(record.toolCalls)} calls\n`)
      }
    }
  }
  process.stderr.write(`\nwrote ${options.out}\n\n`)
  summarize(options.out)
}

/** The element at `index` of a non-empty array, clamped into range. */
function pick(values: readonly number[], index: number): number {
  return values[Math.min(Math.max(index, 0), values.length - 1)] ?? Number.NaN
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? pick(sorted, mid) : (pick(sorted, mid - 1) + pick(sorted, mid)) / 2
}

/** 95% bootstrap interval of the difference in medians (b − a), with a fixed seed for repeatable reports. */
function bootstrapMedianDiff(a: number[], b: number[]): [number, number] {
  let seed = 0x9e3779b9
  const random = (): number => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    return (seed >>> 0) / 0x1_0000_0000
  }
  const sample = (values: number[]) => values.map(() => pick(values, Math.floor(random() * values.length)))
  const diffs: number[] = []
  for (let i = 0; i < 4000; i++) diffs.push(median(sample(b)) - median(sample(a)))
  diffs.sort((x, y) => x - y)
  return [pick(diffs, Math.floor(0.025 * diffs.length)), pick(diffs, Math.floor(0.975 * diffs.length))]
}

/** Print the per-variant, per-task table and the pairwise comparison. */
function summarize(path: string): void {
  const records = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as RunRecord)
  const variants = [...new Set(records.map(r => r.variant))]
  const tasks = [...new Set(records.map(r => r.task))]
  const row = (label: string, rs: RunRecord[]) => {
    const calls = rs.reduce((s, r) => s + r.toolCalls, 0)
    const toolSteps = rs.reduce((s, r) => s + r.toolSteps, 0)
    const single = rs.reduce((s, r) => s + r.singleCallSteps, 0)
    return [
      label,
      `${String(rs.filter(r => r.success).length)}/${String(rs.length)}`,
      median(rs.map(r => r.wallSeconds)).toFixed(0),
      median(rs.map(r => r.modelSeconds)).toFixed(0),
      median(rs.map(r => r.steps)).toFixed(0),
      (calls / Math.max(toolSteps, 1)).toFixed(2),
      `${(100 * single / Math.max(toolSteps, 1)).toFixed(0)}%`,
      String(rs.reduce((s, r) => s + r.refusalsNotRead, 0)),
      String(rs.reduce((s, r) => s + r.refusalsStale, 0)),
      String(rs.reduce((s, r) => s + r.toolErrors, 0)),
    ].join(' | ')
  }
  console.log('variant / task | success | wall s (median) | model s | steps | calls/tool-step | single-call | not-read | stale | tool errors')
  console.log('---|---|---|---|---|---|---|---|---|---')
  for (const task of tasks) {
    for (const variant of variants) console.log(row(`${variant} / ${task}`, records.filter(r => r.variant === variant && r.task === task)))
  }
  for (const variant of variants) console.log(row(`**${variant} / all**`, records.filter(r => r.variant === variant)))
  if (variants.length < 2) return
  const [base = '', ...others] = variants
  for (const other of others) {
    console.log(`\n${other} vs ${base} — difference in medians per task (negative = ${other} faster), 95% bootstrap interval:`)
    for (const task of tasks) {
      const a = records.filter(r => r.variant === base && r.task === task && r.success)
      const b = records.filter(r => r.variant === other && r.task === task && r.success)
      if (a.length < 2 || b.length < 2) {
        console.log(`  ${task}: too few successful runs (${String(a.length)} vs ${String(b.length)})`)
        continue
      }
      const wall = bootstrapMedianDiff(a.map(r => r.wallSeconds), b.map(r => r.wallSeconds))
      const steps = bootstrapMedianDiff(a.map(r => r.steps), b.map(r => r.steps))
      const verdict = wall[1] < 0 ? 'faster' : wall[0] > 0 ? 'slower' : 'no clear difference'
      console.log(`  ${task}: wall ${(median(b.map(r => r.wallSeconds)) - median(a.map(r => r.wallSeconds))).toFixed(0)}s [${wall[0].toFixed(0)}, ${wall[1].toFixed(0)}], steps ${(median(b.map(r => r.steps)) - median(a.map(r => r.steps))).toFixed(0)} [${steps[0].toFixed(0)}, ${steps[1].toFixed(0)}] → ${verdict}`)
    }
  }
}

const argv = process.argv.slice(2)
if (argv[0] === '--measure') {
  for (const path of argv.slice(1)) console.log(JSON.stringify({ sessionLog: path, ...measure(resolve(path)) }))
} else {
  const parsed = parseArgs(argv)
  if ('summarize' in parsed) summarize(parsed.summarize)
  else await bench(parsed)
}
