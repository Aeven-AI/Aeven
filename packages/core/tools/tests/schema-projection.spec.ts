import { describe, expect, it } from 'vitest'
import { projectRenderableSchema } from '@aeven/tools/src/schema-projection.ts'
import { jsonSchemaToTs } from '@aeven/tools/src/ts-types.ts'
import { jsonSchemaToPy } from '@aeven/tools/src/py-types.ts'
import { assertSupportedJsonSchema } from '@aeven/tools/src/json-schema.ts'

/** A Telegram MCP `send_file` parameter schema as the server publishes it. */
const sendFile = {
  type: 'object',
  properties: {
    chat: { type: 'string', description: 'Chat id, @username, or part of the chat title.' },
    file: { type: 'string', description: 'Absolute local path, or a direct https URL to the file.' },
    caption: { type: 'string', maxLength: 1024 },
    parse_mode: { default: 'none', type: 'string', enum: ['none', 'markdown', 'html'] },
    reply_to: { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 },
  },
  required: ['chat', 'file'],
  $schema: 'http://json-schema.org/draft-07/schema#',
}

describe('projectRenderableSchema', () => {
  it('returns a schema already in the subset unchanged', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }
    expect(projectRenderableSchema(schema)).toBe(schema)
  })

  it('keeps every property of an MCP schema and moves dropped constraints into hints', () => {
    expect(jsonSchemaToTs(sendFile)).toBe([
      '{',
      '  /** Chat id, @username, or part of the chat title. */',
      '  chat: string;',
      '  /** Absolute local path, or a direct https URL to the file. */',
      '  file: string;',
      '  /** (max length 1024) */',
      '  caption?: string;',
      '  /** (default "none") */',
      '  parse_mode?: "none" | "markdown" | "html";',
      '  /** (min -9007199254740991; max 9007199254740991) */',
      '  reply_to?: number;',
      '} & Record<string, JsonValue>',
    ].join('\n'))
  })

  it('maps type arrays, anyOf, nullable, and single-member allOf to unions', () => {
    expect(jsonSchemaToTs({ type: ['string', 'null'] })).toBe('string | null')
    expect(jsonSchemaToTs({ anyOf: [{ type: 'integer' }, { type: 'null' }] })).toBe('number | null')
    expect(jsonSchemaToTs({ type: 'string', nullable: true, format: 'date-time' })).toBe('string | null')
    expect(jsonSchemaToTs({ allOf: [{ type: 'boolean' }], description: 'Flag' })).toBe('boolean')
    expect(jsonSchemaToTs({ allOf: [{ type: 'boolean' }, { type: 'string' }] })).toBe('JsonValue')
    expect(jsonSchemaToTs({ anyOf: [{ type: 'string' }] })).toBe('string')
    expect(jsonSchemaToTs({ anyOf: [] })).toBe('JsonValue')
    expect(projectRenderableSchema({ type: ['string', 'null'], description: 'Name' })).toEqual({
      oneOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Name',
    })
  })

  it('resolves local references and stops at cycles', () => {
    const schema = {
      type: 'object',
      properties: {
        when: { $ref: '#/$defs/Time', description: 'Start' },
        tree: { $ref: '#/$defs/Node' },
        missing: { $ref: '#/$defs/Absent' },
        remote: { $ref: 'https://example.com/schema' },
        escaped: { $ref: '#/$defs/a~1b' },
      },
      $defs: {
        Time: { type: 'object', properties: { dateTime: { type: 'string', format: 'date-time' } }, required: ['dateTime'] },
        Node: { type: 'object', properties: { child: { $ref: '#/$defs/Node' } } },
        'a/b': { type: 'number' },
      },
    }
    expect(projectRenderableSchema(schema).properties).toEqual({
      when: {
        type: 'object',
        properties: { dateTime: { type: 'string', description: '(format "date-time")' } },
        required: ['dateTime'],
        description: 'Start',
      },
      tree: { type: 'object', properties: { child: {} } },
      missing: {},
      remote: {},
      escaped: { type: 'number' },
    })
    expect(projectRenderableSchema({ $ref: '#' })).toEqual({})
  })

  it('infers a type from literals, properties, or items when type is absent', () => {
    expect(jsonSchemaToTs({ enum: ['a', 'b'] })).toBe('"a" | "b"')
    expect(jsonSchemaToTs({ const: 3 })).toBe('3')
    expect(jsonSchemaToTs({ items: { type: 'string' } })).toBe('string[]')
    expect(jsonSchemaToTs({ properties: { a: { type: 'boolean' } } })).toBe('{\n  a?: boolean;\n} & Record<string, JsonValue>')
    expect(jsonSchemaToTs({ enum: ['a', 1] })).toBe('JsonValue')
  })

  it('drops literals that do not fit the declared type and repairs object keywords', () => {
    expect(jsonSchemaToTs({ type: 'string', enum: [1, 'x', 'x'], format: 'email' })).toBe('"x"')
    expect(jsonSchemaToTs({ type: 'string', enum: [1, 2] })).toBe('string')
    expect(jsonSchemaToTs({ type: 'integer', enum: [1, 2], const: 3, pattern: 'x' })).toBe('1 | 2')
    expect(jsonSchemaToTs({ type: 'boolean', const: true, uniqueItems: true })).toBe('true')
    expect(jsonSchemaToTs({ type: 'null', const: null, examples: [null] })).toBe('null')
    expect(jsonSchemaToTs({ type: 'number', const: 'x', minimum: 0 })).toBe('number')
    expect(projectRenderableSchema({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a', 'a', 'gone', 7],
      additionalProperties: { type: 'string' },
      patternProperties: {},
    })).toEqual({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] })
    expect(projectRenderableSchema({ type: 'object', properties: { a: { type: 'string' } }, required: 'a', additionalProperties: false, minProperties: 1 }))
      .toEqual({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false, description: '(min properties 1)' })
    expect(projectRenderableSchema({ type: 'array', items: [{ type: 'string' }], maxItems: 2 })).toEqual({ type: 'array', description: '(max items 2)' })
  })

  it('uses the title when there is no description and ignores non-scalar hint values', () => {
    expect(projectRenderableSchema({ type: 'string', title: 'Subject', maxLength: 10, default: { a: 1 } }))
      .toEqual({ type: 'string', description: 'Subject (max length 10)' })
    expect(projectRenderableSchema({ type: 'string', description: '  ', title: '', default: null, minLength: 1 }))
      .toEqual({ type: 'string', description: '(min length 1; default null)' })
  })

  it('widens non-schema values, excess depth, and unknown types to the unconstrained schema', () => {
    let deep: unknown = { type: 'string' }
    for (let index = 0; index < 40; index++) deep = { type: 'array', items: deep, minItems: 0 }
    const projected = projectRenderableSchema(deep)
    expect(() => { assertSupportedJsonSchema(projected) }).not.toThrow()
    expect(jsonSchemaToTs(deep)).toContain('JsonValue[]')
    for (const schema of [undefined, null, 42, 'string-schema', { type: 'float' }, { type: [] }, { oneOf: [] }]) {
      expect(jsonSchemaToTs(schema), JSON.stringify(schema)).toBe('JsonValue')
    }
  })

  it('drops annotations the renderers do not read and literals the subset rejects', () => {
    expect(projectRenderableSchema({ type: 'string', pattern: 'x', examples: [Number.NaN] })).toEqual({ type: 'string', description: '(pattern "x")' })
    expect(projectRenderableSchema({ type: 'number', const: -0, minimum: 0 })).toEqual({ type: 'number', description: '(min 0)' })
  })

  it('gives the Python SDK the same per-node degradation', () => {
    expect(jsonSchemaToPy({ type: ['string', 'null'] })).toBe('str | None')
    expect(jsonSchemaToPy({ type: 'integer', minimum: 0 })).toBe('int')
    expect(jsonSchemaToPy({ $ref: '#/nowhere' })).toBe('Any')
  })
})
