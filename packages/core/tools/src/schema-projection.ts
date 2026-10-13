/**
 * Prompt-only projection of an arbitrary JSON Schema onto the enforced subset
 * the SDK renderers accept. MCP servers publish full JSON Schema (type arrays,
 * `anyOf`, `$ref`, numeric and string constraints); the SDK renderers type only
 * the subset, so each unsupported node degrades on its own instead of the whole
 * tool rendering as `unknown`. Dropped constraints move into the node's
 * description as hints. The result is used for display only: argument
 * validation still runs against the tool's registered schema.
 * @module @aeven/tools/src/schema-projection
 */

import { assertSupportedJsonSchema, isJsonSchemaRecord, isPlainJsonArray } from './json-schema.ts'
import type { JsonSchemaNode, JsonSchemaScalar, JsonSchemaType } from './json-schema.ts'

/** Nesting depth past which a node projects to the unconstrained schema. */
const MAX_DEPTH = 32

/** Schema types whose values are scalars. */
type ScalarType = Exclude<JsonSchemaType, 'object' | 'array'>

const SCALAR_TYPES: readonly ScalarType[] = ['string', 'number', 'integer', 'boolean', 'null']
const SCHEMA_TYPES: readonly JsonSchemaType[] = ['object', 'array', ...SCALAR_TYPES]

/** Constraint keywords outside the subset, rendered as `label value` hints in the description. */
const HINT_LABELS: readonly (readonly [string, string])[] = [
  ['format', 'format'],
  ['pattern', 'pattern'],
  ['minimum', 'min'],
  ['exclusiveMinimum', 'greater than'],
  ['maximum', 'max'],
  ['exclusiveMaximum', 'less than'],
  ['multipleOf', 'multiple of'],
  ['minLength', 'min length'],
  ['maxLength', 'max length'],
  ['minItems', 'min items'],
  ['maxItems', 'max items'],
  ['uniqueItems', 'unique items'],
  ['minProperties', 'min properties'],
  ['maxProperties', 'max properties'],
  ['default', 'default'],
]

/** Walk state shared by one projection. */
interface ProjectionState {
  readonly root: unknown
  readonly activeRefs: Set<string>
}

/** Whether a value is a scalar the given schema type accepts. */
function scalarFits(type: ScalarType, value: unknown): value is JsonSchemaScalar {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
    case 'integer': return typeof value === 'number' && Number.isInteger(value) && !Object.is(value, -0)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
  }
}

/** The description of a node with its dropped constraints appended as hints. */
function describe(node: Record<string, unknown>): string | undefined {
  const base = typeof node.description === 'string' && node.description.trim() !== ''
    ? node.description.trim()
    : typeof node.title === 'string' && node.title.trim() !== '' ? node.title.trim() : undefined
  const hints: string[] = []
  for (const [keyword, label] of HINT_LABELS) {
    if (!Object.hasOwn(node, keyword)) continue
    const value = node[keyword]
    if (value === true) hints.push(label)
    else if (['string', 'number', 'boolean'].includes(typeof value) || value === null) hints.push(`${label} ${JSON.stringify(value)}`)
  }
  if (hints.length === 0) return base
  return base === undefined ? `(${hints.join('; ')})` : `${base} (${hints.join('; ')})`
}

/** Resolve a local JSON pointer (`#/$defs/x`, `#/definitions/x`) against the projected root. */
function resolvePointer(root: unknown, ref: string): unknown {
  if (ref === '#') return root
  if (!ref.startsWith('#/')) return undefined
  let current: unknown = root
  for (const raw of ref.slice(2).split('/')) {
    const key = decodeURIComponent(raw).replaceAll('~1', '/').replaceAll('~0', '~')
    if (!isJsonSchemaRecord(current) || !Object.hasOwn(current, key)) return undefined
    current = current[key]
  }
  return current
}

/** Attach a description to a projected node when one exists. */
function withDescription(node: JsonSchemaNode, description: string | undefined): JsonSchemaNode {
  return description === undefined ? node : { ...node, description }
}

/** A union node, collapsing zero or one branches. */
function union(branches: JsonSchemaNode[], description: string | undefined): JsonSchemaNode {
  if (branches.length === 0) return withDescription({}, description)
  if (branches.length === 1) return withDescription(branches[0] as JsonSchemaNode, description ?? branches[0]?.description)
  return withDescription({ oneOf: branches }, description)
}

