/**
 * The Slack descriptor: the connector id one workspace keeps across reconnects, the redirect the
 * application must have registered, the scopes a login asks for, and the read/write classification
 * whose default is to ask.
 */

import { describe, expect, it } from 'vitest'
import { isSlackReadTool, slackConnectorId, slackRedirectUri, SLACK_DIRECT_MESSAGE_SCOPES, SLACK_MCP_ENDPOINT, SLACK_WORKSPACE_SCOPES } from '../src/slack.ts'

describe('Slack descriptor', () => {
  it('derives one stable connector id per account and workspace', () => {
    const first = slackConnectorId('owner-1', 'T0123')
    expect(first).toBe(slackConnectorId('owner-1', 'T0123'))
    expect(first).not.toBe(slackConnectorId('owner-2', 'T0123'))
    expect(first).not.toBe(slackConnectorId('owner-1', 'T9999'))
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('names the loopback redirect the application registers', () => {
    expect(slackRedirectUri(12_751)).toBe('http://127.0.0.1:12751/callback')
  })

  it('asks for the workspace surface without direct-message history', () => {
    expect(SLACK_MCP_ENDPOINT).toBe('https://mcp.slack.com/mcp')
    expect(SLACK_WORKSPACE_SCOPES).toContain('search:read.public')
    expect(SLACK_WORKSPACE_SCOPES).toContain('chat:write')
    for (const scope of SLACK_DIRECT_MESSAGE_SCOPES) expect(SLACK_WORKSPACE_SCOPES).not.toContain(scope)
    expect(new Set(SLACK_WORKSPACE_SCOPES).size).toBe(SLACK_WORKSPACE_SCOPES.length)
  })

  it('classifies reads by their own verb and asks about everything else', () => {
    for (const tool of ['slack_search_messages', 'search_messages', 'slack_read_channel', 'slack_list_user_channels', 'slack_get_reactions', 'slack_read_canvas', 'slack_find_users']) {
      expect(isSlackReadTool(tool), tool).toBe(true)
    }
    for (const tool of ['slack_send_message', 'slack_schedule_message', 'slack_add_reaction', 'slack_remove_reaction', 'slack_create_conversation', 'slack_update_canvas', 'slack_complete_file_upload', 'slack_get_file_upload_url', 'slack_delete_message', 'slack_list_user_channels_join', 'unknown_tool', '']) {
      expect(isSlackReadTool(tool), tool).toBe(false)
    }
  })
})
