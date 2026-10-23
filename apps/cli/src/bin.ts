#!/usr/bin/env node
/**
 * Command-line entry for avn.
 * @module @aeven/cli/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@aeven/app-boot'
import { parseAvnArgs } from './args.ts'

// Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit
// one directory under apps/cli, so the checked-in manifest resolves with the
// same relative hop from either artifact.
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

// Suppress only Node's SQLite maturity notice; application and other runtime warnings remain visible.
const emitWarning = process.emitWarning.bind(process)
process.emitWarning = function (warning: string | Error, ...args: unknown[]): void {
  if (warning === 'SQLite is an experimental feature and might change at any time' && args[0] === 'ExperimentalWarning') return
  Reflect.apply(emitWarning, process, [warning, ...args])
}

const version = readVersion()
const invocation = parseAvnArgs(process.argv.slice(2), version)

switch (invocation.mode) {
  case 'profile': {
    const { runProfile } = await import('./profile-boot.ts')
    await runProfile({
      environment: loadLayeredEnv('avn'),
      profile: invocation.profile,
      patchFiles: invocation.patches,
      args: invocation.args,
      avnVersion: version,
    })
    break
  }
  case 'plugin': {
    const { runPlugin } = await import('./plugin.ts')
    process.exit(runPlugin(invocation.profile, invocation.args))
    break
  }
  case 'dump-config': {
    const { runDumpConfig } = await import('./dump-config.ts')
    runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches)
    break
  }
  default:
    invocation satisfies never
    throw new Error(`avn: unhandled invocation mode ${JSON.stringify(invocation)}`)
}
