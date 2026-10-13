/** The standalone SDK-minimal bundle's complete declared Cordis tree. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

function packageName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
}

describe('avn-sdk-minimal bundle', () => {
  it('declares one standalone allowlisted tree with every row dependency', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      avn?: { bundle?: { patch?: string } }
    }
    expect(manifest.avn?.bundle?.patch).toBe('./cordis.patch.yml')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.avn!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: Array<{ id?: string; inject?: string[]; name?: string; config?: Record<string, unknown>; disabled?: unknown }> }>
    expect(patches).toHaveLength(1)
    const rows = patches[0]?.insert ?? []
    expect(rows.map(row => [row.id, row.name])).toEqual([
      ['sdk-app-startup', '@aeven/sdk-app'],
      ['sdk-jsonrpc-server', '@aeven/sdk-jsonrpc-server'],
      ['deepseek-llm-api-extensions', '@aeven/deepseek-llm-api-extensions'],
      ['session-log-deepseek', '@aeven/session-log-deepseek'],
      ['plugin-package-inventory-deepseek', '@aeven/plugin-package-inventory-deepseek'],
      ['llm-deepseek', '@aeven/llm-deepseek'],
      ['sandbox', '@aeven/sandbox-local'],
      ['session-projection', '@aeven/session-projection'],
      ['sandbox-policy', '@aeven/sandbox-policy'],
      ['subprocess', '@aeven/subprocess-local'],
      ['pty', '@aeven/terminal'],
      ['terminal-bash', '@aeven/terminal-bash'],
      ['terminal-pwsh', '@aeven/terminal-bash'],
      ['fs-local', '@aeven/fs-local'],
      ['timer', '@deepseek-ai/cordis-plugin-timer'],
      ['llm', '@aeven/llm'],
      ['session', '@aeven/session'],
      ['session-title', '@aeven/session-title'],
      ['system-prompt', '@aeven/system-prompt'],
      ['tools', '@aeven/tools'],
      ['agent', '@aeven/agent'],
      ['llm-retry', '@aeven/llm-retry'],
      ['jobs', '@aeven/jobs-local'],
      ['invariants', '@aeven/invariants'],
      ['session-invariant', '@aeven/session/invariant'],
      ['agent-invariant', '@aeven/agent/invariant'],
      ['scope-invariant', '@aeven/scope/invariant'],
      ['agent-loop-invariant', '@aeven/agent-loop/invariant'],
      ['agent-loop', '@aeven/agent-loop'],
      ['persistent-bash', '@aeven/tool-bash-persistent'],
      ['persistent-pwsh', '@aeven/tool-pwsh-persistent'],
      ['str-replace-editor', '@aeven/tool-str-replace-editor'],
      ['sessions', '@aeven/session-persistence-jsonl'],
    ])
    expect(rows.find(row => row.id === 'sdk-app-startup')?.config).toEqual({ profile: 'sdk-minimal' })
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')).toMatchObject({
      inject: ['sdkAppStartup', 'loader'],
      config: { maxTokensAsSuccess: false },
    })
    expect(rows.find(row => row.id === 'llm-deepseek')?.config).toEqual({
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      defaultContextWindow: { __jsExpr: 'Number(process.env.AVN_CONTEXT_WINDOW ?? 1000000)' },
      streamIdleTimeoutMs: 172800000,
    })
    expect(rows.find(row => row.id === 'system-prompt')?.config).toEqual({
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      persona: { __jsExpr: "process.env.AVN_SYSTEM_PROMPT ?? 'You are a helpful software engineer assistant.'" },
    })
    expect(rows.find(row => row.id === 'agent-loop')?.config).toEqual({ agents: [] })
    expect(rows.find(row => row.id === 'terminal-bash')).toMatchObject({
      disabled: { __jsExpr: "process.platform === 'win32'" },
    })
    expect(rows.find(row => row.id === 'terminal-pwsh')).toMatchObject({
      disabled: { __jsExpr: "process.platform !== 'win32'" },
      config: { shellDialect: 'pwsh', timeoutMs: 300000 },
    })
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...new Set(rows.map(row => row.name).filter((name): name is string => name !== undefined).map(packageName))].sort(),
    )
  })
})
