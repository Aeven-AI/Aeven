import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadDesktopPackagingEnvironment } from '../scripts/desktop-environment-file.ts'

const temporaryDirectories: string[] = []

async function envFile(contents: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'avn-desktop-env-'))
  temporaryDirectories.push(root)
  const path = join(root, '.env')
  await writeFile(path, contents)
  return path
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async path => rm(path, { recursive: true, force: true })))
})

describe('desktop packaging environment file', () => {
  it('copies only Desktop packaging settings and leaves other entries out', async () => {
    const path = await envFile([
      'OPENROUTER_API_KEY=secret',
      'AVN_DESKTOP_APP_ID=com.example.app',
      'DOWNLOAD_TEST_ORIGIN=https://updates.example.com',
      '',
    ].join('\n'))
    const environment: NodeJS.ProcessEnv = {}
    expect(loadDesktopPackagingEnvironment(path, environment)).toEqual(['AVN_DESKTOP_APP_ID'])
    expect(environment).toEqual({ AVN_DESKTOP_APP_ID: 'com.example.app' })
  })

  it('keeps a value the shell already set', async () => {
    const path = await envFile('AVN_DESKTOP_APP_ID=com.example.file\n')
    const environment: NodeJS.ProcessEnv = { AVN_DESKTOP_APP_ID: 'com.example.shell' }
    expect(loadDesktopPackagingEnvironment(path, environment)).toEqual([])
    expect(environment).toEqual({ AVN_DESKTOP_APP_ID: 'com.example.shell' })
  })

  it('supplies nothing when the file is absent', () => {
    const environment: NodeJS.ProcessEnv = {}
    expect(loadDesktopPackagingEnvironment(join(tmpdir(), 'avn-desktop-env-absent', '.env'), environment)).toEqual([])
    expect(environment).toEqual({})
  })
})
