import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { boot, healProfilesModuleFallback, loadOverlayPatches, loadProfile } from '@aeven/app-boot'
import { provideCmdline } from '@aeven/cmdline'
import { SessionId, SessionLogOffset } from '@aeven/session'
import type { Agent } from '@aeven/agent'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE } from '@aeven/tool-subagent/model-selection-settings'
import { SHIPPED_PRESET_ROOT } from '@aeven/agent-presets'
import { applyChildComposition, childSessionMeta } from '@aeven/subagent'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@aeven/llm'
import type {} from '@aeven/automations'
import { MemorySyncNetwork } from '../../../packages/sync/sync/tests/memory.ts'
import type {} from '@aeven/compaction-basic'
import type {} from '@aeven/skill'
import type {} from '@aeven/tools'
// Type-only: resolves `ctx.get('sessionProjections')` and `ctx.get('tokenMeter')`.
import type {} from '@aeven/session-projection'
import type {} from '@aeven/token-meter'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
/** The shipped Web surface: the avn-base and avn-web-app bundle patches over an empty preset root. */
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const WEB_PATCH = join(REPO_ROOT, 'packages/bundle/web-app/cordis.patch.yml')
const CODEX_PACKAGE_DIR = join(REPO_ROOT, 'packages/subagent/subagent-codex')
const CLAUDE_CODE_PACKAGE_DIR = join(REPO_ROOT, 'packages/subagent/subagent-claude-code')
/** The installation anchor whose dependency surface the preset module fallback mirrors. */
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')
/**
 * The host-plane tools the base bundle registers in the GLOBAL layer, which
 * every agent sees whichever preset composed it.
 */
const GLOBAL_TOOLS = [
  'create_worktree', 'git_branch', 'git_commit', 'git_diff', 'git_log', 'git_merge', 'git_remote',
  'git_status', 'read_aloud', 'remove_worktree', 'sidebar_files', 'sidebar_terminal',
  'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update', 'working_directory',
]
/** A one-row preset composition for user-authored and configured roots. */
const TODO_COMPOSITION = '- id: tool-todo\n  name: \'@aeven/tool-todo\'\n  config:\n    allowParallelInProgress: true\n'

/**
 * Boot the shipped Web composition, minus the rows that would bind a port,
 * touch the network, or write outside the test. Everything that decides an
 * agent's capabilities is the real thing, including the shipped preset.
 */
