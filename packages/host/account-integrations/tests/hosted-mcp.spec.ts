/**
 * The vendor-hosted MCP descriptor: which providers mount a vendor's server, where, and which of
 * their tools run without approval.
 */

import { describe, expect, it } from 'vitest'
import { HOSTED_MCP_APPROVAL_REASONS, HOSTED_MCP_ENDPOINTS, isHostedMcp, isHostedMcpReadTool } from '../src/hosted-mcp.ts'

describe('hosted MCP descriptor', () => {
  it('mounts each vendor\'s own HTTPS endpoint and gives each an approval reason', () => {
    expect(Object.keys(HOSTED_MCP_ENDPOINTS).sort()).toEqual(['atlassian', 'monday', 'notion', 'stripe', 'vercel'])
    for (const [provider, endpoint] of Object.entries(HOSTED_MCP_ENDPOINTS)) {
      expect(new URL(endpoint).protocol, provider).toBe('https:')
      expect(HOSTED_MCP_APPROVAL_REASONS[provider as keyof typeof HOSTED_MCP_ENDPOINTS], provider).toMatch(/^Approve /)
    }
  })

  it('recognises only the hosted providers', () => {
    for (const provider of ['notion', 'vercel', 'atlassian', 'monday', 'stripe'] as const) expect(isHostedMcp(provider)).toBe(true)
    for (const provider of ['github', 'slack', 'microsoft-365', 'mcp', 'gmail'] as const) expect(isHostedMcp(provider)).toBe(false)
  })

  it('decides Notion reads from its published list, whatever the server annotates', () => {
    for (const tool of ['notion-search', 'notion-fetch', 'notion-get-comments', 'notion-query-data-sources']) {
      expect(isHostedMcpReadTool('notion', tool, false), tool).toBe(true)
    }
    for (const tool of ['notion-create-pages', 'notion-update-page', 'notion-delete-pages', 'notion-create-comment', 'notion-new-tool']) {
      expect(isHostedMcpReadTool('notion', tool, true), tool).toBe(false)
    }
  })

  it('trusts every other vendor\'s readOnlyHint and asks about an unmarked tool', () => {
    for (const provider of ['vercel', 'atlassian', 'monday', 'stripe'] as const) {
      expect(isHostedMcpReadTool(provider, 'list_things', true), provider).toBe(true)
      expect(isHostedMcpReadTool(provider, 'list_things', false), provider).toBe(false)
    }
  })
})
