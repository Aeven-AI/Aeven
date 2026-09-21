/**
 * Reading semantic tool catalogs.
 *
 * OSWorld-MCP publishes, per application, a list of validated semantic operations
 * in OpenAI function-calling shape: a name, a description, and a parameter schema.
 * That is a different kind of evidence from a benchmark task. A task says *what a
 * user wanted*; a tool says *what an application can be asked to do*, with the
 * argument names already decided — which is exactly the vocabulary a recipe's
 * invocation and parameters need.
 *
 * So this is read as its own source rather than folded into the task records: one
 * describes intents, the other describes capabilities, and merging them would
 * blur which of the two a given claim came from.
 *
 * Measured on the published catalogs: 112 operations across LibreOffice Calc,
 * Writer and Impress, Chrome, VS Code, VLC, and OS utilities.
 *
 * @module @aeven/computer-use-tasks/tools
 */

/** One semantic operation an application exposes. */
export interface SemanticTool {
  /** Application family the catalog covers, e.g. `CalcTools`. */
  family: string
  /** The operation name without its family prefix, e.g. `set_cell_value`. */
  operation: string
  /** The source's own description, kept verbatim as evidence. */
  description: string
  /** Parameter names the operation declares. */
  parameters: readonly string[]
  /** Parameters the operation requires. */
  required: readonly string[]
}

/** One application's catalog, as read from a file. */
export interface ToolCatalog {
  /** The catalog file's basename, for traceability. */
  file: string
  /** The family its operations share. */
  family: string
  tools: readonly SemanticTool[]
}

/** The OpenAI function-calling shape these catalogs use. */
interface RawTool {
  function?: {
    name?: unknown
    description?: unknown
    parameters?: { properties?: unknown; required?: unknown }
  }
}

/**
 * Read one catalog file's contents.
 *
 * A file whose entries do not carry a dotted `function.name` is not a catalog, and
 * is reported as such rather than yielding an empty catalog that would look like
 * an application with no operations.
 * @param file - the catalog file's basename, for traceability.
 * @param json - the parsed file contents.
 * @returns the catalog, or a reason it is not one.
 */
export function readToolCatalog(file: string, json: unknown): { catalog?: ToolCatalog; reason?: string } {
  if (!Array.isArray(json)) {
    return { reason: 'not a JSON array of tool definitions' }
  }
  const tools: SemanticTool[] = []
  let family = ''
  for (const entry of json as RawTool[]) {
    const name = entry.function?.name
    if (typeof name !== 'string' || !name.includes('.')) {
      continue
    }
    const [prefix, operation] = name.split('.')
    /* v8 ignore next 3 -- unreachable: the dot above is required, and splitting a dotted name always yields both halves. */
    if (prefix === undefined || operation === undefined) {
      continue
    }
    if (family.length === 0) {
      family = prefix
    }
    const properties = entry.function?.parameters?.properties
    const required = entry.function?.parameters?.required
    tools.push({
      family: prefix,
      operation,
      description: typeof entry.function?.description === 'string' ? entry.function.description : '',
      parameters: typeof properties === 'object' && properties !== null ? Object.keys(properties) : [],
      required: Array.isArray(required) ? required.filter((value): value is string => typeof value === 'string') : [],
    })
  }
  if (tools.length === 0) {
    return { reason: 'no entry carried a dotted function name, so this is not a tool catalog' }
  }
  return { catalog: { file, family, tools } }
}

/**
 * Flatten catalogs into one operation list.
 * @param catalogs - the catalogs to flatten.
 * @returns every operation, in catalog order.
 */
export function allTools(catalogs: readonly ToolCatalog[]): SemanticTool[] {
  return catalogs.flatMap(catalog => [...catalog.tools])
}

/**
 * Group operations by family.
 * @param catalogs - the catalogs to group.
 * @returns family to its operations.
 */
export function groupByFamily(catalogs: readonly ToolCatalog[]): Map<string, SemanticTool[]> {
  const groups = new Map<string, SemanticTool[]>()
  for (const tool of allTools(catalogs)) {
    const existing = groups.get(tool.family)
    if (existing === undefined) {
      groups.set(tool.family, [tool])
    } else {
      existing.push(tool)
    }
  }
  return new Map([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)))
}