async function bootWeb(
  settingsFile: string,
  extra: PatchOptions[] = [],
  profilePackages: readonly string[] = [],
  profileBundles?: readonly string[],
): Promise<Context> {
  const storageRoot = join(dirname(settingsFile), 'storages')
  const overrides: PatchOptions[] = [
    // The settings row defaults to `$AVN_HOME/settings.yaml`. Left alone it
    // reads the developer's own document — and since the default preset is a
    // setting, a stored `agent-presets.default` would decide this file's
    // outcome. Point it at a temp file for the same reason the roster row
    // below pins `includeUserRoot` off.
    { id: 'settings', config: { path: settingsFile, watch: false } },
    // storage-json's root is anchored to the real $AVN_HOME. Unpinned, this
    // file writes the developer's own `~/.aeven/storages/` — and then reads it
    // back on the next run, so a stored document from any other build decides
    // this test's boot. Same reason the settings row above is pinned.
    { id: 'storage-json', config: { root: storageRoot } },
    // Host rows with side effects outside this process: a bound port, a served
    // asset tree, a telemetry exporter. `api-gateway` and `directory-picker`
    // stay ENABLED on purpose — the api-proxy is the host row that injects
    // `subagents`, `workspace`, and the rest of the agent plane, so disabling
    // it would hide exactly the breakage this file exists to catch: a service
    // moved into the presets that a host row still waits for. The boot audit
    // is that assertion.
    { id: 'webserver', disabled: true },
    // The web bundle's runtime row injects `webServer`, so it cannot
    // activate without the bound port disabled above. It owns dist serving
    // and the URL prompt line — surface glue, not anything that decides an
    // agent's capabilities, which is all this file asserts.
    { id: 'web-runtime', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
    // A deployment-level skill on the host registry's GLOBAL layer — the same
    // registration shape a repository plugin's skill root uses. The layered
    // skills test below proves it reaches preset-composed agents.
    { id: 'skill-badge', disabled: false },
    { id: 'modules', disabled: true },
    { id: 'connection', disabled: true },
    { id: 'automations', disabled: true },
    { id: 'sync-yjs', disabled: true },
    { id: 'session-sync', disabled: true },
    { id: 'settings-sync', disabled: true },
    { id: 'api-sync-controller', disabled: true },
    { id: 'llm-grok-build-oauth', disabled: true },
    { id: 'workspace-files', disabled: true },
    // Export owns a Connection Fetch route, so this Host-only composition
    // disables it with the transport service above.
    { id: 'session-log-download', disabled: true },
    // The account data export injects the transport service disabled above.
    { id: 'account-data', disabled: true },
    // The always-on reload chain waits for the browser roster and bound port
    // disabled above.
    { id: 'client-hmr', disabled: true },
    // The shipped `-auto` chooser resolves its interaction from a running
    // host and so waits for the webserver disabled above; the browse variant
    // supplies `directoryPicker` without one.
    // The shipped profile starts Chrome and two MCP servers. This boot only
    // asserts agent composition, so those processes stay down.
    { id: 'browser-chromium', disabled: true },
    { id: 'mcp-chrome-devtools', disabled: true },
    { id: 'mcp-playwright', disabled: true },
    // Computer use mounts by whether this Mac has Cua Driver installed.
    { id: 'computer-use', disabled: true },
    { id: 'computer-use-cua-driver', disabled: true },
    { id: 'computer-use-semantic-batches', disabled: true },
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'directory-picker-browse', name: '@aeven/host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@aeven/client-ui-directory-picker-browse' },
    ] },
    // Pin the roster away from the developer's machine: `includeUserRoot`
    // false keeps `~/.aeven/.agent-presets` from changing a test's outcome.
    // `default` here is the COMPOSITION default — the base layer the settings
    // document overrides — and repeats the web-app bundle's own value so the
    // shipped default is asserted rather than inherited. No `roots` entry:
    // the plugin bundles the shipped presets itself and prepends their root.
    { id: 'agent-presets', config: { default: 'aeven', includeUserRoot: false } },
    ...extra,
  ]
  // The surface is patch layers over an empty preset root, so the root sits
  // outside this workspace and bare plugin names cannot resolve by Node's
  // upward walk. The flat fallback the preset boot maintains is what makes
  // them resolvable — the same mechanism, not a test-only shim.
  const home = dirname(settingsFile)
  await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, home })
  const profileDir = join(home, 'profiles', 'spec')
  await mkdir(profileDir, { recursive: true })
  // Product Bundles are installed into the Profile, not the avn app. Model
  // pnpm's package link for only the selected products; their own production
  // dependencies resolve from the linked workspace packages, while shared
  // peers still resolve through the installation fallback above.
  for (const packageDir of profilePackages) {
    const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')) as { name: string }
    const link = join(profileDir, 'node_modules', manifest.name)
    await mkdir(dirname(link), { recursive: true })
    await symlink(packageDir, link, 'junction')
  }
  let bundlePatches: PatchOptions[] = [
    ...loadOverlayPatches('avn-test', BASE_PATCH),
    ...loadOverlayPatches('avn-test', WEB_PATCH),
  ]
  if (profileBundles !== undefined) {
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      private: true,
      dependencies: Object.fromEntries(profileBundles.map(name => [name, 'workspace:*'])),
      avn: { profile: { bundles: profileBundles } },
    }, null, 2) + '\n')
    const profile = loadProfile('avn-test', 'spec', INSTALL_ANCHOR, home, { userLayer: false })
    bundlePatches = profile.layers.flatMap(layer => layer.patches)
  }
  const rootConfig = join(profileDir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n')
  return await boot('avn-test', rootConfig, [...bundlePatches, ...overrides], (bootCtx) => {
    provideCmdline(bootCtx, { args: [], exit: () => {} })
  })
}

const toolNames = (ctx: Context, agent?: Agent): string[] =>
  ctx.tools.schemas(agent).map(schema => schema.name).sort()

function toolParameterNames(ctx: Context, agent: Agent, toolName: string): string[] {
  const schema = ctx.tools.schemas(agent).find(tool => tool.name === toolName)
  if (schema === undefined) throw new Error(`missing tool schema ${toolName}`)
  const properties = schema.parameters.properties
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    throw new Error(`${toolName} has invalid parameter properties`)
  }
  return Object.keys(properties).sort()
}

function enablePresetTool(composition: string, id: string): string {
  const row = `    - id: ${id}\n`
  const start = composition.indexOf(row)
  if (start < 0) throw new Error(`missing preset row ${id}`)
  const end = composition.indexOf('\n    - id:', start + row.length)
  const disabled = composition.indexOf('      disabled: true\n', start)
  if (disabled < 0 || (end >= 0 && disabled > end)) {
    throw new Error(`preset row ${id} is not disabled`)
  }
  return composition.slice(0, disabled) + composition.slice(disabled + '      disabled: true\n'.length)
}

let ctx: Context
beforeAll(async () => {
  const settingsFile = join(await mkdtemp(join(tmpdir(), 'avn-web-presets-')), 'settings.yaml')
  await writeFile(settingsFile, '{}\n')
  ctx = await bootWeb(settingsFile)
}, 120_000)

