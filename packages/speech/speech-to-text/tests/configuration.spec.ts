/** Speech preferences saved through the file-backed settings provider in a Loader composition, and restored at restart. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import FileSettingsProvider from '@aeven/settings-file'
import SpeechToText from '../src/index.ts'
import type { SpeechProviderId } from '../src/types.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot the settings and speech rows from a test-only cordis.yml under `home`. */
async function compose(home: string, withSettings: boolean): Promise<Context> {
  const settingsPath = join(home, 'settings.yaml')
  const configPath = join(home, 'cordis.yml')
  await writeFile(configPath, [
    ...withSettings ? [
      '- id: settings',
      "  name: '@aeven/settings-file'",
      '  config:',
      `    path: ${JSON.stringify(settingsPath)}`,
      '    debounceMs: 10',
    ] : [],
    '- id: speech-to-text',
    "  name: '@aeven/speech-to-text'",
    '  config:',
    '    defaultProvider: whisper-local',
    '',
  ].join('\n'))
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(home).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@aeven/settings-file', FileSettingsProvider],
    ['@aeven/speech-to-text', SpeechToText],
  ])
  // The custom importer bypasses Node resolution; mirror the manifests a deployed cordis.yml has beside it.
  await Promise.all([...modules.keys()].map(async (packageName) => {
    const packageDir = join(home, 'node_modules', ...packageName.split('/'))
    await mkdir(packageDir, { recursive: true })
    await writeFile(join(packageDir, 'package.json'), `${JSON.stringify({ name: packageName, version: '0.1.0', type: 'module' })}\n`)
  }))
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

function registerProviders(ctx: Context): void {
  const speech = ctx.get('speechToText')!
  for (const id of ['whisper-local', 'another-provider']) speech.register({
    info: { id: id as SpeechProviderId, name: id, location: 'host-local', languages: ['auto', 'nl', 'en'] },
    transcribe: () => Promise.reject(new Error('Changing preferences must not transcribe audio')),
  })
}

it('saves language and provider preferences without remounting and restores them at restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'avn-speech-configuration-'))
  root = home
  let ctx = await compose(home, true)
  registerProviders(ctx)
  const speech = ctx.get('speechToText')!
  await speech.configure({ language: 'nl' })
  expect(speech.snapshot().selection).toEqual({ providerId: 'whisper-local', language: 'nl' })
  await speech.configure({ providerId: 'another-provider' as SpeechProviderId })
  expect(ctx.get('speechToText')!.listProviders().map(info => info.id)).toEqual(['whisper-local', 'another-provider'])
  expect(speech.snapshot().selection).toEqual({ providerId: 'another-provider', language: 'nl' })
  const saved = await readFile(join(home, 'settings.yaml'), 'utf8')
  expect(saved).toContain('speech-to-text:')
  expect(saved).toContain('defaultProvider: another-provider')
  expect(saved).toContain('language: nl')

  await ctx.fiber.dispose()
  ctx = await compose(home, true)
  expect(ctx.get('speechToText')!.snapshot().selection).toEqual({ providerId: 'another-provider', language: 'nl' })
})

it('uses the composition defaults and refuses to save preferences when no settings service is mounted', async () => {
  const home = await mkdtemp(join(tmpdir(), 'avn-speech-configuration-'))
  root = home
  const ctx = await compose(home, false)
  registerProviders(ctx)
  const speech = ctx.get('speechToText')!
  expect(speech.snapshot().selection).toEqual({ providerId: 'whisper-local', language: 'auto' })
  await expect(speech.configure({ language: 'nl' })).rejects.toThrow('settings service')
})