/** Project one node of a single, known type. */
function projectTyped(node: Record<string, unknown>, type: JsonSchemaType, state: ProjectionState, depth: number): JsonSchemaNode {
  switch (type) {
    case 'object': {
      const projected: JsonSchemaNode = { type: 'object' }
      if (isJsonSchemaRecord(node.properties)) {
        const properties: Record<string, JsonSchemaNode> = {}
        for (const [name, child] of Object.entries(node.properties)) properties[name] = project(child, state, depth + 1)
        projected.properties = properties
        if (isPlainJsonArray(node.required)) {
          const required = node.required.filter((name): name is string => typeof name === 'string' && Object.hasOwn(properties, name))
          if (required.length > 0) projected.required = [...new Set(required)]
        }
      }
      if (node.additionalProperties === false) projected.additionalProperties = false
      return projected
    }
    case 'array':
      return isJsonSchemaRecord(node.items)
        ? { type: 'array', items: project(node.items, state, depth + 1) }
        : { type: 'array' }
    default: {
      const projected: JsonSchemaNode = { type }
      if (isPlainJsonArray(node.enum)) {
        const allowed = node.enum.filter(value => scalarFits(type, value))
        if (allowed.length > 0) projected.enum = [...new Set(allowed)]
      }
      if (Object.hasOwn(node, 'const') && scalarFits(type, node.const)
        && (projected.enum === undefined || projected.enum.includes(node.const))) {
        projected.const = node.const
      }
      return projected
    }
  }
}

/** The type a node without `type` implies through its other keywords. */
function impliedType(node: Record<string, unknown>): JsonSchemaType | undefined {
  if (isJsonSchemaRecord(node.properties)) return 'object'
  if (Object.hasOwn(node, 'items')) return 'array'
  const literals = isPlainJsonArray(node.enum) ? node.enum : Object.hasOwn(node, 'const') ? [node.const] : []
  return SCALAR_TYPES.find(type => literals.length > 0 && literals.every(value => scalarFits(type, value)))
}

/** Project one raw node; unsupported constructs become the unconstrained schema `{}`. */
function project(raw: unknown, state: ProjectionState, depth: number): JsonSchemaNode {
  if (!isJsonSchemaRecord(raw) || depth > MAX_DEPTH) return {}
  const description = describe(raw)

  if (typeof raw.$ref === 'string') {
    const ref = raw.$ref
    const target = resolvePointer(state.root, ref)
    if (target === undefined || state.activeRefs.has(ref)) return withDescription({}, description)
    state.activeRefs.add(ref)
    const resolved = project(target, state, depth + 1)
    state.activeRefs.delete(ref)
    return withDescription(resolved, description ?? resolved.description)
  }

  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const branches = raw[keyword]
    if (isPlainJsonArray(branches)) return union(branches.map(branch => project(branch, state, depth + 1)), description)
  }
  if (isPlainJsonArray(raw.allOf)) {
    // A single-member allOf is how generators attach a description to a $ref; wider intersections stay unconstrained.
    return raw.allOf.length === 1 ? union([project(raw.allOf[0], state, depth + 1)], description) : withDescription({}, description)
  }

  const declared = isPlainJsonArray(raw.type) ? raw.type : raw.type === undefined ? [] : [raw.type]
  const types = [...new Set(declared.filter((type): type is JsonSchemaType => SCHEMA_TYPES.includes(type as JsonSchemaType)))]
  if (types.length === 0) {
    const implied = impliedType(raw)
    if (implied !== undefined) types.push(implied)
  }
  if (raw.nullable === true && types.length > 0 && !types.includes('null')) types.push('null')
  const branches = types.map(type => projectTyped(raw, type, state, depth))
  return branches.length === 1 ? withDescription(branches[0] as JsonSchemaNode, description) : union(branches, description)
}

/**
 * Project any JSON Schema onto the SDK renderers' subset. A schema already in
 * the subset is returned unchanged; anything else is rebuilt node by node.
 * @param schema - a raw JSON Schema from a tool registration or MCP server.
 * @returns a schema in the subset: the projection emits only subset keywords
 *   with type-checked literals and string descriptions.
 */
export function projectRenderableSchema(schema: unknown): JsonSchemaNode {
  return inSubset(schema) ? schema : project(schema, { root: schema, activeRefs: new Set() }, 0)
}

/** Whether a schema already belongs to the enforced subset. */
function inSubset(schema: unknown): schema is JsonSchemaNode {
  try {
    assertSupportedJsonSchema(schema)
  } catch {
    // The assertion's JsonSchemaError is the "outside the subset" answer; it carries nothing else a caller needs.
    return false
  }
  return true
}
