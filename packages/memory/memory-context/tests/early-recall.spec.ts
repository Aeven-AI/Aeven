/**
 * A turn's recall starts from the claimed input before the rest of the pre-step chain runs, and is used only when the
 * chain's decision carries the same request.
 */
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@aeven/llm'
import type { PreStepDecision } from '@aeven/agent'
import { harness } from './harness.ts'

describe('early turn-start recall', () => {
  it('starts recall before the rest of the pre-step chain finishes, and uses it once', async () => {
    const { ctx, provider, step } = await harness()
    const release = Promise.withResolvers<undefined>()
    ctx.on('agent/pre-step', async (_payload, next): Promise<PreStepDecision> => {
      await release.promise
      return next()
    })

    const stepped = step(1)
    await Promise.resolve()
    expect(provider.requests.map(request => request.request)).toEqual(['I am exhausted today'])

    release.resolve(undefined)
    await stepped
    expect(provider.requests).toHaveLength(1)
  })

  it('cancels the early recall and recalls the request the chain rewrote it to', async () => {
    const { ctx, provider, step } = await harness()
    ctx.on('agent/pre-step', async (_payload, next): Promise<PreStepDecision> => {
      await next()
      const rewritten = createUserMessage({ content: [{ type: 'text', text: 'Plan the release' }], source: { kind: 'user' } })
      return { kind: 'enter', messages: [rewritten] }
    })

    await step(1)

    expect(provider.requests.map(request => request.request)).toEqual(['I am exhausted today', 'Plan the release'])
    expect(provider.requests[0]?.signal.aborted).toBe(true)
    expect(provider.requests[1]?.signal.aborted).toBe(false)
  })

  it('cancels the early recall when the chain rejects the step', async () => {
    const { ctx, provider, step } = await harness()
    ctx.on('agent/pre-step', async (_payload, next): Promise<PreStepDecision> => {
      await next()
      return { kind: 'reject' }
    })

    expect(await step(1)).toEqual([])
    expect(provider.requests).toHaveLength(1)
    expect(provider.requests[0]?.signal.aborted).toBe(true)
  })

  it('absorbs an early recall that fails after the chain replaced its request', async () => {
    const { ctx, provider, step } = await harness()
    const original = provider.recall.bind(provider)
    provider.recall = (request) => {
      if (request.request === 'I am exhausted today') {
        provider.requests.push(request)
        return Promise.reject(new Error('index closed'))
      }
      return original(request)
    }
    ctx.on('agent/pre-step', async (_payload, next): Promise<PreStepDecision> => {
      await next()
      return { kind: 'enter', messages: [createUserMessage({ content: [{ type: 'text', text: 'Plan the release' }], source: { kind: 'user' } })] }
    })

    await step(1)
    expect(provider.requests.map(request => request.request)).toEqual(['I am exhausted today', 'Plan the release'])
  })

  it('searches with the conversation before the request when there is one', async () => {
    const { provider, session, step } = await harness()
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'My sister moved to Utrecht' }], source: { kind: 'user' } }), { surfaceOp: 'append' })

    await step(2)
    expect(provider.requests[0]?.query).toBe('My sister moved to Utrecht\n\nI am exhausted today')
    expect(provider.requests[0]?.context).toBe('My sister moved to Utrecht')
  })

  it('starts nothing early for a step without request text', async () => {
    const { provider, step } = await harness()

    expect(await step(1, '')).toEqual([])
    expect(provider.requests).toHaveLength(0)
  })

  it('starts nothing early with recall turned off', async () => {
    const { provider, step } = await harness({ recall: false })

    await step(1)
    expect(provider.requests).toHaveLength(0)
  })
})
