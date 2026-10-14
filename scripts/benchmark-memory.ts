/**
 * Memory benchmark: does long-term memory let an agent use, update, and reason over what earlier sessions taught it?
 *
 * The capability benchmark in `benchmark-learning.ts` measures a procedure the agent gets faster at. This one
 * measures memory quality, on the abilities the field's benchmarks agree on. [LongMemEval](https://github.com/xiaowu0162/LongMemEval)
 * (ICLR 2025) names five core long-term-memory abilities — information extraction, multi-session reasoning,
 * temporal reasoning, knowledge updates, and abstention — and [MemoryAgentBench](https://arxiv.org/abs/2507.05224)
 * (ICLR 2026) stresses that memory agents accumulate information *incrementally across sessions*, so a valid
 * probe runs in a later session than the material it needs. This suite therefore teaches across two sessions,
 * then probes each ability from a fresh session, against a control with no memory mounted at all.
 *
 * Abilities, each scored against values this script generated and never wrote to disk:
 * - `extraction` — a fact stated in the first session is produced in a later one.
 * - `multi-session` — an answer built from a fact stated in the first session and one stated in the second.
 * - `temporal` — the event stated after another one, which the prompt does not name, is recovered.
 * - `update` — a later correction supersedes the value it replaced.
 * - `abstention` — a value never stated is answered `null` rather than confabulated.
 * - `compliance` — a release-naming convention stated in the first session is applied to a release name the probe
 *   prompt states, so the answer is the recalled convention plus the channel only memory holds.
 *
 * Conditions differ in nothing but the memory system:
 * - `recall-off`: no memory slot, no provider, no recall, no memory tools.
 * - `recall-on`: `@aeven/memory`, `@aeven/memory-memos`, `@aeven/memory-context`, `@aeven/tool-memory`.
 *
 * Leak controls. A generated value exists only in this process's memory, so any appearance of one on disk or in
 * a tool result is a leak, and each control marks the run `leaked` instead of letting it count:
 * - every session log is deleted after each phase, so a later session cannot read an earlier transcript;
 * - every teaching output is withheld until the round's probes have finished, because it quotes the values;
 * - any workspace file holding a value is reported and removed between phases;
 * - every probe runs in its own copy of the taught home, because probes sharing one home write their own prompts
 *   and recall blocks into that home's session projection cache, where the others can read them;
 * - a probe whose own session log shows a value it has to recall arriving inside a tool result is marked `leaked`,
 *   unless the value came from the memory system itself — out of its store, or in a result from a memory tool —
 *   because that is the system under test rather than a leak. Only the values each probe must recall are watched:
 *   a probe that reads another probe's prompt finds the value its own prompt already states, and the arm that
 *   answers from memory is the only one that can put a required value on disk.
 *
 * Cost and latency are the harness's own accounting, read back from each probe's session log: the turn boundaries
 * from `turn/start` and `turn/end`, and the tokens from the `usage` record the log carries on each assistant
 * message, folded the way `@aeven/token-meter` reads them. Nothing here is estimated from characters.
 *
 * Usage:
 *   AEVEN_EMAIL=… AEVEN_PASSWORD=… pnpm run benchmark:memory -- --runs 2
 *   AEVEN_TOKEN=… AVN_OWNER=… pnpm run benchmark:memory
 *
 * Options: --runs <n> (default 2, one round per run), --conditions recall-off,recall-on, --abilities <a,b> (default
 * all six, so `--abilities compliance` is a fast smoke test), --out <dir>, --timeout-min <n> (default 10),
 * --provider/--model/--effort (default aeven-cloud / Aeven-1.0-Flash / high).
 * Writes `results.json` and `report.md` to the output directory and prints the report. Needs the `zstd` and
 * `sqlite3` CLIs.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { benchmarkModelOptions, median, runBenchmarkPrompt, sessionLogLines } from './benchmark-shared.ts'
import { toolResultFailed } from './benchmark-tool-results.ts'

type Condition = 'recall-off' | 'recall-on'

/** One ability of the suite: LongMemEval's five, plus the compliance arm. */
type Ability = 'extraction' | 'multi-session' | 'temporal' | 'update' | 'abstention' | 'compliance' | 'prior-session'

/** How a probe is judged. `abstained` is a correct non-answer where `abstention` is the ability under test. */
type Verdict = 'correct' | 'wrong' | 'abstained' | 'leaked' | 'missing'

/** Where a probe obtained a value it could only have read rather than recalled. */
type LeakSource = 'workspace-file' | 'tool-output' | null

interface Options {
  readonly runs: number
  readonly conditions: readonly Condition[]
  /** Abilities to probe; a single one makes a fast smoke test. */
  readonly abilities: readonly Ability[]
  readonly out: string
  readonly timeoutMs: number
  readonly provider: string
  readonly model: string
  readonly effort: string
}

/** The values one round teaches. Generated per round, shared by both conditions so the arms are comparable. */
interface Facts {
  readonly channel: string
  readonly salt: string
  readonly regionBefore: string
  readonly regionAfter: string
  readonly firstRelease: string
  readonly secondRelease: string
  readonly codename: string
}

