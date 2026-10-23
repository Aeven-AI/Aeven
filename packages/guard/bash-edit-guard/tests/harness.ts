/**
 * Shared mounting for the bash-edit-guard suites: the real tool registry, shell
 * fixtures that record their own dispatches, and, when a session cwd is
 * requested, a real agent loop whose session owns that directory.
 */

import { Context, type Fiber } from '@deepseek-ai/cordis'
import { ToolCallId } from '@aeven/llm'
import { SessionId } from '@aeven/session'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime, { defineContentToolFixture, type ToolExecutionResult } from '@aeven/tools'
import type { Agent } from '@aeven/agent'
import AgentLoop from '@aeven/agent-loop'
import { mountAgentLoopTestDependencies } from '@aeven/agent-loop-testkit'
import SessionProjectionRegistry from '@aeven/session-projection'
import * as BashEditGuard from '@aeven/bash-edit-guard'
import type { Config } from '@aeven/bash-edit-guard'

/** Tools the harness registers; the second one exists for configured-name cases. */
const SHELL_TOOLS = ['bash', 'sh', 'read'] as const

const signal = new AbortController().signal

/** One mounted guard plus the record of what actually executed. */
export interface GuardHarness {
  readonly ctx: Context
  /** The guard's own fiber, so a case can dispose it and observe the removal. */
  readonly guard: Fiber
  /** Tool names whose body ran; a refused call records nothing. */
  readonly executed: string[]
  /** Dispatch one guarded shell call with a fully formed arguments value. */
  dispatch(input: { tool?: string; arguments: unknown }): Promise<ToolExecutionResult>
  /** Dispatch a shell call whose command is `command`, optionally with a `workdir` argument. */
  run(command: string, workdir?: string): Promise<ToolExecutionResult>
}

/** The guard's defaults with the caller's fields overridden. */
export function guardConfig(overrides: { tools?: string[]; sourceExtensions?: string[] } = {}): Config {
  const defaults = BashEditGuard.Config()
  return {
    tools: overrides.tools ?? defaults.tools,
    sourceExtensions: overrides.sourceExtensions ?? defaults.sourceExtensions,
  }
}

/** Text of the first content block of a result. */
export function textOf(result: ToolExecutionResult): string {
  const block = result.content[0]
  return block !== undefined && block.type === 'text' ? block.text : ''
}

/**
 * Mount the guard beside the tool registry.
 * @param options - guard configuration and, when present, the session cwd of a real agent.
 * @returns the harness; the caller owns the context and must dispose it.
 */
export async function mountGuard(options: { config?: Config; cwd?: string } = {}): Promise<GuardHarness> {
  const ctx = new Context()
  let agent: Agent | undefined
  if (options.cwd === undefined) {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
  } else {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    agent = ctx.agentLoop.create(SessionId('bash-edit-guard'), { provider: 'mock', model: 'mock' }, { cwd: options.cwd })
  }
  const guard = await ctx.plugin(BashEditGuard, options.config ?? guardConfig())

  const executed: string[] = []
  for (const toolName of SHELL_TOOLS) {
    ctx.tools.register(defineContentToolFixture({
      name: toolName,
      description: `runs a ${toolName} command`,
      parameters: {},
      execute: () => {
        executed.push(toolName)
        return Promise.resolve([{ type: 'text' as const, text: `${toolName} ran` }])
      },
    }))
  }

  const dispatch: GuardHarness['dispatch'] = input => ctx.tools.execute({
    callId: ToolCallId('c1'),
    name: input.tool ?? 'bash',
    arguments: input.arguments,
    signal,
    ...agent === undefined ? {} : { agent },
  })

  return {
    ctx,
    guard,
    executed,
    dispatch,
    run: (command, workdir) => dispatch({
      arguments: workdir === undefined ? { command } : { command, workdir },
    }),
  }
}
