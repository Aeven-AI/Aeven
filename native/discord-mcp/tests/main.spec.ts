/** The environment: what the process needs, what it defaults, and what it refuses. */

import { describe, expect, it } from 'vitest'
import { createDiscordServer, readDiscordConfig } from '../aeven/main.ts'
import { TEST_ENV, TEST_GUILD } from './harness.ts'

describe('required variables', () => {
  it('refuses to build a server without an authorization value', () => {
    expect(() => createDiscordServer({ DISCORD_GUILD_ID: TEST_GUILD })).toThrow(/DISCORD_AUTHORIZATION is required/u)
  })

  it('refuses to build a server with an empty authorization value', () => {
    expect(() => createDiscordServer({ DISCORD_AUTHORIZATION: '', DISCORD_GUILD_ID: TEST_GUILD }))
      .toThrow(/DISCORD_AUTHORIZATION is required/u)
  })

  it('refuses to build a server without a guild id', () => {
    expect(() => createDiscordServer({ DISCORD_AUTHORIZATION: 'Bearer spec-session' })).toThrow(/DISCORD_GUILD_ID is required/u)
  })

  it('refuses to build a server with an empty guild id', () => {
    expect(() => createDiscordServer({ DISCORD_AUTHORIZATION: 'Bearer spec-session', DISCORD_GUILD_ID: '' }))
      .toThrow(/DISCORD_GUILD_ID is required/u)
  })
})

describe('bounded variables', () => {
  it('refuses a scan budget over the ceiling', () => {
    expect(() => readDiscordConfig({ ...TEST_ENV, DISCORD_MAX_SCAN_MESSAGES: '5001' })).toThrow(/DISCORD_MAX_SCAN_MESSAGES/u)
  })

  it('refuses a scan budget that is not a positive integer', () => {
    expect(() => readDiscordConfig({ ...TEST_ENV, DISCORD_MAX_SCAN_MESSAGES: '0' })).toThrow(/DISCORD_MAX_SCAN_MESSAGES/u)
    expect(() => readDiscordConfig({ ...TEST_ENV, DISCORD_MAX_SCAN_MESSAGES: 'many' })).toThrow(/DISCORD_MAX_SCAN_MESSAGES/u)
    expect(() => readDiscordConfig({ ...TEST_ENV, DISCORD_MAX_SCAN_MESSAGES: '1.5' })).toThrow(/DISCORD_MAX_SCAN_MESSAGES/u)
  })

  it('refuses a file cap, a timeout, or a base that cannot be used', () => {
    expect(() => readDiscordConfig({ ...TEST_ENV, DISCORD_MAX_FILE_BYTES: '-1' })).toThrow(/DISCORD_MAX_FILE_BYTES/u)
    expect(() => readDiscordConfig({ ...TEST_ENV, DISCORD_REQUEST_TIMEOUT_MS: '600001' })).toThrow(/DISCORD_REQUEST_TIMEOUT_MS/u)
  })

  it('treats an empty optional value as absent', () => {
    const config = readDiscordConfig({ ...TEST_ENV, DISCORD_GUILD_NAME: '', DISCORD_API_BASE: '' })
    expect(config.guildName).toBeUndefined()
    expect(config.apiBase).toBe('https://discord.com/api/v10')
  })
})

describe('defaults', () => {
  it('reads the documented defaults when only the two required values are set', () => {
    expect(readDiscordConfig({ DISCORD_AUTHORIZATION: 'Bearer spec-session', DISCORD_GUILD_ID: TEST_GUILD })).toEqual({
      authorization: 'Bearer spec-session',
      guildId: TEST_GUILD,
      guildName: undefined,
      adminTools: false,
      maxScanMessages: 500,
      maxFileBytes: 10_485_760,
      requestTimeoutMs: 20_000,
      apiBase: 'https://discord.com/api/v10',
    })
  })

  it('enables the administration surface only for the exact value "1"', () => {
    expect(readDiscordConfig({ ...TEST_ENV, DISCORD_ADMIN_TOOLS: '1' }).adminTools).toBe(true)
    for (const other of ['true', '0', 'yes', '01', 'TRUE']) {
      expect(readDiscordConfig({ ...TEST_ENV, DISCORD_ADMIN_TOOLS: other }).adminTools).toBe(false)
    }
  })

  it('never falls back to a default authorization value', () => {
    expect(() => readDiscordConfig({ DISCORD_GUILD_ID: TEST_GUILD })).toThrow(/DISCORD_AUTHORIZATION/u)
  })
})
