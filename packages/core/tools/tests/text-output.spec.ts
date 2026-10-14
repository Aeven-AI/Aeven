import { describe, expect, it } from 'vitest'
import { defineTool, textOutput, textResult } from '../src/index.ts'

describe('the shared text-result output declaration', () => {
  it('compiles to the open object schema requiring the model-facing text', () => {
    const tool = defineTool({
      name: 'text_result_fixture',
      description: 'Return one block of text.',
      parameters: {},
      output: textOutput(),
      execute: async () => textResult({ text: 'done', count: 1 }),
    })
    expect(tool.output.schema).toEqual({
      type: 'object',
      additionalProperties: true,
      properties: { text: { type: 'string' } },
      required: ['text'],
    })
  })

  it('renders the value text as the sole block', () => {
    expect(textOutput().render({}, { text: 'hello', count: 1 }))
      .toEqual([{ type: 'text', text: 'hello' }])
  })

  it('renders the whole value as JSON where text is not a string', () => {
    expect(textOutput().render({}, { text: 42 })).toEqual([{ type: 'text', text: '{"text":42}' }])
    expect(textOutput().render({}, { count: 1 })).toEqual([{ type: 'text', text: '{"count":1}' }])
  })

  it('detaches a result into lossless JSON, dropping absent optional fields', () => {
    expect(textResult({ text: 'saved', id: 'a1', replaced: undefined })).toEqual({ text: 'saved', id: 'a1' })
    expect(textResult({ text: 'read', nested: { list: [1, 'two', null] } }))
      .toEqual({ text: 'read', nested: { list: [1, 'two', null] } })
  })
})
