// @vitest-environment jsdom
/**
 * The composer model seat is a two-level entry: a trigger that opens a
 * Model/Effort chooser, the Model row handing over to the shared popupSelect
 * shell and the Effort row drilling into the seat's own pane.
 * These cases pin the part the seat owns — the labels, the chooser's rows and
 * what each one opens, the drilled levels and what picking one submits, the
 * aria contract, and the locked/unavailable states. The model list's row
 * building, search, and submission belong to the shared specs and are covered
 * in browser-plugin.client.spec.ts.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@aeven/client-store'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@aeven/client-locale/src/locales/zh.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const reasoning = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max', description: 'Largest budget' },
  ],
  defaultEffort: 'high',
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{
        id: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
        description: 'Fast catalog description',
        reasoning,
      }],
    }],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

/** Render the seat over one directory snapshot and return its injected spies. */
function seat(
  directory: ModelDirectoryState,
  opts: { available?: boolean; locked?: boolean } = {},
) {
  const store = createSnapshotStore<ModelDirectoryState>(directory)
  const load = vi.fn()
  const openModel = vi.fn()
  const selectEffort = vi.fn(() => Promise.resolve(true))
  render(<ModelSelect
    locked={opts.locked ?? false}
    available={opts.available ?? true}
    directory={store}
    load={load}
    openModel={openModel}
    selectEffort={selectEffort}
    t={t}
  />)
  return { store, load, openModel, selectEffort }
}

/** Open the chooser and return its rows. */
function openChooser(): HTMLElement[] {
  fireEvent.click(screen.getByRole('button', { name: /选择模型|正在加载模型/ }))
  return screen.getAllByRole('menuitem')
}

afterEach(cleanup)