/** One model turn of a probe session, folded from the log's own turn boundaries and token usage records. */
interface TurnMetrics {
  /** `turn/end` time minus `turn/start` time; `null` for a turn the log never closed. */
  readonly latencyMs: number | null
  /** Billed prompt tokens of the turn's requests; 0 for a turn the adapter reported no usage for. */
  readonly inputTokens: number
  readonly outputTokens: number
}

interface RunMetrics {
  readonly durationMs: number
  /** The session's turns in log order, which are the report's per-turn cost and latency samples. */
  readonly turns: readonly TurnMetrics[]
  readonly toolCalls: number
  readonly failedToolCalls: number
  /** Billed prompt tokens over the whole session; the sum of `turns`. */
  readonly inputTokens: number
  readonly outputTokens: number
  /** Whether this probe received a recalled `<memory_context>` block. */
  readonly recalled: boolean
  /** Characters in that block, when one arrived. */
  readonly recalledChars: number
}

/** The `usage` fields a log records on an assistant message: the subset of `@aeven/llm`'s `TokenUsage` read here. */
interface UsageRecord {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}

interface ProbeResult {
  readonly condition: Condition
  readonly round: number
  readonly ability: Ability
  readonly verdict: Verdict
  readonly expected: string
  /** What the probe wrote, for a report reader to see what went wrong. */
  readonly answered: string | null
  /** The plausible wrong answer for this probe, when it declares one; `null` for a probe with no natural default. */
  readonly plausibleGuess: string | null
  readonly leakSource: LeakSource
  readonly exitCode: number | null
  /** This probe's own session wall clock; probes run concurrently, so this is not the round's wall clock. */
  readonly wallMs: number
  /** Wall clock of the round's whole concurrent probe batch, for context on `wallMs`. */
  readonly batchWallMs: number
  readonly metrics?: RunMetrics
}

/** Every ability of the suite, in report order. */
const ABILITIES: readonly Ability[] = ['extraction', 'multi-session', 'temporal', 'update', 'abstention', 'compliance', 'prior-session']

/** The answer file name pattern; probes run concurrently, so each ability writes its own file. */
const ANSWER_FILE_PATTERN = /^probe-[a-z-]+-[a-z0-9]{4,}\.json$/

/**
 * Each probe writes an answer file whose name carries a per-round nonce. The nonce is what makes a session log
 * attributable: a probe that lists the workspace sees every other probe's file name, so a name without a nonce
 * matches more than one session.
 * @param ability - the probe's ability.
 * @param nonce - the round's per-ability nonce.
 * @returns the answer file name for that probe.
 */
function answerFile(ability: Ability, nonce: string): string {
  return `probe-${ability}-${nonce}.json`
}

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

/** A fresh token per round; short, lowercase, and outside any language model's priors. */
function token(prefix: string): string {
  return `${prefix}-${Math.floor(Math.random() * 0x7fffffff).toString(36)}`
}

function factsFor(): Facts {
  return {
    channel: token('zeta'),
    salt: token('salt'),
    regionBefore: token('region'),
    regionAfter: token('omega'),
    firstRelease: token('aurora'),
    secondRelease: token('borealis'),
    codename: token('kestrel'),
  }
}

/** The first teaching session states four facts and one convention: extraction, multi-session, temporal, update, compliance. */
function teachPrompt(facts: Facts): string {
  return [
    'Project notes for this workspace. Read them and acknowledge in one short sentence.',
    'Do not create, modify, or delete any file, and do not write these values anywhere.',
    `- The deployment release channel is "${facts.channel}".`,
    `- The release checksum salt is "${facts.salt}".`,
    `- Release "${facts.firstRelease}" shipped before release "${facts.secondRelease}".`,
    `- The release codename is "${facts.codename}".`,
    `- The deployment region is "${facts.regionBefore}".`,
    '- Workspace convention: the "tagged" answer field names a release as the deployment release channel, a slash,',
    '  then the release name.',
  ].join('\n')
}

/** The second teaching session supersedes one value, which is what the update probe measures. */
function updatePrompt(facts: Facts): string {
  return [
    `Project note for this workspace: the deployment region changed to "${facts.regionAfter}", which replaces "${facts.regionBefore}".`,
    'Acknowledge in one short sentence.',
    'Do not create, modify, or delete any file, and do not write these values anywhere.',
  ].join('\n')
}

/** One probe: what it asks for, and the value a correct answer holds. */
interface Probe {
  readonly ability: Ability
  readonly field: string
  /** The field's meaning, as the probe prompt states it. */
  readonly describe: (facts: Facts) => string
  /** The value a correct answer holds; `null` where the correct answer is an honest non-answer. */
  readonly expected: (facts: Facts) => string | null
  /**
   * The values this probe has to recall, which are the ones a leak scan watches for it. A value the probe's own
   * prompt states is not one of them: the prompt may name what the answer is about without saying which it is, and
   * a value it merely quotes cannot be the answer it needs.
   */
  readonly required: (facts: Facts) => readonly string[]
  /**
   * A wrong answer an agent that did not recall this probe's material would plausibly give instead of abstaining.
   * The report labels such an answer `guessed`, which separates a wrong default from a wrong recall.
   */
  readonly plausibleGuess?: (facts: Facts) => string | null
}

