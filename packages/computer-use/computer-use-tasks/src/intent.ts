/**
 * The canonical task-intent record, and the adapters that normalize each source
 * into it.
 *
 * Three public task sets describe desktop work in three different JSON shapes, but
 * they agree on what matters: an instruction in natural language, the applications
 * it concerns, how the environment is prepared, and what the result is checked
 * against. Normalizing them into one record is what makes them usable as a single
 * source of intents rather than three separate reading exercises.
 *
 * **What this is not.** A benchmark task is an *intent*, not a recipe. A recipe
 * declares one parameterized operation and how to verify it; a benchmark task
 * declares a goal, a prepared starting state, and an end-state check, and it is
 * reached through whatever UI sequence the agent invents. So the honest output
 * here is an **intent catalog** — domains, instructions, and the semantic
 * vocabulary that end-state checks reveal — from which recipes are curated by
 * hand. Claiming a mechanical translation from instruction text to an operation
 * would produce confident nonsense.
 *
 * @module @aeven/computer-use-tasks/intent
 */

/** Which benchmark a record came from. */
export type TaskSource = 'osworld' | 'macagentbench' | 'windowsagentarena'

/** One normalized task intent. */
export interface TaskIntent {
  source: TaskSource
  /** The source's own identifier, kept for traceability back to the original. */
  id: string
  /**
   * The instruction as written for an agent. Recorded verbatim: paraphrasing here
   * would destroy the only evidence of what the task actually asked for.
   */
  instruction: string
  /**
   * Applications the task concerns, as the source names them. Left in the source's
   * own vocabulary because mapping it to a bundle id is a curation decision, not a
   * mechanical one.
   */
  apps: readonly string[]
  /**
   * Names the source's end-state check exposes — evaluator functions, rule
   * functions, and any application-check helpers.
   *
   * This is the most valuable field in the record. A check named
   * `calendar_check_weekly_event` states the semantic end state directly, which is
   * precisely the vocabulary a recipe's verification needs.
   */
  checks: readonly string[]
  /** Whether the source ships a recorded trajectory for this task. */
  hasTrajectory: boolean
  /** Setup step types, which show what starting state a task assumes. */
  setupTypes: readonly string[]
}

/** Anything with a string `type`, which both setup steps and evaluator rules share. */
interface TypedStep {
  type?: unknown
  parameters?: unknown
}

/**
 * Read a string field, or the empty string when it is absent or not a string.
 * @param value - the value to inspect.
 * @returns the string, or `''`.
 */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Read a list of strings, dropping anything that is not one.
 *
 * A scalar string counts as a one-element list: the sources disagree on this for
 * the same field, with OSWorld writing `func` as a string where MacAgentBench
 * writes an array, so both must read as the same thing.
 * @param value - the value to inspect.
 * @returns the strings it contained.
 */
function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.length > 0 ? [value] : []
  }
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/**
 * Collect the `type` of each setup step.
 * @param config - the source's setup array.
 * @returns the step types, in order.
 */
function setupTypesOf(config: unknown): string[] {
  if (!Array.isArray(config)) {
    return []
  }
  return config
    .map(step => asString((step as TypedStep).type))
    .filter(type => type.length > 0)
}

/** The subset of a source's JSON this importer reads. */
interface RawTask {
  id?: unknown
  instruction?: unknown
  config?: unknown
  related_apps?: unknown
  trajectory?: unknown
  evaluator?: unknown
}

/**
 * Normalize an OSWorld-format task.
 *
 * WindowsAgentArena reuses this shape with a `-wos` suffix on ids, so one adapter
 * serves both; the caller says which source it is reading.
 * @param raw - the parsed task JSON.
 * @param source - which benchmark this file came from.
 * @returns the normalized intent.
 */
export function fromOsworld(raw: RawTask, source: TaskSource = 'osworld'): TaskIntent {
  const evaluator = (raw.evaluator ?? {}) as { func?: unknown, postconfig?: unknown }
  const checks = [...asStringArray(evaluator.func), ...setupTypesOf(evaluator.postconfig)]
  return {
    source,
    id: asString(raw.id),
    instruction: asString(raw.instruction),
    apps: asStringArray(raw.related_apps),
    checks,
    hasTrajectory: asString(raw.trajectory).length > 0,
    setupTypes: setupTypesOf(raw.config),
  }
}

/**
 * Normalize a MacAgentBench-format task.
 *
 * Its evaluator names check **functions** with parameters, which is the closest
 * thing in any of the three sources to a machine-readable statement of the end
 * state: `calendar_check_weekly_event` with an event name, an hour, and a weekday
 * says exactly what must be true afterwards.
 * @param raw - the parsed task JSON.
 * @returns the normalized intent.
 */
