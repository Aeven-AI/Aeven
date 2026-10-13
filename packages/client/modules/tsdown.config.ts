import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@aeven/client-modules',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
