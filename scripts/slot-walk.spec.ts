/**
 * The slot walker's file corpus.
 *
 * `scripts/oxlint-contract.spec.ts` writes a probe into a package's `src` and
 * removes it again, so a scan running beside that spec can enumerate a file
 * that is gone by the time it reads it. The walker holds its own temp root, so
 * this covers the exclusion without touching the repository.
 * @module
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { indexExportedTypes } from './slot-walk.ts'

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'slot-walk-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'index.ts'), 'export interface OwnerProps { readonly label: string }\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the files a slot scan indexes', () => {
  it('reads the declarations a package exports', () => {
    expect([...indexExportedTypes(root, ['src/**/*.ts']).keys()]).toEqual(['OwnerProps'])
  })

  it('leaves out the probe a lint-contract spec writes and removes', () => {
    writeFileSync(join(root, 'src', 'oxlint-contract-abc123.ts'), 'export function probePromise(): void {}\n')
    expect([...indexExportedTypes(root, ['src/**/*.ts']).keys()]).toEqual(['OwnerProps'])
  })

  it('indexes a file whose name only resembles a probe', () => {
    writeFileSync(join(root, 'src', 'oxlint-contracts.ts'), 'export interface Kept { readonly label: string }\n')
    expect([...indexExportedTypes(root, ['src/**/*.ts']).keys()].sort()).toEqual(['Kept', 'OwnerProps'])
  })
})
