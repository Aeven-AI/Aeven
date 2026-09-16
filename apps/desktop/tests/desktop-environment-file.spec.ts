import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadDesktopPackagingEnvironment } from '../scripts/desktop-environment-file.ts'

const temporaryDirectories: string[] = []

async function envFile(contents: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-env-'))
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
    expect(loadDesktopPackagingEnvironment(path, environment)).toEqual(['AVN_DESKTOP_APP_ID', 'DOWNLOAD_TEST_ORIGIN'])
    expect(environment).toEqual({
      AVN_DESKTOP_APP_ID: 'com.example.app',
      DOWNLOAD_TEST_ORIGIN: 'https://updates.example.com',
    })
  })

  it('keeps a value the shell already set', async () => {
    const path = await envFile('AVN_DESKTOP_APP_ID=com.example.file\nAVN_DESKTOP_AUTO_UPDATE_ENV=production\n')
    const environment: NodeJS.ProcessEnv = { AVN_DESKTOP_APP_ID: 'com.example.shell' }
    expect(loadDesktopPackagingEnvironment(path, environment)).toEqual(['AVN_DESKTOP_AUTO_UPDATE_ENV'])
    expect(environment).toEqual({ AVN_DESKTOP_APP_ID: 'com.example.shell', AVN_DESKTOP_AUTO_UPDATE_ENV: 'production' })
  })

  it('supplies nothing when the file is absent', () => {
    const environment: NodeJS.ProcessEnv = {}
    expect(loadDesktopPackagingEnvironment(join(tmpdir(), 'dsh-desktop-env-absent', '.env'), environment)).toEqual([])
    expect(environment).toEqual({})
  })
})
