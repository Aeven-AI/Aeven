/**
 * The Salesforce descriptor: which org hosts Settings accepts, and which hosted MCP endpoint an
 * org's connector mounts.
 */

import { describe, expect, it } from 'vitest'
import { salesforceMcpEndpoint, salesforceRequestSchema } from '../src/salesforce.ts'

const KEY = `3MVG9${'A'.repeat(80)}`

describe('Salesforce descriptor', () => {
  it('normalizes a My Domain URL to its host', () => {
    const parsed = salesforceRequestSchema.parse({ domain: ' https://ACME.my.salesforce.com/ ', clientId: KEY })
    expect(parsed.domain).toBe('acme.my.salesforce.com')
    expect(parsed).not.toHaveProperty('clientSecret')
  })

  it('accepts sandbox, scratch, and Developer Edition hosts', () => {
    for (const domain of ['acme--uat.sandbox.my.salesforce.com', 'fun-org-123.scratch.my.salesforce.com', 'acme-dev-ed.develop.my.salesforce.com']) {
      expect(salesforceRequestSchema.safeParse({ domain, clientId: KEY }).success, domain).toBe(true)
    }
  })

  it('refuses any host outside Salesforce My Domain and malformed credentials', () => {
    for (const domain of ['evil.example.com', 'acme.my.salesforce.com.evil.example', 'acme.my.salesforce.com/x', 'login.salesforce.com', '']) {
      expect(salesforceRequestSchema.safeParse({ domain, clientId: KEY }).success, domain).toBe(false)
    }
    expect(salesforceRequestSchema.safeParse({ domain: 'acme.my.salesforce.com', clientId: 'short' }).success).toBe(false)
    expect(salesforceRequestSchema.safeParse({ domain: 'acme.my.salesforce.com', clientId: KEY, clientSecret: 'not a secret!' }).success).toBe(false)
  })

  it('mounts the platform server for production orgs and the sandbox server for sandboxes', () => {
    expect(salesforceMcpEndpoint('acme.my.salesforce.com', 'sobject-all')).toBe('https://api.salesforce.com/platform/mcp/v1/platform/sobject-all')
    expect(salesforceMcpEndpoint('acme-dev-ed.develop.my.salesforce.com', 'sobject-all')).toBe('https://api.salesforce.com/platform/mcp/v1/platform/sobject-all')
    expect(salesforceMcpEndpoint('acme--uat.sandbox.my.salesforce.com', 'sobject-reads')).toBe('https://api.salesforce.com/platform/mcp/v1/sandbox/sobject-reads')
  })
})
