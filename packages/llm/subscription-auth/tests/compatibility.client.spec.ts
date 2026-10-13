import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { createAvnClientAdapter } from '../src/client/avnClientAdapter.ts'

describe('AVN client compatibility contracts', () => {
  it('accepts the exact browser surface used by the settings participant', () => {
    const context = {
      effect() {},
      locale: { register() {}, bind() {} },
      slots: { inject() {}, register() {} },
    } as unknown as ClientContext
    const adapter = createAvnClientAdapter(context)
    expect(adapter.diagnostics()).toEqual([])
    expect(() =>{  adapter.assertCompatible() }).not.toThrow()
  })

  it('keeps an independent settings entry when slots are unavailable', () => {
    const effectDisposers: Array<() => void> = []
    const context = {
      effect(callback: () => (() => void) | undefined) {
        const dispose = callback()
        if (dispose) effectDisposers.push(dispose)
      },
      locale: { register() {}, bind() {} },
    } as unknown as ClientContext
    const mountFallback = vi.fn(() => vi.fn())
    const register = vi.fn(() => vi.fn())
    const adapter = createAvnClientAdapter(context)

    expect(adapter.diagnostics()).toContainEqual(
      expect.objectContaining({ id: 'client.slots.inject', level: 'warning' }),
    )
    expect(() =>{  adapter.assertCompatible() }).not.toThrow()
    adapter.installSlots({ mountFallback, register })

    expect(mountFallback).toHaveBeenCalledOnce()
    expect(register).not.toHaveBeenCalled()
    effectDisposers.forEach((dispose) =>{  dispose() })
    expect(mountFallback.mock.results[0]?.value).toHaveBeenCalledOnce()
  })

  it('registers direct slots without mounting an independent entry', () => {
    const inject = vi.fn()
    const context = {
      effect(callback: () => (() => void) | undefined) {
        callback()
      },
      inject,
      locale: { register() {}, bind() {} },
      slots: { inject() {}, register() {} },
    } as unknown as ClientContext
    const mountFallback = vi.fn(() => vi.fn())
    const register = vi.fn(() => vi.fn())

    createAvnClientAdapter(context).installSlots({ mountFallback, register })

    expect(register).toHaveBeenCalledOnce()
    expect(mountFallback).not.toHaveBeenCalled()
    expect(inject).not.toHaveBeenCalled()
  })

  it('replaces the independent entry when delayed slots become available', () => {
    let activateSlots: ((context: ClientContext) => unknown) | undefined
    const context = {
      effect(callback: () => (() => void) | undefined) {
        callback()
      },
      inject(_services: readonly string[], callback: (context: ClientContext) => unknown) {
        activateSlots = callback
      },
      locale: { register() {}, bind() {} },
    } as unknown as ClientContext
    const disposeFallback = vi.fn()
    const mountFallback = vi.fn(() => disposeFallback)
    const register = vi.fn(() => vi.fn())
    createAvnClientAdapter(context).installSlots({ mountFallback, register })

    activateSlots?.({
      slots: { inject() {}, register() {} },
    } as unknown as ClientContext)
    activateSlots?.({
      slots: { inject() {}, register() {} },
    } as unknown as ClientContext)

    expect(disposeFallback).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledOnce()
  })

  it('uses Cordis reflection without reading an uninjected slots property', () => {
    const slots = { inject() {}, register() {} }
    const target = {
      effect(callback: () => (() => void) | undefined) {
        callback()
      },
      inject: vi.fn(),
      get(name: string) {
        return name === 'slots' ? slots : undefined
      },
      locale: { register() {}, bind() {} },
    }
    const context = new Proxy(target, {
      get(object, property, receiver) {
        if (property === 'slots') throw new Error('cannot get property "slots" without inject')
        return Reflect.get(object, property, receiver) as unknown
      },
    }) as unknown as ClientContext
    const mountFallback = vi.fn(() => vi.fn())
    const register = vi.fn(() => vi.fn())

    const adapter = createAvnClientAdapter(context)
    expect(adapter.diagnostics()).toEqual([])
    adapter.installSlots({ mountFallback, register })

    expect(register).toHaveBeenCalledOnce()
    expect(mountFallback).not.toHaveBeenCalled()
    expect(target.inject).not.toHaveBeenCalled()
  })

  it('refuses a context that is not an object at all instead of pretending it is compatible', () => {
    // Nothing on a non-object context can carry a capability, so every check fails.
    const adapter = createAvnClientAdapter('not-a-context' as unknown as ClientContext)

    expect(adapter.diagnostics().map(item => item.id)).toEqual([
      'client.effect',
      'client.locale.register',
      'client.locale.bind',
      'client.slots.inject',
    ])
    expect(adapter.diagnostics()[0]?.message).toBe('client.effect is unavailable in the AVN client runtime')
    expect(adapter.diagnostics()[3]?.message).toBe(
      'client.slots.inject is unavailable; the independent settings entry remains active',
    )
    expect(() => {
      adapter.assertCompatible()
    }).toThrow('incompatible AVN client API: client.effect, client.locale.register, client.locale.bind')
  })
})