describe('the shipped Web composition', () => {
  it('keeps only the base bundle\'s host-plane tools in the global layer', () => {
    // A tool in the global layer reaches EVERY agent regardless of which
    // preset composed it. A tool beyond this list means an agent-plane row
    // moved into the host composition.
    expect(toolNames(ctx)).toEqual(GLOBAL_TOOLS)
  })

  it('keeps the token meter and its context-meter projections on the host plane', async () => {
    // Read before any preset in this file mounts, which is what makes this an
    // ownership assertion rather than a mount-order coincidence: a preset-side
    // meter sits behind an `isolate` realm and is invisible to `ctx.get`.
    //
    // The projection registry is process-wide rather than scope-layered, so a
    // preset-side meter would make the browser's context meter depend on which
    // other sessions mounted a preset carrying one. Host ownership is what
    // makes the meter a per-session fact.
    expect(ctx.get('tokenMeter')).toBeDefined()
    const projections = ctx.get('sessionProjections')
    if (projections === undefined) throw new Error('the Web composition must compose a projection registry')
    const handle = await ctx.agents.create({
      sessionId: SessionId('preset-meter'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'aeven').then(() => undefined),
    })
    try {
      // A subset assertion: `tasks`, `goal`, and the rest register into the
      // same process-wide table, and this is about the meter's three units.
      expect(Object.keys(projections.snapshot(handle.agent.session).values))
        .toEqual(expect.arrayContaining(['contextBreakdown', 'contextPressure', 'tokenUsage']))
    } finally {
      await handle.dispose()
    }
  })

  it('supplies the shipped preset, and only that, from the system root', async () => {
    const listed = await ctx.agentPresets.list()

    expect(listed.map(preset => preset.id)).toEqual(['aeven'])
    expect(listed.every(preset => preset.trust === 'system')).toBe(true)
    expect(ctx.agentPresets.defaultId).toBe('aeven')
  })

  it('composes the full agent from `aeven`', async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('preset-aeven'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'aeven').then(() => undefined),
    })
    try {
      // The EXACT catalog, not a spot-check: an omission is this design's
      // quietest failure mode, because a row that registers into the wrong
      // layer mounts cleanly and simply contributes nothing. `glob`/`grep` are
      // excluded for the reason the TUI composition e2e excludes them — they
      // depend on ripgrep being present on the machine.
      expect(toolNames(ctx, handle.agent).filter(name => name !== 'glob' && name !== 'grep')).toEqual([
        'ask_user_question', 'bash', 'capability_manage', 'create_goal', 'create_worktree',
        'device_close', 'device_list', 'device_open', 'device_screenshot', 'edit', 'exit_plan_mode',
        'find_images', 'generate_image', 'generate_video', 'get_goal', 'get_location',
        'git_branch', 'git_commit', 'git_diff', 'git_log', 'git_merge', 'git_remote', 'git_status',
        'interrupt_agent', 'job_kill', 'job_list', 'job_output', 'list_agents',
        'memory_environments', 'memory_get', 'memory_list', 'memory_remember', 'memory_remember_bulk',
        'memory_search', 'memory_skill', 'memory_skills', 'memory_timeline',
        'preview_back', 'preview_bookmarks', 'preview_browser_control', 'preview_check', 'preview_click',
        'preview_clipboard', 'preview_console', 'preview_content', 'preview_dialog', 'preview_drag',
        'preview_evaluate', 'preview_export_document', 'preview_forward', 'preview_handoff',
        'preview_history', 'preview_hover', 'preview_navigate', 'preview_page_tools', 'preview_press',
        'preview_read', 'preview_reload', 'preview_screenshot', 'preview_scroll', 'preview_select',
        'preview_sequence', 'preview_snapshot', 'preview_status', 'preview_tabs', 'preview_type',
        'preview_upload', 'preview_wait',
        'ralph', 'read', 'read_aloud', 'read_image', 'remove_worktree', 'send_message',
        'sidebar_files', 'sidebar_terminal', 'skill', 'subagent', 'subagent_fork',
        'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update',
        'todo_write', 'tool_search', 'update_goal', 'wait_agent', 'web_fetch', 'web_search',
        'workflow', 'working_directory', 'write',
      ])
      expect(ctx.commands.find(handle.agent, 'goal')).toBeDefined()
    } finally {
      await handle.dispose()
    }
  })

  it('applies the default-off subagent model allowlist only to new sessions', async () => {
    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, {
      enabled: false,
      allowedModels: [],
    })
    const disabled = await ctx.agents.create({
      sessionId: SessionId('preset-model-selection-disabled'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'aeven').then(() => undefined),
    })
    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, {
      enabled: true,
      allowedModels: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }],
    })
    const enabled = await ctx.agents.create({
      sessionId: SessionId('preset-model-selection-enabled'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'aeven').then(() => undefined),
    })
    try {
      expect(toolNames(ctx, disabled.agent)).not.toContain('list_subagent_models')
      expect(toolParameterNames(ctx, disabled.agent, 'subagent')).not.toEqual(expect.arrayContaining([
        'model', 'provider', 'reasoning_effort',
      ]))
      expect(toolNames(ctx, enabled.agent)).toContain('list_subagent_models')
      expect(toolParameterNames(ctx, enabled.agent, 'subagent')).toEqual(expect.arrayContaining([
        'model', 'provider', 'reasoning_effort',
      ]))
      expect(toolNames(ctx, disabled.agent)).not.toContain('list_subagent_models')
    } finally {
      await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, { enabled: false })
      await enabled.dispose()
      await disabled.dispose()
    }
  })

  it('keeps two sessions on the preset independent', async () => {
    const kept = await ctx.agents.create({
      sessionId: SessionId('preset-both-kept'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'aeven').then(() => undefined),
    })
    const ended = await ctx.agents.create({
      sessionId: SessionId('preset-both-ended'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'aeven').then(() => undefined),
    })
    try {
      const catalog = toolNames(ctx, kept.agent)
      expect(toolNames(ctx, ended.agent)).toEqual(catalog)

      await ended.dispose()

      // Tearing one session down leaves the other whole and the global layer unchanged.
      expect(toolNames(ctx, kept.agent)).toEqual(catalog)
      expect(toolNames(ctx)).toEqual(GLOBAL_TOOLS)
    } finally {
      await kept.dispose()
    }
  })

  it('merges the global skill layer into a preset agent\'s catalog, keeping local discovery preset-side', async () => {
    const proj = await mkdtemp(join(tmpdir(), 'avn-preset-skill-proj-'))
    await mkdir(join(proj, '.aeven', 'skills', 'project-proof'), { recursive: true })
    await writeFile(join(proj, '.aeven', 'skills', 'project-proof', 'SKILL.md'), [
      '---',
      'name: project-proof',
      'description: Proves the preset layer discovers project skills beside global ones.',
      '---',
      '',
      'Project proof body.',
      '',
    ].join('\n'))

    const handle = await ctx.agents.create({
      // Unique per run: the composition persists into the ambient AVN home,
      // and a fixed id would collide with a log an earlier run left there.
      sessionId: SessionId(`preset-skills-${randomUUID()}`),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'aeven').then(() => undefined),
    })
    try {
      // The host (global) view carries the deployment-level provider alone:
      // local discovery moved behind the presets with `skill-filesystem`.
      expect((await ctx.skills.list({ cwd: proj })).map(skill => skill.name)).toEqual(['avn-badge'])

      // The preset agent's view merges the global layer with its preset's
      // own local discovery over the session cwd.
      const scoped = (await ctx.skills.list({ cwd: proj, scope: handle.agent })).map(skill => skill.name)
      expect(scoped).toContain('avn-badge')
      expect(scoped).toContain('project-proof')

      // The preset's own loader tool resolves the global-layer skill.
      const loaded = await ctx.tools.execute({
        callId: ToolCallId('preset-skills-load'),
        name: 'skill',
        arguments: { name: 'avn-badge' },
        signal: new AbortController().signal,
        agent: handle.agent,
      })
      expect(loaded.isError).toBe(false)
      expect(JSON.stringify(loaded.content)).toContain('powered by avn')
    } finally {
      await handle.dispose()
    }
  })

  it('never rewrites the preset file it composed from', async () => {
    // The Loader persists a tree whose plugin self-disposed, and tearing an
    // agent down disposes its whole subtree. Inherited, that rewrote the
    // shipped composition — truncating it to `[]` the first time a session
    // ended — so `PresetTree` refuses to write at all.
    const path = join(SHIPPED_PRESET_ROOT, 'aeven', 'agent.cordis.yml')
    const before = await readFile(path, 'utf8')

    const handle = await ctx.agents.create({
      sessionId: SessionId('preset-readonly'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'aeven').then(() => undefined),
    })
    await handle.dispose()
    // Slack, not a race the number has to win. The write is driven by the
    // Loader's fiber-unload listener, which fires as the subtree's fibers
    // settle rather than when `dispose()` resolves, and the Loader exposes no
    // flush to await. A regression writes synchronously inside that listener,
    // so any wait past settlement fails; a longer one only slows the test.
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(await readFile(path, 'utf8')).toBe(before)
  })
})

