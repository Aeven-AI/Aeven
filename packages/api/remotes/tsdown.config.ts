import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@aeven/api-remotes',
  ['lib/types/index.js'],
  { hostPhase: true },
)