const PROBES: readonly Probe[] = [
  {
    ability: 'extraction',
    field: 'channel',
    describe: () => 'this project\'s deployment release channel',
    expected: facts => facts.channel,
    required: facts => [facts.channel],
  },
  {
    ability: 'multi-session',
    field: 'tag',
    describe: () => 'the deployment release channel, then a hyphen, then the release checksum salt',
    expected: facts => `${facts.channel}-${facts.salt}`,
    required: facts => [facts.channel, facts.salt],
  },
  {
    ability: 'temporal',
    field: 'after',
    describe: facts => `which release shipped immediately after "${facts.firstRelease}"`,
    expected: facts => facts.secondRelease,
    // The prompt states the earlier release only, so the answer is a value no probe prompt and no disk file holds.
    required: facts => [facts.secondRelease],
  },
  {
    ability: 'update',
    field: 'region',
    describe: () => 'this project\'s current deployment region',
    expected: facts => facts.regionAfter,
    required: facts => [facts.regionAfter],
    // The superseded region: recall of the first session without the correction reads it as current.
    plausibleGuess: facts => facts.regionBefore,
  },
  {
    ability: 'prior-session',
    field: 'codename',
    describe: () => 'the release codename stated in an earlier session of this workspace',
    expected: facts => facts.codename,
    required: facts => [facts.codename],
    // A round's codename is a fresh token, so an agent that never read the earlier session has nothing to guess.
  },
  {
    ability: 'abstention',
    field: 'owner',
    describe: () => 'the name of this project\'s release owner, which was never stated',
    expected: () => null,
    // The correct answer is an honest non-answer, so no value can leak it.
    required: () => [],
  },
  {
    ability: 'compliance',
    field: 'tagged',
    describe: facts => `the release "${facts.firstRelease}" written in this workspace's "tagged" form`,
    expected: facts => `${facts.channel}/${facts.firstRelease}`,
    // The prompt supplies the release name; the channel and the convention are what memory has to hold.
    required: facts => [facts.channel],
    // The release name alone: what the prompt itself supplies, without the recalled channel or convention.
    plausibleGuess: facts => facts.firstRelease,
  },
]

function probePrompt(probe: Probe, facts: Facts, nonce: string, answers: string): string {
  return [
    `Write ${join(answers, answerFile(probe.ability, nonce))} containing exactly one JSON field:`,
    `{"${probe.field}": "<${probe.describe(facts)}>"}`,
    'Use the real value if you know it. If you do not know it, use null. Do not guess.',
  ].join('\n')
}

function parseOptions(argv: readonly string[]): Options {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  const runs = Number(value('--runs') ?? 2)
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer')
  const conditions = (value('--conditions') ?? 'recall-off,recall-on').split(',').map(part => part.trim())
  for (const condition of conditions) {
    if (condition !== 'recall-off' && condition !== 'recall-on') throw new Error(`unknown condition: ${condition}`)
  }
  const abilities = (value('--abilities') ?? ABILITIES.join(',')).split(',').map(part => part.trim())
  for (const ability of abilities) {
    if (!ABILITIES.includes(ability as Ability)) throw new Error(`unknown ability: ${ability}`)
  }
  return {
    runs,
    conditions: conditions as readonly Condition[],
    abilities: abilities as readonly Ability[],
    out: value('--out') ?? join(tmpdir(), `aeven-memory-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}`),
    ...benchmarkModelOptions(value),
  }
}