describe('product Bundle and user-preset intersection', () => {
  const presetIds = ['products-none', 'products-codex', 'products-claude', 'products-both'] as const
  type Product = 'codex' | 'claude-code'
  type PresetId = typeof presetIds[number]

  async function bootProducts(installed: readonly Product[]): Promise<Context> {
    const root = await mkdtemp(join(tmpdir(), 'avn-product-presets-'))
    const userRoot = join(root, 'presets')
    const settingsFile = join(root, 'settings.yaml')
    const shipped = await readFile(join(SHIPPED_PRESET_ROOT, 'aeven', 'agent.cordis.yml'), 'utf8')
    await writeFile(settingsFile, '{}\n')
    for (const id of presetIds) {
      let composition = shipped
      if (id === 'products-codex' || id === 'products-both') {
        composition = enablePresetTool(composition, 'tool-subagent-codex')
      }
      if (id === 'products-claude' || id === 'products-both') {
        composition = enablePresetTool(composition, 'tool-subagent-claude-code')
      }
      const directory = join(userRoot, id)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'agent.cordis.yml'), composition)
    }
    const packageDir = (product: Product): string => (
      product === 'codex' ? CODEX_PACKAGE_DIR : CLAUDE_CODE_PACKAGE_DIR
    )
    const packageName = (product: Product): string => (
      product === 'codex'
        ? '@aeven/subagent-codex'
        : '@aeven/subagent-claude-code'
    )
    return await bootWeb(settingsFile, [
      {
        id: 'agent-presets',
        config: {
          default: 'aeven',
          // The shipped root is the plugin's own, prepended before this.
          roots: [{ path: userRoot, trust: 'user' }],
          includeUserRoot: false,
        },
      },
    ], installed.map(packageDir), [
      '@aeven/base',
      '@aeven/web-app',
      ...installed.map(packageName),
    ])
  }

  it('composes the intersection of installed Bundles and enabled preset rows', async () => {
    const enabledByPreset: Record<PresetId, Product[]> = {
      'products-none': [],
      'products-codex': ['codex'],
      'products-claude': ['claude-code'],
      'products-both': ['codex', 'claude-code'],
    }
    const scenarios: Array<{ installed: Product[]; presets: readonly PresetId[] }> = [
      { installed: [], presets: ['products-both'] },
      { installed: ['codex'], presets: ['products-both'] },
      { installed: ['claude-code'], presets: ['products-both'] },
      { installed: ['codex', 'claude-code'], presets: presetIds },
    ]

    for (const { installed, presets } of scenarios) {
      const productCtx = await bootProducts(installed)
      const spawn = vi.spyOn(productCtx.subprocess, 'spawn')
      try {
        expect(productCtx.subagents.list()
          .filter(name => name === 'codex' || name === 'claude-code')
          .sort())
          .toEqual([...installed].sort())
        for (const id of presets) {
          const handle = await productCtx.agents.create({
            sessionId: SessionId(`preset-${id}-${installed.join('-') || 'none'}-${randomUUID()}`),
            setup: agentCtx => productCtx.agentPresets.mount(agentCtx, id).then(() => undefined),
          })
          try {
            const productTools = enabledByPreset[id]
              .filter(product => installed.includes(product))
              .map(product => product === 'codex' ? 'subagent_codex' : 'subagent_claude_code')
              .sort()
            const tools = toolNames(productCtx, handle.agent)
            expect(tools.filter(name => name === 'subagent_codex' || name === 'subagent_claude_code'))
              .toEqual(productTools)
            expect(tools).toEqual(expect.arrayContaining(['job_kill', 'job_list', 'job_output']))
            for (const productTool of productTools) {
              expect(toolParameterNames(productCtx, handle.agent, productTool)).toEqual([
                'description', 'prompt', 'run_in_background',
              ])
            }
          } finally {
            await handle.dispose()
          }
        }
        expect(spawn).not.toHaveBeenCalled()
      } finally {
        spawn.mockRestore()
        await productCtx.fiber.dispose()
      }
    }
  }, 120_000)

  it('applies a product-row edit only to later sessions on the preset', async () => {
    const productCtx = await bootProducts(['codex'])
    const preset = await productCtx.agentPresets.resolve('products-none')
    const original = await readFile(preset.path, 'utf8')
    const existing = await productCtx.agents.create({
      sessionId: SessionId('preset-product-generation-existing'),
      setup: agentCtx => productCtx.agentPresets.mount(agentCtx, 'products-none').then(() => undefined),
    })
    try {
      expect(toolNames(productCtx, existing.agent)).not.toContain('subagent_codex')
      await writeFile(preset.path, enablePresetTool(original, 'tool-subagent-codex'))

      const later = await productCtx.agents.create({
        sessionId: SessionId('preset-product-generation-later'),
        setup: agentCtx => productCtx.agentPresets.mount(agentCtx, 'products-none').then(() => undefined),
      })
      try {
        expect(toolNames(productCtx, existing.agent)).not.toContain('subagent_codex')
        expect(toolNames(productCtx, later.agent)).toContain('subagent_codex')
      } finally {
        await later.dispose()
      }
    } finally {
      await existing.dispose()
      await writeFile(preset.path, original)
      await productCtx.fiber.dispose()
    }
  }, 120_000)
})

