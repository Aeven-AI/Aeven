import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@aeven/api-workspace-controller',
  ['lib/types/index.js'],
  { hostPhase: true },
)
