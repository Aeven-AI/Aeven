/**
 * Model-facing read-aloud switch. The tool logs the request it was given and its result; the Web
 * Surface watches the settled call and turns reply reading on or off for that Session. Nothing is
 * spoken on the Host, so the tool stays a pure, replayable instruction.
 * @module @aeven/tool-read-aloud
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@aeven/tools'

export const name = 'tool-read-aloud'
export const inject = ['tools']

/** The one model-facing tool this package registers. */
const READ_ALOUD = 'read_aloud'

const DESCRIPTION = 'Turn spoken read-aloud of your replies on or off for this session. '
  + 'Switch it on when the user wants to hear the answers — language practice, pronunciation, or a '
  + 'hands-free conversation — and off when they ask you to stop. It changes only the reader; your '
  + 'replies themselves stay text.'

/**
 * Register the `read_aloud` tool.
 * @param ctx - registrant context carrying the tool registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: READ_ALOUD,
    description: DESCRIPTION,
    parameters: {
      enabled: {
        type: 'boolean',
        required: true,
        description: 'true to read your replies aloud from now on, false to stop reading them.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.enabled
          ? 'Read-aloud is on: your next replies are spoken as they stream.'
          : 'Read-aloud is off: replies are no longer spoken.',
      }],
    },
    execute(args) {
      return Promise.resolve({ enabled: args.enabled })
    },
    presentCall: args => ({ card: 'generic', title: args.enabled ? 'Read replies aloud' : 'Stop reading aloud', kind: 'other' }),
  }))
}