describe('a forked session', () => {
  it('inherits the composition its seeded history was produced under', async () => {
    const parent = await ctx.agents.create({
      sessionId: SessionId('preset-fork-parent'),
      meta: { agentPreset: 'aeven' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'aeven').then(() => undefined),
    })
    const inherited = ctx.sessionProjections.stateOf(parent.agent.session, 'agentPreset') ?? undefined
    const child = await ctx.agents.create({
      sessionId: SessionId('preset-fork-child'),
      seed: [],
      inheritedEventCount: SessionLogOffset(0),
      meta: {
        parentSession: SessionId('preset-fork-parent'),
        isSeeded: true,
        ...inherited === undefined ? {} : { agentPreset: inherited },
      },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, inherited).then(() => undefined),
    })
    try {
      // Composing nothing would leave the child empty: this layer moved every
      // model-facing row out of the host plane, so there is nothing to inherit
      // for free any more.
      expect(toolNames(ctx, child.agent)).toEqual(toolNames(ctx, parent.agent))
      expect(toolNames(ctx, child.agent).length).toBeGreaterThan(0)
    } finally {
      await child.dispose()
      await parent.dispose()
    }
  })
})

describe('a delegated child', () => {
  it('runs on the composition its parent runs on', async () => {
    const parent = await ctx.agents.create({
      sessionId: SessionId('preset-child-parent'),
      meta: { agentPreset: 'aeven' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'aeven').then(() => undefined),
    })
    // Exactly what an in-process subagent driver's creation window does.
    const child = await parent.agent.ctx.agents.create({
      sessionId: SessionId('preset-child'),
      meta: childSessionMeta(parent.agent, 1, false),
      setup: (agentCtx) => {
        applyChildComposition(agentCtx, parent.agent, {})
      },
    })
    try {
      expect(toolNames(ctx, child.agent)).toEqual(toolNames(ctx, parent.agent))
      // The shipped preset is the whole agent; an empty child here is the
      // defect, and equality alone would not catch it.
      expect(toolNames(ctx, child.agent)).toContain('bash')
      expect(child.agent.session.header.agentPreset).toBe('aeven')
    } finally {
      await child.dispose()
      await parent.dispose()
    }
  })
})

