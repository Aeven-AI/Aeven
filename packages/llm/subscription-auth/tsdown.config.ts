import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle('@aeven/subscription-auth', ['lib/types/index.js'], {
  clientEntry: 'src/client/index.tsx',
})
