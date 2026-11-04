/**
 * The globally named `list_agents` tool: a thin model-facing adapter over
 * the continuable projection of `ctx.subagents.listChildren()` and, for the
 * `descendants` scope, `ctx.subagents.listDescendants()`. It stays separately
 * loadable from the root `send_message` plugin so a deployment can register
 * continuation delivery without exposing discovery.
 * @module @aeven/tool-subagent-control/list-agents
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@aeven/tools'
import type { Agent } from '@aeven/agent'
import type { SessionId } from '@aeven/session'
import type { SubagentDescendantListEntry, SubagentListEntry } from '@aeven/subagent'

export const name = 'tool-subagent-list-agents'
export const inject = ['tools', 'subagents', 'agents']

type ListAgentsScope = 'children' | 'descendants'

interface ListAgentsRequest {
  readonly scope?: ListAgentsScope
}

interface ListAgentsSpec {
  readonly scope: ListAgentsScope
}

type ListAgentsEntry =
  | {
    readonly kind: 'child' | 'root'
    readonly id: SessionId
    readonly label: string
    readonly status: 'running' | 'idle' | 'ready'
    readonly parent?: SessionId
    readonly depth?: number
  }
  | {
    readonly kind: 'diagnostic'
    readonly id: SessionId
    readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
    readonly parent?: SessionId
    readonly depth?: number
  }

/** Resolve the optional model request into an internal required-scope spec. */
function resolveListAgentsRequest(request: ListAgentsRequest): ListAgentsSpec {
  return { scope: request.scope ?? 'descendants' }
}

/**
 * Refine one candidate's status through the live Agent registry: `running`
 * for an active driver, `idle` for a resident Agent between turns (possibly
 * waiting on agents it started), and `ready` when no live Agent remains.
 * `ready` preserves resumability without presenting an inactive conversation
 * as a terminal result to collect.
 */
function statusOf(agents: { get(id: SessionId): Agent | undefined }, id: SessionId): 'running' | 'idle' | 'ready' {
  const agent = agents.get(id)
  if (agent === undefined) return 'ready'
  return agent.status === 'running' ? 'running' : 'idle'
}

/** Project one service row into the model-facing entry, or omit a one-shot child. */
function project(
  agents: { get(id: SessionId): Agent | undefined },
  entry: SubagentListEntry,
  position?: Pick<SubagentDescendantListEntry, 'parentId' | 'depth'>,
): ListAgentsEntry | undefined {
  const at = position === undefined ? {} : { parent: position.parentId, depth: position.depth }
  if (entry.kind === 'diagnostic') {
    return { kind: 'diagnostic', id: entry.id, reason: entry.reason, ...at }
  }
  // One-shot children cannot be continued by send_message, so the model
  // never selects them; discovery still traversed them for descendants.
  if (entry.mode !== 'continuable') return undefined
  return {
    kind: 'child',
    id: entry.id,
    label: entry.label,
    status: statusOf(agents, entry.id),
    ...at,
  }
}

/**
 * Register the `list_agents` tool.
 * @param ctx - context carrying the tool registry, subagent service, and live Agent registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'list_agents',
    description:
      'List the root and continuable members of your subagent tree by agent id. Use send_message to contact '
      + 'another member. Status describes current activity, not task completion: running means working, idle '
      + 'means loaded between turns, and ready means stored and resumable. Unreadable branches appear as '
      + 'diagnostics. Scope descendants (default) lists the complete tree; children lists the root and its direct '
      + 'children. Listing never activates an agent and does not guarantee later delivery.',
    parameters: {
      scope: {
        type: 'string',
        enum: ['children', 'descendants'],
        description: 'descendants (default) lists the whole tree; children lists only the root and its direct children.',
      },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, enum: ['child', 'root'] },
                id: { type: 'string', required: true },
                label: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: ['running', 'idle', 'ready'] },
                parent: { type: 'string' },
                depth: { type: 'number' },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, enum: ['diagnostic'] },
                id: { type: 'string', required: true },
                reason: { type: 'string', required: true, enum: ['corrupt', 'unsupported', 'unavailable'] },
                parent: { type: 'string' },
                depth: { type: 'number' },
              },
            },
          ],
        },
      },
      render: (args, entries) => {
        const request = resolveListAgentsRequest(args)
        return [{
          type: 'text',
          text: entries.length === 0
            ? '(no subagents)'
            : entries.map((entry) => {
              // A descendants row always carries its position; children rows
              // never render it. String() spans the schema-optional shape
              // without a dead fallback branch.
              const at = request.scope === 'descendants'
                ? ` parent=${String(entry.parent)} depth=${String(entry.depth)}`
                : ''
              return entry.kind !== 'diagnostic'
                ? `${entry.id} [${entry.status}]${entry.kind === 'root' ? '' : at} — ${entry.label}`
                : `${entry.id} [diagnostic: ${entry.reason}]${at}`
            }).join('\n'),
        }]
      },
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) {
        // Non-agent callers have no session whose children could be listed.
        throw new Error('list_agents requires a calling agent (exec.agent was undefined)')
      }
      const root = ctx.subagents.rootOf(parent)
      const request = resolveListAgentsRequest(args)
      const entries = request.scope === 'children'
        ? (await ctx.subagents.listChildren(root.id, exec.signal)).map(entry => project(ctx.agents, entry))
        : (await ctx.subagents.listDescendants(root.id, exec.signal)).map(entry => project(ctx.agents, entry, entry))
      const rows: ListAgentsEntry[] = [{
        kind: 'root', id: root.id, label: 'root agent', status: statusOf(ctx.agents, root.id),
      }]
      for (const row of entries) {
        if (row !== undefined) rows.push(row)
      }
      return rows
    },
  }))
}