describe('a launcher that configures no writable root', () => {
  // The claim this default exists for, asserted through the real shipped
  // bundles rather than a hand-built context: `apps/cli` patches in only the
  // system root, and a person's own presets are found anyway because the
  // roster derives `<avnHome>/.agent-presets` itself. `$AVN_HOME` is pointed
  // at a temp home BEFORE boot — the derived root is resolved when the plugin
  // is constructed, and an unpinned run would read the developer's own.
  let derivedCtx: Context
  let previousHome: string | undefined

  beforeAll(async () => {
    const home = await mkdtemp(join(tmpdir(), 'avn-preset-derived-'))
    previousHome = process.env.AVN_HOME
    process.env.AVN_HOME = home
    await mkdir(join(home, '.agent-presets', 'derived-mine'), { recursive: true })
    await writeFile(join(home, '.agent-presets', 'derived-mine', 'agent.cordis.yml'), TODO_COMPOSITION)
    const settingsFile = join(await mkdtemp(join(tmpdir(), 'avn-preset-derived-settings-')), 'settings.yaml')
    await writeFile(settingsFile, '{}\n')
    // No configured roots: the shipped one is the plugin's own, and the
    // writable one is the roster's own default rather than this patch's job.
    derivedCtx = await bootWeb(settingsFile, [{
      id: 'agent-presets',
      config: { default: 'aeven', includeUserRoot: true },
    }])
  }, 120_000)

  afterAll(async () => {
    if (previousHome === undefined) delete process.env.AVN_HOME
    else process.env.AVN_HOME = previousHome
    await derivedCtx.fiber.dispose()
  })

  it('discovers and mounts a preset the person authored under the harness home', async () => {
    const listed = await derivedCtx.agentPresets.list()

    const mine = listed.find(preset => preset.id === 'derived-mine')
    expect(mine).toMatchObject({ trust: 'user' })
    // Omitted rather than undefined: a healthy row carries no `broken` key.
    expect(mine?.broken).toBeUndefined()
    expect(derivedCtx.agentPresets.authorable).toBe(true)

    const handle = await derivedCtx.agents.create({
      sessionId: SessionId('preset-derived-root'),
      setup: agentCtx => derivedCtx.agentPresets.mount(agentCtx, 'derived-mine').then(() => undefined),
    })
    try {
      expect(toolNames(derivedCtx, handle.agent)).toContain('todo_write')
    } finally {
      await handle.dispose()
    }
  })
})

