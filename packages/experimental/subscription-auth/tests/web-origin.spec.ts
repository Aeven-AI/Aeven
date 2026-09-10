import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  createOwnerRequestPolicy,
  isTrustedLoopbackWebRequest,
  OWNER_CSRF_HEADER,
  OWNER_PROOF_HEADER,
  safeguardOwnerRequestPolicy,
} from '../src/web-origin.ts'

function request(
  host: string | undefined,
  origin: string | undefined,
  remoteAddress = '127.0.0.1',
  secFetchSite?: string,
): IncomingMessage {
  return {
    headers: {
      ...(host === undefined ? {} : { host }),
      ...(origin === undefined ? {} : { origin }),
      ...(secFetchSite === undefined ? {} : { 'sec-fetch-site': secFetchSite }),
    },
    socket: { remoteAddress },
  } as unknown as IncomingMessage
}

function proxyRequest(headers: Record<string, string>, remoteAddress = '10.0.0.8'): IncomingMessage {
  return {
    headers,
    socket: { remoteAddress },
  } as unknown as IncomingMessage
}

describe('isTrustedLoopbackWebRequest', () => {
  it('accepts matching loopback Host and Origin forms', () => {
    expect(isTrustedLoopbackWebRequest(request('127.0.0.1:3080', 'http://127.0.0.1:3080'))).toBe(true)
    expect(isTrustedLoopbackWebRequest(request('localhost:3080', 'https://localhost:3080', '::ffff:127.0.0.1'))).toBe(
      true,
    )
    expect(isTrustedLoopbackWebRequest(request('[::1]:3080', 'http://[::1]:3080', '::1'))).toBe(true)
    expect(isTrustedLoopbackWebRequest(request('127.0.0.2:3080', 'http://127.0.0.2:3080', '127.0.0.2'))).toBe(true)
    expect(
      isTrustedLoopbackWebRequest(request('127.255.1.2:3080', 'http://127.255.1.2:3080', '::ffff:127.255.1.2')),
    ).toBe(true)
    expect(isTrustedLoopbackWebRequest(request('localhost', undefined))).toBe(true)
  })

  it('rejects DNS-rebinding Host values even when Origin matches', () => {
    expect(isTrustedLoopbackWebRequest(request('attacker.example', undefined))).toBe(false)
    expect(isTrustedLoopbackWebRequest(request('attacker.example:3080', 'http://attacker.example:3080'))).toBe(false)
    expect(
      isTrustedLoopbackWebRequest(request('127.0.0.1.attacker.example', 'http://127.0.0.1.attacker.example')),
    ).toBe(false)
  })

  it('rejects mismatched origins, cross-site fetches, malformed hosts, and non-loopback peers', () => {
    expect(isTrustedLoopbackWebRequest(request('127.0.0.1:3080', 'http://localhost:3080'))).toBe(false)
    expect(isTrustedLoopbackWebRequest(request('127.0.0.1:3080', 'file:///tmp/test'))).toBe(false)
    expect(isTrustedLoopbackWebRequest(request('user@127.0.0.1:3080', undefined))).toBe(false)
    expect(isTrustedLoopbackWebRequest(request(undefined, undefined))).toBe(false)
    expect(isTrustedLoopbackWebRequest(request('127.0.0.1:3080', undefined, '10.0.0.1'))).toBe(false)
    expect(isTrustedLoopbackWebRequest(request('127.0.0.1:3080', undefined, '127.0.0.1', 'cross-site'))).toBe(false)
  })

  it('rejects an unparseable Host or Origin instead of throwing out of the guard', () => {
    expect(isTrustedLoopbackWebRequest(request('[', undefined))).toBe(false)
    expect(isTrustedLoopbackWebRequest(request('127.0.0.1:3080', 'not a url'))).toBe(false)
  })

  it('treats a request without a usable remote address as an untrusted peer', () => {
    const headers = { host: '127.0.0.1:3080' }
    expect(isTrustedLoopbackWebRequest({ headers, socket: {} } as unknown as IncomingMessage)).toBe(false)
    expect(isTrustedLoopbackWebRequest(proxyRequest(headers, '   '))).toBe(false)
  })
})

