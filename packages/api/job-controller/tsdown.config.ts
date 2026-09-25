import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@aeven/api-job-controller',
  ['lib/types/index.js'],
  { hostPhase: true },
)