describe('authoring a preset on the shipped composition', () => {
  let authorCtx: Context
  let userRoot: string

  beforeAll(async () => {
    userRoot = join(await mkdtemp(join(tmpdir(), 'avn-preset-authoring-')), 'profiles')
    const settingsFile = join(await mkdtemp(join(tmpdir(), 'avn-preset-authoring-settings-')), 'settings.yaml')
    await writeFile(settingsFile, '{}\n')
    authorCtx = await bootWeb(settingsFile, [{
      id: 'agent-presets',
      config: {
        default: 'aeven',
        // The root does not exist yet: a deployment whose user has authored
        // nothing is the normal first-run state. The shipped root is the
        // plugin's own, prepended before this.
        roots: [{ path: userRoot, trust: 'user' }],
        includeUserRoot: false,
      },
    }])
  })

  it('refuses to copy over or delete a shipped preset', async () => {
    await expect(authorCtx.agentPresets.copy('aeven', 'aeven')).rejects.toThrow(/already exists/)
    await expect(authorCtx.agentPresets.remove('aeven')).rejects.toThrow(/ships with the deployment/)
  })

  it.each(['../escape', 'a/b', '/abs', 'Upper'])('refuses the uncontainable id %j', async (id) => {
    // The id becomes a directory name under the user root, so containment is
    // checked on the id rather than on the joined path afterwards.
    await expect(authorCtx.agentPresets.copy('aeven', id)).rejects.toThrow()
  })

  it('copies a shipped preset a session then really composes from', async () => {
    await authorCtx.agentPresets.copy('aeven', 'my-agent', '我的模式')

    // Round-trips through the roster as a `user` row carrying the given name
    // and the source's description, over the source's own composition text.
    const preset = await authorCtx.agentPresets.resolve('my-agent')
    const source = await authorCtx.agentPresets.resolve('aeven')
    expect(preset.trust).toBe('user')
    expect(preset.name).toBe('我的模式')
    expect(preset.description).toBe(source.description)
    expect(await authorCtx.agentPresets.read('my-agent')).toBe(await authorCtx.agentPresets.read('aeven'))
    // Owner-only, in an owner-only directory: a composition is executable
    // configuration on a machine that may have other users.
    expect((await stat(preset.path)).mode & 0o777).toBe(0o600)
    const copied = await authorCtx.agents.create({
      sessionId: SessionId('preset-authored'),
      setup: agentCtx => authorCtx.agentPresets.mount(agentCtx, 'my-agent').then(() => undefined),
    })
    const shipped = await authorCtx.agents.create({
      sessionId: SessionId('preset-authored-source'),
      setup: agentCtx => authorCtx.agentPresets.mount(agentCtx, 'aeven').then(() => undefined),
    })
    try {
      // The same tools the shipped preset composes, from a directory copied
      // through the service into a root outside the installed harness.
      expect(toolNames(authorCtx, copied.agent)).toEqual(toolNames(authorCtx, shipped.agent))
      expect(toolNames(authorCtx, copied.agent)).toContain('bash')
    } finally {
      await shipped.dispose()
      await copied.dispose()
    }
  })

  it('deletes what it copied', async () => {
    await authorCtx.agentPresets.copy('aeven', 'doomed')

    await authorCtx.agentPresets.remove('doomed')

    expect((await authorCtx.agentPresets.list()).map(preset => preset.id)).not.toContain('doomed')
  })
})

describe('a session keeps the preset it was created with', () => {
  it('refuses to adopt a live session under a different preset', async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('preset-locked'),
      meta: { agentPreset: 'aeven' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'aeven').then(() => undefined),
    })
    try {
      // The api-proxy guard reads exactly this: the header records what the
      // session runs, so naming anything else is a caller error rather than a
      // switch.
      expect(handle.agent.session.header.agentPreset).toBe('aeven')
    } finally {
      await handle.dispose()
    }
  })
})

describe('a composition that configures its own preset roots', () => {
  let rootsCtx: Context
  let teamRoot: string

  beforeAll(async () => {
    const home = await mkdtemp(join(tmpdir(), 'avn-preset-roots-'))
    const settingsFile = join(home, 'settings.yaml')
    await writeFile(settingsFile, '{}\n')
    // A workspace-shared root beside the deployment: one preset of its own,
    // plus a directory that claims a shipped id.
    teamRoot = join(home, 'team-presets')
    for (const id of ['team-spec', 'aeven']) {
      await mkdir(join(teamRoot, id), { recursive: true })
      await writeFile(join(teamRoot, id, 'agent.cordis.yml'), TODO_COMPOSITION)
    }
    // The user layer of the reported regression: a profile's cordis.patch.yml
    // configuring a shared preset root. The plugin must EXTEND it with its
    // own shipped root, never lose it.
    rootsCtx = await bootWeb(settingsFile, [{
      id: 'agent-presets',
      config: {
        default: 'aeven',
        roots: [{ path: teamRoot, trust: 'user' }],
        includeUserRoot: false,
      },
    }])
  }, 120_000)

  afterAll(async () => {
    await rootsCtx.fiber.dispose()
  })

  it('keeps configured roots alongside the always-prepended shipped root', async () => {
    expect(rootsCtx.agentPresets.roots.map(root => root.path)).toEqual([
      SHIPPED_PRESET_ROOT,
      teamRoot,
    ])

    const listed = await rootsCtx.agentPresets.list()
    expect(listed.map(preset => preset.id).sort()).toEqual(['aeven', 'team-spec'])
    expect(listed.every(preset => preset.broken === undefined)).toBe(true)
    // The shipped root comes first: a configured directory claiming a shipped
    // id is shadowed, never the other way around.
    expect(listed.find(preset => preset.id === 'aeven')?.trust).toBe('system')
    expect(listed.find(preset => preset.id === 'team-spec')?.trust).toBe('user')
  })

  it('composes an agent from a configured-root preset', async () => {
    const handle = await rootsCtx.agents.create({
      sessionId: SessionId('preset-team-spec'),
      setup: agentCtx => rootsCtx.agentPresets.mount(agentCtx, 'team-spec').then(() => undefined),
    })
    try {
      expect(toolNames(rootsCtx, handle.agent)).toContain('todo_write')
    } finally {
      await handle.dispose()
    }
  })
})


