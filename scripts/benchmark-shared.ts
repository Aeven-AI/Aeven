/** Shared launch, log-reading, and summary operations for the learning and memory benchmarks. */
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cliEntry = fileURLToPath(new URL('../apps/cli/src/bin.ts', import.meta.url))
const tsxEsm = import.meta.resolve('tsx/esm')

/**
 * Read all frames in one compressed session log.
 * @param logPath - compressed JSONL path.
 * @returns nonempty JSONL rows.
 */
export function sessionLogLines(logPath: string): string[] {
  return execFileSync('zstd', ['-dc', logPath], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8').split('\n').filter(Boolean)
}

/**
 * Resolve common benchmark model and timeout options.
 * @param value - command-line option lookup.
 * @returns model settings and the run deadline.
 */
export function benchmarkModelOptions(value: (flag: string) => string | undefined) {
  return {
    timeoutMs: Number(value('--timeout-min') ?? 10) * 60_000,
    provider: value('--provider') ?? 'aeven-cloud',
    model: value('--model') ?? 'Aeven-1.0-Flash',
    effort: value('--effort') ?? 'high',
  }
}

/**
 * Execute a benchmark prompt through the source headless profile and collect both output streams.
 * @param prompt - task input.
 * @param workspace - working directory.
 * @param env - benchmark home, credentials, and patch environment.
 * @param timeoutMs - deadline before terminating the child.
 * @returns exit code and captured output after the child closes.
 */
export function runBenchmarkPrompt(
  prompt: string,
  workspace: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ code: number | null; output: Buffer }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', tsxEsm, cliEntry, '--profile', 'headless', '--patch', env['AVN_BENCHMARK_PATCH'] ?? '', prompt], { cwd: workspace, env })
    const output: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk))
    const timer = setTimeout(() => { child.kill('SIGKILL') }, timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output: Buffer.concat(output) })
    })
  })
}

/**
 * Calculate the central sample, averaging the middle pair for an even-sized set.
 * @param values - numeric samples.
 * @returns the median, or NaN for an empty set.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] ?? Number.NaN : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}
