import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@aeven/session-log-export',
  ['lib/types/index.js'],
  { hostPhase: true },
)