describe('ModelSelect chooser', () => {
  it('shows the model name with the adapter-effective effort and opens the chooser on press', () => {
    const { load, openModel, selectEffort } = seat(state())
    const trigger = screen.getByRole('button', {
      name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
    })
    expect(trigger.textContent).toBe('DeepSeek-V4-FlashHigh')

    const rows = openChooser()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    // The chooser is a step of its own: opening it resolves nothing yet.
    expect(load).toHaveBeenCalledTimes(1)
    expect(openModel).not.toHaveBeenCalled()
    expect(selectEffort).not.toHaveBeenCalled()
    expect(rows.map(row => row.textContent)).toEqual([
      '模型DeepSeek-V4-Flash',
      '推理等级High',
    ])
  })

  it('opens the model list from the Model row, handing the shell its own trigger as the anchor', () => {
    const { openModel, selectEffort } = seat(state())
    const [modelRow] = openChooser()
    const trigger = screen.getByRole('button', { name: /当前 DeepSeek-V4-Flash/ })

    fireEvent.click(modelRow!)
    expect(openModel).toHaveBeenCalledTimes(1)
    // The card is anchored to the control that opened it, not to the composer.
    expect(openModel.mock.calls[0]![0]).toBe(trigger)
    expect(selectEffort).not.toHaveBeenCalled()
    // Handing over closes the chooser; the list is the shared shell's.
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the effort pane in the seat and submits the picked level', async () => {
    const { openModel, selectEffort } = seat(state())

    fireEvent.click(screen.getByRole('button', { name: /当前 DeepSeek-V4-Flash/ }))
    fireEvent.click(screen.getAllByRole('menuitem')[1]!)

    // Same card, drilled one level: the levels are the model's own, the one in
    // force is checked, and nothing is submitted until one is picked.
    const levels = screen.getAllByRole('menuitemradio')
    expect(levels.map(level => level.textContent)).toEqual(['Off', 'High', 'Max'])
    expect(levels.map(level => level.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(openModel).not.toHaveBeenCalled()
    expect(selectEffort).not.toHaveBeenCalled()

    fireEvent.click(levels[2]!)
    expect(selectEffort).toHaveBeenCalledWith('max')
    // The chooser closes on the accepted submit.
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps the pane open with a notice when the host refuses the level', async () => {
    const store = createSnapshotStore<ModelDirectoryState>(state())
    let settle!: (accepted: boolean) => void
    const selectEffort = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve }))
    // The notice anchors to the composer card, exactly as it does in the app.
    render(<div data-composer-card>
      <ModelSelect
        locked={false}
        available
        directory={store}
        load={() => {}}
        openModel={() => {}}
        selectEffort={selectEffort}
        t={t}
      />
    </div>)

    fireEvent.click(screen.getByRole('button', { name: /当前 DeepSeek-V4-Flash/ }))
    fireEvent.click(screen.getAllByRole('menuitem')[1]!)
    fireEvent.click(screen.getAllByRole('menuitemradio')[2]!)

    // The refusal lands with its text on the shared store, which is what the
    // notice reads; the pane stays where it was instead of closing on a
    // selection that never happened.
    await act(async () => {
      store.update((s) => { s.error = '409: refused' })
      settle(false)
      await Promise.resolve()
    })
    expect(screen.getByRole('menu')).toBeTruthy()
    await waitFor(() => { expect(screen.getByText(/选择失败/)).toBeTruthy() })
  })

  it('backs out of the effort pane with Escape before closing the card', () => {
    seat(state())
    fireEvent.click(screen.getByRole('button', { name: /当前 DeepSeek-V4-Flash/ }))
    fireEvent.click(screen.getAllByRole('menuitem')[1]!)
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3)

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    // Back on the root, not closed.
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('presents the trigger as a menu button reflecting its own expanded state', () => {
    seat(state())
    const trigger = screen.getByRole('button', { name: /当前 DeepSeek-V4-Flash/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.getAttribute('title')).toBe('DeepSeek-V4-Flash · High')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('closes the chooser on Escape without opening the model list', () => {
    const { openModel, selectEffort } = seat(state())
    const trigger = screen.getByRole('button', { name: /当前 DeepSeek-V4-Flash/ })
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(openModel).not.toHaveBeenCalled()
    expect(selectEffort).not.toHaveBeenCalled()
  })

  it('offers no Effort row for a model whose adapter advertises no levels', () => {
    seat(state({
      groups: [{
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }],
      }],
    }))

    const rows = openChooser()
    expect(rows.map(row => row.textContent)).toEqual(['模型DeepSeek-V4-Flash'])
  })

  it('offers the provider default when the adapter configures no model default', () => {
    seat(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))

    expect(screen.getByRole('button', { name: '选择模型，当前 Model，推理等级 Default' })).toBeTruthy()
  })

  it('shows the durable model id and drops the effort row when the catalog has no matching row', () => {
    seat(state({ current: { provider: 'deepseek-official', model: 'removed-model' } }))

    const trigger = screen.getByRole('button', { name: '选择模型，当前 deepseek-official/removed-model' })
    expect(trigger.textContent).toContain('deepseek-official/removed-model')
    // No reasoning metadata for an unadvertised route: no effort vocabulary.
    expect(openChooser().map(row => row.textContent)).toEqual(['模型deepseek-official/removed-model'])
  })

  it('shows loading until the catalog and Session projection are both ready', async () => {
    const { store } = seat(state({
      current: null,
      routable: null,
      groups: [],
      status: 'loading',
    }))

    expect(screen.getByRole('button', { name: '正在加载模型…' }).textContent)
      .toContain('正在加载模型…')
    store.set(state())
    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
      })).toBeTruthy()
    })
  })

  it('follows a selection made anywhere — the labels are the shared directory store', async () => {
    const { store } = seat(state())
    store.set(state({ current: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max' } }))

    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 Max',
      })).toBeTruthy()
    })
  })

  it('is inert while the composer locks the seat', () => {
    const { openModel } = seat(state(), { locked: true })
    const trigger = screen.getByRole<HTMLButtonElement>('button', { name: /当前 DeepSeek-V4-Flash/ })
    expect(trigger.disabled).toBe(true)

    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(openModel).not.toHaveBeenCalled()
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const { load, openModel } = seat(state(), { available: false })

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
    expect(openModel).not.toHaveBeenCalled()
  })
})
