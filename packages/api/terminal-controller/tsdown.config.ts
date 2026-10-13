import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@aeven/api-terminal-controller',
  ['lib/types/index.js'],
  { hostPhase: true },
)
