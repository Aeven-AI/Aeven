import { describe, expect, it } from 'vitest'

import { detectBlockType } from '../../../src/engine/stream/detect-block-type.ts'
import type { BlockType } from '../../../src/engine/types.ts'

const cases: [string, string, boolean, BlockType][] = [
  ['empty input', '', false, 'text'],
  ['ordinary prose', 'hello', false, 'text'],
  ['open reasoning block', '<think>', false, 'reasoning'],
  ['partial reasoning tag', '<thi', false, 'pending'],
  ['leading newline', '\nhello', false, 'text'],
  ['incomplete thematic break', 'paragraph\n--', false, 'pending'],
  ['trailing newline', 'hello\n', false, 'pending'],
  ['final trailing newline', 'hello\n', true, 'text'],
  ['inline link at newline', '[docs](https://example.com)\n', false, 'text'],
  ['incomplete backtick fence', '```', false, 'pending'],
  ['open backtick fence', '```js\n', false, 'code'],
  ['backtick fence with content', '```js\nconst value = 1', false, 'code'],
  ['open tilde fence', '~~~js\n', false, 'code'],
  ['indented code', '    const value = 1', false, 'code'],
  ['row still arriving', '| left', false, 'pending'],
  ['table row', '| left | right |', false, 'table'],
  ['table row at newline', '| left | right |\n', false, 'table'],
  ['indented table row', '  | left | right |', false, 'table'],
  ['quoted table row', '> | left | right |', false, 'table'],
  ['table row before prose', '| left | right |\n\nProse.', false, 'table'],
  // A pipe on its own is not a row: only the leading pipe makes one, so the
  // prose these lines are stays prose. The trailing newline holds any block
  // pending until more arrives or the stream ends, which is why these are
  // read finalized.
  ['one pipe in prose', 'left | right', false, 'text'],
  ['prose with pipes at newline', 'left | middle | right\n', true, 'text'],
  ['list items carrying pipes', '- ls | head\n- grep | head\n', true, 'text'],
  ['prose before a table', 'Prose.\n\n| left | right |', false, 'text'],
  ['trailing pipe without a leading one', 'value|\n', false, 'text'],
]

describe.each(cases)(
  'detectBlockType: %s',
  (_name, input, finalize, expected) => {
    it(`returns ${expected}`, () => {
      expect(detectBlockType(input, finalize)).toBe(expected)
    })
  },
)
