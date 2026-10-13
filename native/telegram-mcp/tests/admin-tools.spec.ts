/** The Aeven-owned tool helpers that hold logic worth pinning: matching, rights, and raw access. */

import bigInt from 'big-integer'
import { describe, expect, it } from 'vitest'
import { renderResult, resolveRequest } from '../aeven/api.ts'
import { matchMember } from '../aeven/refs.ts'
import { adminRightsFrom, ALL_MESSAGES, noRightsWithheld, POSTING_RESTRICTIONS, removalRights, withheldRights } from '../aeven/rights.ts'

/** Members as `getParticipants` returns them, narrowed to the fields a reference is matched against. */
const members = [
  { id: bigInt('8760033767'), username: 'tammybot', firstName: 'Tammy', lastName: 'Andrews' },
  { id: bigInt('42'), username: 'olivierdj', firstName: 'Olivier', lastName: '' },
  { id: bigInt('77'), deleted: true },
]

describe('member references', () => {
  it('matches an id exactly, with or without Telegram\'s group mark', () => {
    expect(matchMember(members, '8760033767')?.username).toBe('tammybot')
    expect(matchMember(members, '-1008760033767')?.username).toBe('tammybot')
  })

  it('matches a handle whatever its case', () => {
    expect(matchMember(members, '@TammyBot')?.id.toString()).toBe('8760033767')
    expect(matchMember(members, 'https://t.me/OlivierDJ')?.id.toString()).toBe('42')
  })

  it('matches a name fragment only when it names one member', () => {
    expect(matchMember(members, 'Andrews')?.id.toString()).toBe('8760033767')
    // A handle that matches nobody is not a name: it reports nothing rather than the wrong person.
    expect(matchMember(members, '@nosuchhandle')).toBeUndefined()
    expect(matchMember(members, 'nobody')).toBeUndefined()
  })

  it('names a deleted account rather than leaving it blank', () => {
    expect(matchMember(members, 'Deleted')?.id.toString()).toBe('77')
  })

  it('refuses an ambiguous name instead of guessing', () => {
    // Every fixture matches "e", so the reference names three people and none of them is picked.
    expect(() => matchMember(members, 'e')).toThrow(/matches 3 members — use an id or a @username/)
  })
})

describe('raw method access', () => {
  it('builds a request from the schema name', () => {
    const request = new (resolveRequest('messages.SearchGlobal'))({ q: 'spam' })
    expect((request as { className: string }).className).toBe('messages.SearchGlobal')
  })

  it('refuses the namespaces the connector owns, and names nobody has', () => {
    expect(() => resolveRequest('auth.SignIn')).toThrow(/out of reach/)
    expect(() => resolveRequest('account.DeleteAccount')).toThrow(/out of reach/)
    expect(() => resolveRequest('payments.SendPayment')).toThrow(/out of reach/)
    expect(() => resolveRequest('messages.NoSuchRequest')).toThrow(/no request/)
    expect(() => resolveRequest('SearchGlobal')).toThrow(/messages\.SearchGlobal/)
  })

  it('renders a bounded, readable result', () => {
    expect(renderResult(true)).toBe('Telegram answered: true.')
    expect(renderResult(undefined)).toBe('Telegram returned no result.')
    expect(renderResult({ link: 'https://t.me/+abc' })).toBe('{\n  "link": "https://t.me/+abc"\n}')
    const id = renderResult(bigInt('8760033767'))
    expect(id).toContain('8760033767')
    const huge = renderResult({ blob: 'x'.repeat(5000) })
    expect(huge.endsWith('… truncated')).toBe(true)
    expect(huge.length).toBeLessThan(4100)
  })
})

describe('rights vocabularies', () => {
  it('grants only the admin rights asked for', () => {
    const rights = adminRightsFrom(['ban_users', 'pin_messages'])
    expect(rights.banUsers).toBeTruthy()
    expect(rights.pinMessages).toBeTruthy()
    expect(rights.deleteMessages).toBeFalsy()
    expect(rights.addAdmins).toBeFalsy()
  })

  it('refuses an admin right nobody implements', () => {
    expect(() => adminRightsFrom(['ban_people'])).toThrow(/Unknown admin right "ban_people"/)
  })

  it('withholds the named restrictions and the whole posting set', () => {
    const named = withheldRights(['send_messages', 'invite_users'], 60)
    expect(named.sendMessages).toBeTruthy()
    expect(named.inviteUsers).toBeTruthy()
    expect(named.embedLinks).toBeFalsy()
    expect(named.untilDate).toBe(60)

    const all = withheldRights([ALL_MESSAGES])
    for (const field of ['sendMessages', 'sendMedia', 'sendStickers', 'sendGifs', 'sendPolls', 'embedLinks'] as const) {
      expect(all[field]).toBeTruthy()
    }
    // The posting shorthand leaves what is not posting alone.
    expect(all.changeInfo).toBeFalsy()
    expect(POSTING_RESTRICTIONS).toHaveLength(10)
  })

  it('builds the rights that remove a member and the ones that lift a ban', () => {
    expect(removalRights().viewMessages).toBeTruthy()
    expect(removalRights().untilDate).toBe(0)
    expect(noRightsWithheld().viewMessages).toBeFalsy()
    expect(noRightsWithheld().untilDate).toBe(0)
  })
})
