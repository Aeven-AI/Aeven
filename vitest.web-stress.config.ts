import { defineConfig } from 'vitest/config'
import { vitestExecArgv, workspaceAliases } from './vitest.shared.ts'

/** Opt-in browser performance lane; no default Vitest config includes *.stress.ts. */
export default defineConfig({
  resolve: { alias: workspaceAliases() },
  test: {
    execArgv: vitestExecArgv,
    include: ['apps/web/stress-tests/**/*.stress.ts'],
    testTimeout: 600_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