export function fromMacAgentBench(raw: RawTask): TaskIntent {
  const evaluator = (raw.evaluator ?? {}) as { func?: unknown, expected?: unknown }
  const expectedRules = Array.isArray(evaluator.expected)
    ? evaluator.expected.flatMap((entry) => {
      const rules = (entry as { rules?: { func?: unknown } }).rules
      return asString(rules?.func)
    })
    : []
  return {
    source: 'macagentbench',
    id: asString(raw.id),
    instruction: asString(raw.instruction),
    apps: asStringArray(raw.related_apps),
    checks: [...asStringArray(evaluator.func), ...expectedRules.filter(rule => rule.length > 0)],
    hasTrajectory: asString(raw.trajectory).length > 0,
    setupTypes: setupTypesOf(raw.config),
  }
}

/**
 * Group intents by the applications they concern.
 *
 * A task naming several applications appears under each, because that is how a
 * reader looking for "what is there for Pages" needs to find it.
 * @param intents - the intents to group.
 * @returns app name to the intents concerning it, sorted by app name.
 */
export function groupByApp(intents: readonly TaskIntent[]): Map<string, TaskIntent[]> {
  const groups = new Map<string, TaskIntent[]>()
  for (const intent of intents) {
    for (const app of intent.apps) {
      const existing = groups.get(app)
      if (existing === undefined) {
        groups.set(app, [intent])
      } else {
        existing.push(intent)
      }
    }
  }
  return new Map([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

/**
 * Group intents by their source, so a report can state where coverage comes from.
 * @param intents - the intents to group.
 * @returns source to count, in a stable order.
 */
export function countBySource(intents: readonly TaskIntent[]): Record<TaskSource, number> {
  const counts: Record<TaskSource, number> = { osworld: 0, macagentbench: 0, windowsagentarena: 0 }
  for (const intent of intents) {
    counts[intent.source] += 1
  }
  return counts
}

/**
 * Collect the end-state check vocabulary the sources expose.
 *
 * This is the catalog's highest-value output: a check name is a semantic statement
 * of what a task must achieve, so the set of them shows which end states the
 * sources collectively know how to verify — and therefore which recipes could be
 * given a real assertion rather than a file-exists stand-in.
 * @param intents - the intents to read.
 * @returns each distinct check name with the number of tasks using it.
 */
export function checkVocabulary(intents: readonly TaskIntent[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const intent of intents) {
    for (const check of intent.checks) {
      counts.set(check, (counts.get(check) ?? 0) + 1)
    }
  }
  return new Map([...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])))
}

/**
 * Render the catalog as markdown, so it can be reviewed and versioned rather than
 * only printed.
 * @param intents - the intents to render.
 * @param title - the document title.
 * @returns the markdown document.
 */
export function renderCatalog(intents: readonly TaskIntent[], title: string): string {
  const lines: string[] = [`# ${title}`, '']
  const bySource = countBySource(intents)
  lines.push(`${String(intents.length)} task intents, normalized from the source benchmarks.`)
  lines.push('')
  lines.push('| source | tasks |')
  lines.push('| --- | --- |')
  for (const [source, count] of Object.entries(bySource)) {
    if (count > 0) {
      lines.push(`| ${source} | ${String(count)} |`)
    }
  }
  lines.push('')
  lines.push('## Intents by application')
  lines.push('')
  for (const [app, group] of groupByApp(intents)) {
    lines.push(`### ${app} (${String(group.length)})`)
    lines.push('')
    for (const intent of group.slice(0, 25)) {
      const checks = intent.checks.length > 0 ? ` — checks: ${intent.checks.join(', ')}` : ''
      lines.push(`- \`${intent.source}/${intent.id}\` ${intent.instruction.split('\n')[0]}${checks}`)
    }
    if (group.length > 25) {
      lines.push(`- …and ${String(group.length - 25)} more`)
    }
    lines.push('')
  }
  lines.push('## End-state check vocabulary')
  lines.push('')
  lines.push('The named checks these sources expose: each is a semantic statement of what a')
  lines.push('task must achieve, and therefore a candidate assertion for a recipe.')
  lines.push('')
  lines.push('| check | tasks |')
  lines.push('| --- | --- |')
  for (const [check, count] of checkVocabulary(intents)) {
    lines.push(`| \`${check}\` | ${String(count)} |`)
  }
  lines.push('')
  return lines.join('\n')
}