/** Sign in, or take an operator token, and report the owner every memory scope is keyed by. */
async function credentials(): Promise<{ token: string; owner: string }> {
  let token = process.env['AEVEN_TOKEN']
  if (!token) {
    const email = process.env['AEVEN_EMAIL']
    const password = process.env['AEVEN_PASSWORD']
    if (!email || !password) throw new Error('set AEVEN_TOKEN, or AEVEN_EMAIL and AEVEN_PASSWORD to sign in')
    const response = await fetch(`${process.env['AEVEN_API_URL'] ?? 'http://localhost:9000'}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!response.ok) throw new Error(`sign-in failed: HTTP ${response.status}`)
    const body = (await response.json()) as { accessToken?: unknown }
    if (typeof body.accessToken !== 'string') throw new Error('sign-in answered no access token')
    token = body.accessToken
  }
  const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { userId?: unknown }
  const owner = process.env['AVN_OWNER'] ?? (typeof claims.userId === 'string' ? claims.userId : undefined)
  if (owner === undefined) throw new Error('the token names no userId; set AVN_OWNER')
  return { token, owner }
}

function sessionLogs(home: string): string[] {
  const root = join(home, 'sessions')
  if (!existsSync(root)) return []
  return readdirSync(root).flatMap(workspace =>
    readdirSync(join(root, workspace))
      .map(session => join(root, workspace, session, 'session.jsonl.zstd'))
      .filter(existsSync))
}

/** Home entries a run needs; everything else can carry an earlier session's text and is removed between phases. */
const HOME_KEEP = new Set(['settings.yaml', 'profiles', 'memory', '.anonymous-user-id'])

/**
 * Remove every home store that can carry an earlier session's text. Deleting only `sessions/` is not enough:
 * the session projection cache under `storages/` keeps message text, and a probe that greps the home would read
 * the answer instead of recalling it.
 * @param home - the condition's throwaway Aeven home.
 * @returns the number of entries removed.
 */
function purgeTranscripts(home: string): number {
  let removed = 0
  for (const entry of readdirSync(home, { withFileTypes: true })) {
    if (HOME_KEEP.has(entry.name)) continue
    rmSync(join(home, entry.name), { recursive: true, force: true })
    removed++
  }
  return removed
}

/** Any file in the home, outside the memory store, still holding one of the generated values. */
function homeResidue(home: string, values: readonly string[]): string[] {
  const roots = readdirSync(home, { withFileTypes: true })
    .filter(entry => entry.name !== 'memory' && entry.isDirectory())
    .map(entry => join(home, entry.name))
  return roots.flatMap(root => filesWithValues(root, values))
}

/** Traces stored in MemOS, used to wait for a teaching session's capture instead of sleeping a guessed interval. */
function traceCount(home: string): number {
  const db = join(home, 'memory', 'data', 'memos.db')
  if (!existsSync(db)) return 0
  try {
    return Number(execFileSync('sqlite3', [db, 'select count(*) from traces;'], { encoding: 'utf8' }).trim())
  } catch {
    return 0
  }
}

async function waitForCapture(home: string, before: number, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const now = traceCount(home)
    if (now > before) return now
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return traceCount(home)
}

/**
 * Billed prompt tokens of one usage record, by the rule `@aeven/token-meter` applies: `inputTokens` counts uncached
 * prompt input, the cache buckets are additive, and `totalTokens`, when the adapter reported it, is the exact
 * aggregate prompt plus output total for the call.
 * @param usage - the record as logged, or `undefined` when the adapter reported none.
 * @returns the prompt tokens the request was billed for.
 */
function promptTokensOf(usage: UsageRecord | undefined): number {
  if (usage === undefined) return 0
  if (typeof usage.totalTokens === 'number') return Math.max(usage.totalTokens - usage.outputTokens, 0)
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

function metricsOf(logPath: string): RunMetrics {
  const lines = sessionLogLines(logPath)
  let started: number | undefined
  let ended: number | undefined
  let toolCalls = 0
  let failedToolCalls = 0
  let inputTokens = 0
  let outputTokens = 0
  let recalled = false
  let recalledChars = 0
  // Turn boundaries and usage are folded together: each turn's tokens are the usage its own steps logged, so a
  // multi-step turn is one sample rather than one per model call.
  const turns: { start: number; latencyMs: number | null; inputTokens: number; outputTokens: number }[] = []
  const open = new Map<number, (typeof turns)[number]>()
  for (const line of lines) {
    const event = JSON.parse(line) as { type?: string; time?: number; data?: Record<string, unknown> }
    const data = event.data ?? {}
    const turn = data['turn']
    switch (event.type) {
      case 'turn/start':
        started ??= event.time
        if (typeof turn === 'number' && typeof event.time === 'number') {
          const entry = { start: event.time, latencyMs: null, inputTokens: 0, outputTokens: 0 }
          turns.push(entry)
          open.set(turn, entry)
        }
        break
      case 'turn/end': {
        ended = event.time
        const current = typeof turn === 'number' ? open.get(turn) : undefined
        if (current !== undefined && typeof event.time === 'number') current.latencyMs = event.time - current.start
        break
      }
      case 'tool/call':
        toolCalls++
        break
      case 'tool/result': {
        if (toolResultFailed(data)) failedToolCalls++
        break
      }
      case 'assistant/message': {
        const usage = data['usage'] as UsageRecord | undefined
        const input = promptTokensOf(usage)
        const output = usage?.outputTokens ?? 0
        inputTokens += input
        outputTokens += output
        const current = typeof turn === 'number' ? open.get(turn) : undefined
        if (current !== undefined) {
          current.inputTokens += input
          current.outputTokens += output
        }
        break
      }
      case 'user/message': {
        const source = data['source'] as { plugin?: unknown } | undefined
        if (source?.plugin !== 'memory-context') break
        const content = data['content'] as { text?: string }[] | undefined
        recalled = true
        recalledChars = (content ?? []).reduce((total, part) => total + (part.text?.length ?? 0), 0)
        break
      }
      default:
        break
    }
  }
  return {
    durationMs: (ended ?? 0) - (started ?? 0),
    turns: turns.map(turn => ({ latencyMs: turn.latencyMs, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens })),
    toolCalls,
    failedToolCalls,
    inputTokens,
    outputTokens,
    recalled,
    recalledChars,
  }
}

/** Every regular file under `root` except the probe answer, which holds an answer by design. */
function filesUnder(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return filesUnder(path)
    if (!entry.isFile() || ANSWER_FILE_PATTERN.test(entry.name)) return []
    return [path]
  })
}

/** Files other than the answer that hold one of the generated values. */
function filesWithValues(root: string, values: readonly string[]): string[] {
  return filesUnder(root).filter((path) => {
    if (statSync(path).size > 4 * 1024 * 1024) return false
    try {
      const text = readFileSync(path, 'utf8')
      return values.some(value => text.includes(value))
    } catch {
      return false
    }
  })
}

/** The values a probe could legitimately need; used for leak scans around that probe. */
function valuesOf(facts: Facts): string[] {
  return [facts.channel, facts.salt, facts.regionBefore, facts.regionAfter, facts.firstRelease, facts.secondRelease]
}

/**
 * Whether a session read one of the generated values out of a tool result rather than recalling it. The values
 * are generated here and written nowhere, so their appearance in tool output proves they came from disk. A
 * `write` call's own arguments are not tool results, so answering is not counted as reading.
 * @param logPath - the probe's own session log.
 * @param values - the values this probe has to recall, so a value its own prompt quotes is not watched.
 * @param ownStore - roots whose contents the memory system itself holds, in the probe's home and in the audit
 *   copy of it; a value read out of one was recalled, however the session reached for it. Empty when no memory
 *   system is mounted.
 * @returns the value read from disk, or `null` when the session produced it itself.
 */
function readFromToolOutput(logPath: string, values: readonly string[], ownStore: readonly string[]): string | null {
  const lines = sessionLogLines(logPath)
  // The rule is order-based: look at where a value first appears after the prompt. A tool result showing it means
  // the session read it from disk; a tool call, reasoning, or answer showing it means the session produced it,
  // which is what answering looks like. Prompt lines are skipped because a probe may quote the values it asks
  // about, and the agent learns them from memory rather than from that quote.
  const callNames = new Map<string, string>()
  let readOwnStore = false
  for (const line of lines) {
    if (line.startsWith('{"type":"tool/call"')) {
      const call = JSON.parse(line) as { data?: { callId?: string; name?: string } }
      if (call.data?.callId !== undefined && call.data.name !== undefined) callNames.set(call.data.callId, call.data.name)
    }
    if (ownStore.some(root => line.includes(root))) readOwnStore = true
    const hit = values.find(value => line.includes(value))
    if (hit === undefined) continue
    if (line.includes('"user/message"')) continue
    if (readOwnStore || recalledByMemoryTool(callNames, line)) return null
    return line.includes('"tool/result"') ? hit : null
  }
  return null
}

/**
 * Whether a tool result was produced by the memory seam. Values it returns are the memory system answering, which
 * is the behavior under test; every tool `@aeven/memory` exposes is named `memory_*`.
 * @param callNames - tool names by call id, in log order.
 * @param line - the log line holding the value.
 * @returns true when the result belongs to a memory tool call.
 */
function recalledByMemoryTool(callNames: ReadonlyMap<string, string>, line: string): boolean {
  if (!line.startsWith('{"type":"tool/result"')) return false
  const result = JSON.parse(line) as { data?: { message?: { source?: { callId?: string } } } }
  const name = callNames.get(result.data?.message?.source?.callId ?? '')
  return name !== undefined && name.startsWith('memory_')
}


/** The memory rows, mounted only for `recall-on`; the headless bundle composes no preset roster. */
function patchFor(condition: Condition, home: string): string {
  const rows = condition === 'recall-on' ? [
    '    - id: memory',
    "      name: '@aeven/memory'",
    '    - id: memory-memos',
    "      name: '@aeven/memory-memos'",
    '      config:',
    `        home: ${JSON.stringify(join(home, 'memory'))}`,
    '        viewer: false',
    '    - id: memory-context',
    "      name: '@aeven/memory-context'",
    '    - id: tool-memory',
    "      name: '@aeven/tool-memory'",
  ] : []
  return [
    '- insert:',
    ...rows,
    '    - id: logger-console',
    "      name: '@deepseek-ai/cordis-plugin-logger-console'",
    '',
  ].join('\n')
}

function readAnswer(answers: string, ability: Ability, nonce: string, field: string): string | null {
  const path = join(answers, answerFile(ability, nonce))
  if (!existsSync(path)) return 'missing'
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const value = parsed[field]
    if (value === null) return null
    return typeof value === 'string' ? value : 'missing'
  } catch {
    return 'missing'
  }
}

function verdictFor(
  answers: string,
  probe: Probe,
  facts: Facts,
  nonce: string,
  leakSource: LeakSource,
): { verdict: Verdict; answered: string | null } {
  const expected = probe.expected(facts)
  if (leakSource !== null) return { verdict: 'leaked', answered: null }
  const answered = readAnswer(answers, probe.ability, nonce, probe.field)
  if (answered === 'missing') return { verdict: 'missing', answered: null }
  if (answered === null) return { verdict: expected === null ? 'correct' : 'abstained', answered: null }
  return { verdict: answered === expected ? 'correct' : 'wrong', answered }
}

/** Remove every probe answer and any file holding a generated value, so a round starts from the same state. */
function clearAnswers(answers: string, facts: Facts): void {
  const written = readdirSync(answers).filter(name => ANSWER_FILE_PATTERN.test(name)).map(name => join(answers, name))
  for (const path of [...filesWithValues(answers, valuesOf(facts)), ...written]) {
    if (existsSync(path)) rmSync(path, { force: true })
  }
}


const seconds = (ms: number): string => Number.isFinite(ms) ? `${(ms / 1000).toFixed(0)}s` : '—'
const kilo = (value: number): string => Number.isFinite(value) ? `${(value / 1000).toFixed(1)}K` : '—'

/** The turn latencies a session logged; a turn the log never closed carries no interval to measure. */
function closedTurnLatencies(metrics: RunMetrics | undefined): number[] {
  return (metrics?.turns ?? []).flatMap(turn => turn.latencyMs === null ? [] : [turn.latencyMs])
}

/**
 * How a probe failed, in the report's terms. `guessed` is a wrong answer equal to the probe's plausible default,
 * which separates "recalled the wrong thing or nothing" from "answered the fallback a memoryless agent writes".
 * @param result - the scored probe.
 * @returns the failure-mode label, or `—` for a correct probe.
 */
function failureMode(result: ProbeResult): string {
  if (result.verdict === 'correct') return '—'
  if (result.verdict === 'wrong') return result.answered !== null && result.answered === result.plausibleGuess ? 'guessed' : 'other'
  return result.verdict === 'missing' ? 'no answer' : result.verdict
}

function report(options: Options, results: readonly ProbeResult[]): string {
  const abilities = options.abilities
  const lines = [
    '# Memory benchmark: can the agent use, update, and reason over what earlier sessions taught it?',
    '',
    'Each round teaches across two sessions, in one workspace, then probes each ability from a fresh session so the',
    'answer must come from memory rather than the live transcript. Every generated value is created in this process',
    'and written nowhere: teaching output is withheld until the round ends, every session log is deleted between',
    'sessions, and any workspace file holding a value is reported and removed.',
    '',
    'Abilities are LongMemEval\'s five core long-term-memory abilities (ICLR 2025) plus a compliance arm; the',
    'incremental multi-session shape follows MemoryAgentBench (ICLR 2026).',
    '',
    `Model ${options.provider}/${options.model} (${options.effort}), ${options.runs} round(s) per condition.`,
    '',
    'Verdicts: `correct`; `wrong` wrote another value; `abstained` wrote null where a value was expected;',
    '`leaked` read, from a file or a tool result, a value it had to recall; `missing` wrote no readable answer.',
    '',
    '## Ability matrix',
    '',
    'Each cell counts correct probes over probes attempted, across the rounds in the last column.',
    '',
    `| Ability | ${options.conditions.join(' | ')} | Rounds |`,
    `|---|${options.conditions.map(() => '---').join('|')}|---|`,
  ]
  for (const ability of abilities) {
    const cells = options.conditions.map((condition) => {
      const own = results.filter(result => result.condition === condition && result.ability === ability)
      const correct = own.filter(result => result.verdict === 'correct').length
      return own.length === 0 ? '—' : `${correct}/${own.length}`
    })
    const rounds = new Set(results.filter(result => result.ability === ability).map(result => result.round)).size
    lines.push(`| ${ability} | ${cells.join(' | ')} | ${rounds} |`)
  }
  const totals = options.conditions.map((condition) => {
    const own = results.filter(result => result.condition === condition)
    return `${own.filter(result => result.verdict === 'correct').length}/${own.length}`
  })
  lines.push(`| **all** | ${totals.join(' | ')} | ${options.runs} |`)
  lines.push('', '## Cost and latency per condition', '',
    'Every number is the harness\'s own accounting, read from each probe\'s session log: the wall clock of the probe\'s',
    'own session, the turn boundaries from `turn/start` and `turn/end`, and the tokens from the `usage` the log records',
    'on each assistant message (uncached prompt input plus the cache buckets, or the exact total when the adapter',
    'reported one). `Probes` is the wall-clock sample count, `Measured` the token and turn sample count, and every',
    'median covers the samples its own row states, across the rounds in that row.', '',
    '| Condition | Rounds | Probes | Measured | Median probe wall | Turns | Median turn wall | Median input tok/turn | Median output tok/turn | Median tokens/probe | Median tool calls | Recall delivered |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const condition of options.conditions) {
    const own = results.filter(result => result.condition === condition)
    const measured = own.flatMap(result => result.metrics === undefined ? [] : [result.metrics])
    const turns = measured.flatMap(m => m.turns)
    const rounds = new Set(own.map(result => result.round)).size
    lines.push([
      `| ${condition}`,
      `${rounds}`,
      `${own.length}`,
      `${measured.length}`,
      seconds(median(own.map(result => result.wallMs))),
      `${turns.length}`,
      seconds(median(measured.flatMap(closedTurnLatencies))),
      kilo(median(turns.map(turn => turn.inputTokens))),
      kilo(median(turns.map(turn => turn.outputTokens))),
      kilo(median(measured.map(m => m.inputTokens + m.outputTokens))),
      `${median(measured.map(m => m.toolCalls))}`,
      `${measured.filter(m => m.recalled).length}/${measured.length} |`,
    ].join(' | '))
  }
  lines.push('', '## Every probe', '',
    '`Probe wall` is that session alone; probes of a round run concurrently, and the round\'s own wall clock is',
    'recorded as `batchWallMs` in `results.json`. `Turn wall` is the median closed turn of that session.',
    '`Failure mode` names `guessed` when the answer is the probe\'s plausible default rather than a stray value.', '',
    '| Condition | Round | Ability | Verdict | Failure mode | Expected | Answered | Probe wall | Turns | Input tok | Output tok | Turn wall | Tool calls | Recall block |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const result of results) {
    const m = result.metrics
    lines.push(`| ${result.condition} | ${result.round} | ${result.ability} | ${result.verdict} | ${failureMode(result)} | ${result.expected} | ${result.answered ?? '—'} | ${seconds(result.wallMs)} | ${m?.turns.length ?? '—'} | ${m ? kilo(m.inputTokens) : '—'} | ${m ? kilo(m.outputTokens) : '—'} | ${seconds(median(closedTurnLatencies(m)))} | ${m?.toolCalls ?? '—'} | ${m ? (m.recalled ? `yes (${m.recalledChars} chars)` : 'no') : '—'} |`)
  }
  if (abilities.includes('compliance')) {
    lines.push('', '## The compliance arm', '',
      'The `compliance` probe asks whether a recalled instruction changes behaviour. Its prompt states the release',
      'name, and only the first teaching session states the form the answer must take: the deployment release channel,',
      'a slash, then the release name. An agent that recalls the releases but not the convention answers the bare name,',
      'so the arm separates "the instruction was not recalled or not applied" from "nothing was recalled at all".', '',
      'Pass condition: the answer file holds exactly `<channel>/<release>`, the channel recalled from memory and the',
      'release name as the prompt gives it. Anything else fails: the bare release name is `wrong` and reads `guessed`',
      'in the failure column, `null` is `abstained`, another value is `other`, and a value read from disk is `leaked`.',
      'A memoryless agent therefore cannot pass by guessing, because the channel half of the answer exists only in',
      'memory, and it cannot pass by echoing the prompt either.', '',
      '| Condition | Rounds | Probes | Passed | Guessed the default | Abstained | Other |',
      '|---|---|---|---|---|---|---|')
    for (const condition of options.conditions) {
      const own = results.filter(result => result.condition === condition && result.ability === 'compliance')
      const rounds = new Set(own.map(result => result.round)).size
      const count = (mode: string): number => own.filter(result => failureMode(result) === mode).length
      lines.push(`| ${condition} | ${rounds} | ${own.length} | ${count('—')} | ${count('guessed')} | ${count('abstained')} | ${own.length - count('—') - count('guessed') - count('abstained')} |`)
    }
  }
  lines.push('', '## What this measures', '',
    'The claim under test is that the memory system turns earlier sessions into usable knowledge. `recall-off` is the',
    'control: identical teaching sessions and identical probes, with no memory system mounted, so the difference',
    'between the columns is the memory system and nothing else.',
    '',
    '`Recall delivered` separates "memory was never delivered" from "memory was delivered and ignored" using each',
    'probe\'s own session log, which a cost-only comparison cannot do.',
    '',
    'Abilities this suite does not cover: MemoryAgentBench\'s *selective forgetting*, because the model has no tool',
    'to delete memory (`ctx.memory.forget` serves product surfaces only); and any ability needing long conversational',
    'history rather than stated facts.', '')
  return lines.join('\n')
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const { token, owner } = await credentials()
  mkdirSync(options.out, { recursive: true })
  console.log(`benchmark output: ${options.out}\nowner: ${owner}`)
  const results: ProbeResult[] = []
  for (let round = 1; round <= options.runs; round++) {
    const facts = factsFor()
    for (const condition of options.conditions) {
      const home = join(options.out, condition, `round-${round}`, 'home')
      const workspace = join(options.out, condition, `round-${round}`, 'workspace')
      // Answers live outside the workspace on purpose: one shared workspace is what makes project memory and
      // session search meaningful, but anything written inside it is visible to every concurrent probe, which
      // both leaks a value and makes a probe's own answer file look like a leak of itself.
      const answers = join(options.out, condition, `round-${round}`, 'answers')
      mkdirSync(home, { recursive: true })
      mkdirSync(workspace, { recursive: true })
      mkdirSync(answers, { recursive: true })
      const patch = join(options.out, condition, `round-${round}`, 'benchmark.cordis.patch.yml')
      writeFileSync(join(home, 'settings.yaml'), [
        'agent-default-model:',
        `  provider: ${options.provider}`,
        `  model: ${options.model}`,
        `  reasoningEffort: ${options.effort}`,
        'permission:',
        '  defaultPreset: danger-full-access',
        '',
      ].join('\n'))
      writeFileSync(patch, patchFor(condition, home))
      const env: NodeJS.ProcessEnv = { ...process.env, AVN_HOME: home, AVN_OWNER: owner, AEVEN_TOKEN: token, AVN_BENCHMARK_PATCH: patch, TSX_TSCONFIG_PATH: join(repositoryRoot, 'tsconfig.json') }
      const directory = join(options.out, condition, `round-${round}`)
      console.log(`\nround ${round} · ${condition}`)
      const teachings: { name: string; output: Buffer }[] = []
      for (const [name, prompt] of [['teach-1', teachPrompt(facts)], ['teach-2', updatePrompt(facts)]] as const) {
        const tracesBefore = traceCount(home)
        const teach = await runBenchmarkPrompt(prompt, workspace, env, options.timeoutMs)
        const tracesAfter = condition === 'recall-on' ? await waitForCapture(home, tracesBefore, 30_000) : tracesBefore
        teachings.push({ name, output: teach.output })
        purgeTranscripts(home)
        console.log(`  ${name}: exit ${teach.code} · traces ${tracesBefore}→${tracesAfter}`)
      }
      // Self-check: after the purge, nothing outside the memory store may still hold a generated value.
      const residue = homeResidue(home, valuesOf(facts))
      if (residue.length > 0) console.log(`  WARNING: ${residue.length} home file(s) still hold a value after the purge`)
      const teachLeaks = [...filesWithValues(workspace, valuesOf(facts)), ...residue]
      const probes = PROBES.filter(probe => options.abilities.includes(probe.ability))
      const nonces = new Map(probes.map(probe => [probe.ability, Math.random().toString(36).slice(2, 8)]))
      clearAnswers(answers, facts)
      // Probes run together over one workspace but never share a home: a probe's own session — its prompt when it
      // quotes a value, or the recall block that states one — lands in that home's session projection cache, where
      // every other probe still reading the home can find it. Each probe gets its own copy of the taught home
      // instead, so the only knowledge a probe can reach beyond the workspace is the memory store it was seeded
      // with.
      const batchStart = Date.now()
      const runs = await Promise.all(probes.map(async (probe) => {
        const probeHome = join(directory, 'homes', probe.ability)
        cpSync(home, probeHome, { recursive: true })
        const probePatch = join(directory, `probe-${probe.ability}.cordis.patch.yml`)
        writeFileSync(probePatch, patchFor(condition, probeHome))
        const probeEnv: NodeJS.ProcessEnv = { ...env, AVN_HOME: probeHome, AVN_BENCHMARK_PATCH: probePatch }
        const probeStart = Date.now()
        const run = await runBenchmarkPrompt(probePrompt(probe, facts, nonces.get(probe.ability) ?? '', answers), workspace, probeEnv, options.timeoutMs)
        return { run, wallMs: Date.now() - probeStart, home: probeHome }
      }))
      const batchWallMs = Date.now() - batchStart
      const prompts = new Map(probes.map(probe => [probe.ability, probePrompt(probe, facts, nonces.get(probe.ability) ?? '', answers)]))
      // A probe's session is identified by its own first user message, so a log is attributed to the probe whose
      // prompt it opens with and never by a file name a stray `ls` could copy between sessions.
      const logs = new Map<string, string>()
      const byPrompt = new Map<string, string>()
      for (const path of runs.flatMap(timed => sessionLogs(timed.home))) {
        const text = execFileSync('zstd', ['-dc', path], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8')
        for (const line of text.split('\n')) {
          if (!line.startsWith('{"type":"user/message"')) continue
          const event = JSON.parse(line) as { data?: { content?: { text?: string }[]; source?: { kind?: string } } }
          if (event.data?.source?.kind !== 'user') continue
          const said = event.data.content?.[0]?.text
          if (said !== undefined && !byPrompt.has(said)) byPrompt.set(said, path)
        }
      }
      for (const [ability, prompt] of prompts) {
        const path = byPrompt.get(prompt)
        if (path !== undefined) logs.set(ability, path)
      }
      if (logs.size < probes.length) console.log(`  WARNING: ${probes.length - logs.size} of ${probes.length} probe session(s) could not be attributed a log`)
      const leftovers = filesWithValues(workspace, valuesOf(facts))
      for (const [index, probe] of probes.entries()) {
        const timed = runs[index]
        const run = timed?.run
        const log = logs.get(probe.ability)
        writeFileSync(join(directory, `probe-${probe.ability}.log`), run?.output ?? Buffer.alloc(0))
        // Kept beside the probe so any verdict can be audited after the home is purged.
        if (log !== undefined) copyFileSync(log, join(directory, `probe-${probe.ability}.session.jsonl.zstd`))
        const read = log === undefined ? null : readFromToolOutput(log, probe.required(facts), condition === 'recall-on' ? [join(timed?.home ?? '', 'memory'), join(home, 'memory')] : [])
        const leakSource: LeakSource = teachLeaks.length > 0 || leftovers.length > 0
          ? 'workspace-file'
          : read === null ? null : 'tool-output'
        const { verdict, answered } = verdictFor(answers, probe, facts, nonces.get(probe.ability) ?? '', leakSource)
        const expected = probe.expected(facts)
        const result: ProbeResult = {
          condition,
          round,
          ability: probe.ability,
          verdict,
          expected: expected ?? 'null',
          answered,
          plausibleGuess: probe.plausibleGuess?.(facts) ?? null,
          leakSource,
          exitCode: run?.code ?? null,
          wallMs: timed?.wallMs ?? 0,
          batchWallMs,
          ...log === undefined ? {} : { metrics: metricsOf(log) },
        }
        results.push(result)
        console.log(`  probe ${probe.ability}: ${verdict} · recall ${result.metrics?.recalled ? 'yes' : 'no'} · ${(result.wallMs / 1000).toFixed(0)}s${leakSource === null ? '' : ` · LEAKED (${leakSource})`}`)
      }
      writeFileSync(join(options.out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`)
      // The probe homes hold a full session record each and no longer matter once their logs are copied out.
      rmSync(join(directory, 'homes'), { recursive: true, force: true })
      purgeTranscripts(home)
      // Withheld until the round's probes finished: they quote the values.
      for (const { name, output } of teachings) writeFileSync(join(directory, `${name}.log`), output)
    }
  }
  const markdown = report(options, results)
  writeFileSync(join(options.out, 'report.md'), markdown)
  console.log(`\n${markdown}`)
}

await main()
