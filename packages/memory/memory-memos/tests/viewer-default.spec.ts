/**
 * The MemOS Viewer is a read/write surface over every owner's memory with no sign-in, so it stays off unless a
 * composition asks for it. These cases pin that default and the guard on where it may bind.
 */
import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'

/**
 * The loader hands the schema the fields a composition set and the schema supplies the rest, so resolution is
 * defined over a partial config; the schema's annotation types its callable with the resolved output instead.
 */
const resolve = (input: Partial<Config>): Config => Config(input as Config)

describe('memory-memos viewer configuration', () => {
  it('keeps the Viewer off when a composition does not ask for it', () => {
    expect(resolve({ home: '/tmp/memos' }).viewer).toBe(false)
  })

  it('starts the Viewer only when a composition turns it on', () => {
    expect(resolve({ home: '/tmp/memos', viewer: true }).viewer).toBe(true)
  })

  it('binds the Viewer to loopback unless a composition names another address', () => {
    expect(resolve({ home: '/tmp/memos' }).viewerHost).toBe('127.0.0.1')
  })
})
