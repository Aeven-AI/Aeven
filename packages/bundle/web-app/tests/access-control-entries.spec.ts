/**
 * The entries a tolerant boot never starts without are named by Loader entry id, so each id must be
 * one the shipped composition declares: a renamed row would otherwise become skippable unnoticed.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCESS_CONTROL_ENTRIES } from '@aeven/app-boot'

const patch = (bundle: string): string => readFileSync(
  fileURLToPath(new URL(`../../${bundle}/cordis.patch.yml`, import.meta.url)),
  'utf8',
)

describe('access-control entries', () => {
  it('are rows of the base and web-app bundles', () => {
    const declared = `${patch('base')}\n${patch('web-app')}`
    for (const id of ACCESS_CONTROL_ENTRIES) {
      expect(declared, id).toMatch(new RegExp(`^\\s*- id: ${id}$`, 'mu'))
    }
  })
})