describe('OwnerRequestPolicy', () => {
  const config = {
    trustedProxy: {
      peers: ['10.0.0.8'],
      origins: ['https://dsh.example.test'],
      ownerProof: 'owner-proof-secret',
      csrfToken: 'csrf-proof-secret',
    },
  } as const

  it('retains loopback access and reports its access mode', () => {
    const policy = createOwnerRequestPolicy(config)
    expect(policy.authorize(request('127.0.0.1:3080', 'http://127.0.0.1:3080'))).toEqual({
      authorized: true,
      accessMode: 'loopback',
    })
  })

  it('admits a trusted proxy only when every independent proof is present', () => {
    const policy = createOwnerRequestPolicy(config)
    const headers = {
      host: 'dsh.example.test',
      origin: 'https://dsh.example.test',
      'sec-fetch-site': 'same-origin',
      [OWNER_PROOF_HEADER]: 'owner-proof-secret',
      [OWNER_CSRF_HEADER]: 'csrf-proof-secret',
    }
    expect(policy.authorize(proxyRequest(headers))).toEqual({
      authorized: true,
      accessMode: 'trusted-https-proxy',
    })
    for (const key of ['host', 'origin', 'sec-fetch-site', OWNER_PROOF_HEADER, OWNER_CSRF_HEADER] as const) {
      const incomplete = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== key))
      expect(policy.authorize(proxyRequest(incomplete)).authorized).toBe(false)
    }
  })

  it('ignores spoofed forwarded headers from an untrusted peer', () => {
    const policy = createOwnerRequestPolicy(config)
    const decision = policy.authorize(
      proxyRequest(
        {
          host: 'attacker.invalid',
          origin: 'https://dsh.example.test',
          'sec-fetch-site': 'same-origin',
          'x-forwarded-for': '10.0.0.8',
          'x-forwarded-host': 'dsh.example.test',
          [OWNER_PROOF_HEADER]: 'owner-proof-secret',
          [OWNER_CSRF_HEADER]: 'csrf-proof-secret',
        },
        '192.0.2.24',
      ),
    )
    expect(decision).toEqual({ authorized: false, reason: 'peer' })
  })

  it('fails closed when a DSH-native owner policy throws or returns invalid data', () => {
    for (const candidate of [
      {
        authorize() {
          throw new Error('host churn')
        },
        diagnostics() {
          throw new Error('host churn')
        },
      },
      { authorize: () => ({ authorized: true }), diagnostics: () => ['invalid'] },
    ]) {
      const policy = safeguardOwnerRequestPolicy(candidate as never)
      expect(policy.authorize(request('localhost:3080', undefined)).authorized).toBe(false)
      expect(policy.diagnostics()).toEqual([expect.objectContaining({ level: 'error' })])
    }
  })

  it('does not let a configured same-host proxy peer fall back to loopback authorization', () => {
    const policy = createOwnerRequestPolicy({
      trustedProxy: {
        peers: ['127.0.0.1'],
        origins: ['https://dsh.example.test'],
        ownerProof: 'owner-proof-secret',
        csrfToken: 'csrf-proof-secret',
      },
    })
    expect(policy.authorize(request('127.0.0.1:3080', undefined))).toEqual({
      authorized: false,
      reason: 'origin',
    })
  })

  it('fails closed when the trusted proxy configuration is incomplete or reuses one proof', () => {
    for (const trustedProxy of [
      { peers: ['10.0.0.8'], origins: ['https://dsh.example.test'], ownerProof: 'owner' },
      {
        peers: ['10.0.0.8'],
        origins: ['https://dsh.example.test'],
        ownerProof: 'same',
        csrfToken: 'same',
      },
    ]) {
      const policy = createOwnerRequestPolicy({ trustedProxy })
      expect(
        policy.authorize(
          proxyRequest({
            origin: 'https://dsh.example.test',
            'sec-fetch-site': 'same-origin',
            [OWNER_PROOF_HEADER]: 'owner',
            [OWNER_CSRF_HEADER]: 'csrf',
          }),
        ),
      ).toEqual({ authorized: false, reason: 'incomplete-policy' })
      expect(policy.diagnostics().some(item => item.level === 'error')).toBe(true)
    }
  })

  it('rejects an origin fragment instead of normalizing it into the allowlist', () => {
    const policy = createOwnerRequestPolicy(config)
    expect(
      policy.authorize(
        proxyRequest({
          origin: 'https://dsh.example.test/#spoofed',
          'sec-fetch-site': 'same-origin',
          [OWNER_PROOF_HEADER]: 'owner-proof-secret',
          [OWNER_CSRF_HEADER]: 'csrf-proof-secret',
        }),
      ),
    ).toEqual({ authorized: false, reason: 'origin' })
  })

  it('rejects a non-loopback Origin hostname against a loopback Host', () => {
    const policy = createOwnerRequestPolicy()
    expect(policy.authorize(request('127.0.0.1:3080', 'http://attacker.example:3080'))).toEqual({
      authorized: false,
      reason: 'origin',
    })
  })

  it('returns the loopback denial unchanged when no proxy is configured', () => {
    const policy = createOwnerRequestPolicy()
    expect(policy.authorize(request('127.0.0.1:3080', undefined, '10.0.0.1'))).toEqual({
      authorized: false,
      reason: 'peer',
    })
  })

  it('rejects a proxy Host header the URL parser cannot read', () => {
    const policy = createOwnerRequestPolicy(config)
    expect(
      policy.authorize(
        proxyRequest({
          host: '[',
          origin: 'https://dsh.example.test',
          'sec-fetch-site': 'same-origin',
          [OWNER_PROOF_HEADER]: 'owner-proof-secret',
          [OWNER_CSRF_HEADER]: 'csrf-proof-secret',
        }),
      ),
    ).toEqual({ authorized: false, reason: 'host' })
  })

  it('fails closed when the proxy configuration omits peers or origins', () => {
    for (const trustedProxy of [
      { origins: ['https://dsh.example.test'], ownerProof: 'owner-proof-secret', csrfToken: 'csrf-proof-secret' },
      { peers: ['10.0.0.8'], ownerProof: 'owner-proof-secret', csrfToken: 'csrf-proof-secret' },
    ]) {
      const policy = createOwnerRequestPolicy({ trustedProxy })
      expect(
        policy.authorize(
          proxyRequest({
            host: 'dsh.example.test',
            origin: 'https://dsh.example.test',
            'sec-fetch-site': 'same-origin',
            [OWNER_PROOF_HEADER]: 'owner-proof-secret',
            [OWNER_CSRF_HEADER]: 'csrf-proof-secret',
          }),
        ),
      ).toEqual({ authorized: false, reason: 'incomplete-policy' })
      expect(policy.diagnostics().some(item => item.id === 'owner-request.trusted-proxy-incomplete')).toBe(true)
    }
  })

  it('discards a non-https allowlist origin', () => {
    const policy = createOwnerRequestPolicy({
      trustedProxy: {
        peers: ['10.0.0.8'],
        origins: ['http://dsh.example.test'],
        ownerProof: 'owner-proof-secret',
        csrfToken: 'csrf-proof-secret',
      },
    })
    expect(policy.authorize(proxyRequest({ origin: 'http://dsh.example.test' }))).toEqual({
      authorized: false,
      reason: 'incomplete-policy',
    })
    expect(policy.diagnostics().some(item => item.id === 'owner-request.trusted-proxy-incomplete')).toBe(true)
  })

  it('discards an allowlist origin the URL parser cannot read', () => {
    const policy = createOwnerRequestPolicy({
      trustedProxy: {
        peers: ['10.0.0.8'],
        origins: ['not a url'],
        ownerProof: 'owner-proof-secret',
        csrfToken: 'csrf-proof-secret',
      },
    })
    expect(policy.authorize(proxyRequest({ origin: 'not a url' }))).toEqual({
      authorized: false,
      reason: 'incomplete-policy',
    })
    expect(policy.diagnostics().map(item => item.id)).toEqual([
      'owner-request.loopback',
      'owner-request.trusted-proxy-incomplete',
    ])
  })
})