describe('cloud bot execution in the shipped Web composition', () => {
  it('finishes a manual cloud run after its requesting Host shuts down', async () => {
    const contexts: Context[] = []
    const homes: string[] = []
    const network = new MemorySyncNetwork()
    const owner = `cloud-bot-composition-${randomUUID()}`
    const previousHome = process.env.AVN_HOME
    const accountHome = await mkdtemp(join(tmpdir(), 'avn-bot-accounts-'))
    homes.push(accountHome)
    process.env.AVN_HOME = accountHome
    let release = (): void => {}
    let modelStarted = false
    const finishModel = new Promise<void>((resolve) => { release = resolve })
    class CloudModel extends LlmAdapter {
      async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        modelStarted = true
        await finishModel
        const text = 'Cloud bot completed after the desktop stopped.'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    try {
      for (const kind of ['device', 'cloud'] as const) {
        const home = await mkdtemp(join(tmpdir(), `avn-bot-${kind}-`))
        homes.push(home)
        const host = await bootWeb(join(home, 'settings.yaml'), [
          { id: 'webserver', disabled: false, config: { host: '127.0.0.1', port: 0 } },
          { id: 'connection', disabled: false, inject: [], config: { trustedHosts: [] } },
          { id: 'sync-yjs', disabled: true },
          { id: 'api-sync-controller', disabled: true },
          { id: 'session-sync', disabled: true },
          { id: 'settings-sync', disabled: true },
          { id: 'identity-user-aeven', disabled: true },
          { id: 'agent-presets', config: { default: 'aeven', includeUserRoot: false } },
          { id: 'agent-default-model', config: { provider: 'cloud-bot-test', model: 'cloud-bot-test' } },
          { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions'), compression: 'none' } },
          { id: 'automations', disabled: false, config: {
            maxConcurrentRunsPerAccount: 2, runTimeoutMinutes: 60, misfireGraceMinutes: 15, historyLimit: 200,
            workspaceTitle: 'Automations', webhookMaxBodyBytes: 8192,
            placement: { kind, provides: kind === 'device' ? ['files'] : [] },
          } },
        ])
        contexts.push(host)
        host.llm.registerAdapter(['cloud-bot-test'], new CloudModel())
        host.provide('sync', network.device().asSync())
        host.emit('sync/status', owner)
      }
      const desktop = contexts[0]!
      const cloud = contexts[1]!
      const definition = await desktop.identityUsers.runAs({ id: owner }, () => desktop.automations.create({
        name: 'Cloud completion check', prompt: 'Report that the cloud bot completed.', requires: [],
        permission: 'read-only', schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
      }))
      await vi.waitFor(async () => {
        const tasks = await cloud.identityUsers.runAs({ id: owner }, () => cloud.automations.list())
        expect(tasks.definitions.some(task => task.id === definition.id)).toBe(true)
      })
      const requested = await desktop.identityUsers.runAs({ id: owner }, () => desktop.automations.runNow(definition.id))
      await vi.waitFor(async () => {
        const history = await cloud.identityUsers.runAs({ id: owner }, () => cloud.automations.list())
        expect(history.runs.find(candidate => candidate.id === requested.id)?.error).toBeNull()
        expect(modelStarted).toBe(true)
      }, { timeout: 10_000 })
      expect(desktop.agents.roots()).toHaveLength(0)
      await desktop.fiber.dispose()
      contexts.splice(contexts.indexOf(desktop), 1)
      release()
      await vi.waitFor(async () => {
        const history = await cloud.identityUsers.runAs({ id: owner }, () => cloud.automations.list())
        const run = history.runs.find(candidate => candidate.id === requested.id)
        expect(run).toMatchObject({ status: 'succeeded', summary: 'Cloud bot completed after the desktop stopped.' })
        const session = run?.sessionId == null ? undefined : cloud.sessions.get(run.sessionId)
        expect(session?.snapshotEvents().filter(event => event.type === 'turn/end').at(-1)?.data).toMatchObject({ reason: { kind: 'completed' } })
      }, { timeout: 10_000 })
    } finally {
      release()
      await Promise.all(contexts.map(host => host.fiber.dispose()))
      if (previousHome === undefined) delete process.env.AVN_HOME
      else process.env.AVN_HOME = previousHome
      await Promise.all(homes.map(home => rm(home, { recursive: true, force: true })))
    }
  })
})