describe('safeguardOwnerRequestPolicy', () => {
  it('passes a denied decision through while preserving only a string reason', () => {
    const reasoned = safeguardOwnerRequestPolicy({
      authorize: () => ({ authorized: false, reason: 'host-churn' }),
      diagnostics: () => [],
    })
    expect(reasoned.authorize(request('localhost:3080', undefined))).toEqual({
      authorized: false,
      reason: 'host-churn',
    })

    const unreasoned = safeguardOwnerRequestPolicy({
      authorize: () => ({ authorized: false }),
      diagnostics: () => [],
    })
    expect(unreasoned.authorize(request('localhost:3080', undefined))).toEqual({ authorized: false, reason: 'denied' })
  })

  it('keeps an authorized decision only when its access mode is known', () => {
    const known = safeguardOwnerRequestPolicy({
      authorize: () => ({ authorized: true, accessMode: 'ssh-tunnel' }),
      diagnostics: () => [],
    } as never)
    expect(known.authorize(request('localhost:3080', undefined))).toEqual({
      authorized: true,
      accessMode: 'ssh-tunnel',
    })

    const unknown = safeguardOwnerRequestPolicy({
      authorize: () => ({ authorized: true, accessMode: 'side-door' }),
      diagnostics: () => [],
    } as never)
    expect(unknown.authorize(request('localhost:3080', undefined))).toEqual({
      authorized: false,
      reason: 'invalid-owner-policy-decision',
    })
  })

  it('publishes a frozen copy of a valid diagnostic list', () => {
    const diagnostics = [
      { id: 'alpha', component: 'owner-request', level: 'info', message: 'informational' },
      { id: 'beta', component: 'owner-request', level: 'warning', message: 'degraded' },
      { id: 'gamma', component: 'owner-request', level: 'error', message: 'broken' },
    ]
    const policy = safeguardOwnerRequestPolicy({
      authorize: () => ({ authorized: false, reason: 'denied' }),
      diagnostics: () => diagnostics,
    } as never)
    const published = policy.diagnostics()
    expect(published).toEqual(diagnostics)
    expect(published).not.toBe(diagnostics)
    expect(Object.isFrozen(published)).toBe(true)
  })

  it('replaces diagnostics that miss an id or carry an unknown level', () => {
    const policy = safeguardOwnerRequestPolicy({
      authorize: () => ({ authorized: false, reason: 'denied' }),
      diagnostics: () => [
        { message: 'missing id' },
        { id: 'beta', level: 'trace', message: 'unknown level' },
      ],
    } as never)
    expect(policy.diagnostics()).toEqual([
      {
        id: 'owner-request.dsh-policy-invalid',
        component: 'owner-request',
        level: 'error',
        message: 'DSH owner-request policy returned invalid diagnostics',
      },
    ])
  })
})
