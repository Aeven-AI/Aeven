// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@aeven/api-session-controller/client'
import type { WorkspaceSnapshot } from '@aeven/api-workspace-controller/client'
import type { SessionPendingInteractionSnapshot } from '@aeven/client-ui-session/client'
import { createSnapshotStore } from '@aeven/client-store'
import { bindSnapshotSelector, makeTranslate } from '@aeven/client-test-runtime'
import { TranscriptViewRow, type TranscriptViewRowProps } from '../src/client/settings/TranscriptViewRow.tsx'
import { en } from '../src/client/locale.ts'

afterEach(cleanup)

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  }))
}

function noPendingInteraction() {
  return bindSnapshotSelector(createSnapshotStore<SessionPendingInteractionSnapshot>(new Map()))
}

function mount(mode: 'normal' | 'extended' = 'normal') {
  const source = createSnapshotStore(mode)
  const setTranscriptView = vi.fn((next: 'normal' | 'extended') => { source.set(next) })
  const props: TranscriptViewRowProps = {
    useSessions: emptySessions(),
    useSessionPendingInteraction: noPendingInteraction(),
    useWorkspaces: emptyWorkspaces(),
    useTranscriptView: bindSnapshotSelector(source),
    setTranscriptView,
    t: makeTranslate(en),
  }
  render(<TranscriptViewRow {...props} />)
  return { setTranscriptView }
}

describe('TranscriptViewRow', () => {
  it('explains the preference and shows Normal by default', () => {
    mount()
    expect(screen.getByText('Conversation display')).toBeDefined()
    expect(screen.getByText('Controls process content in completed turns')).toBeDefined()
    expect(screen.getByRole('button', { name: /Normal/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('selects Extended and follows the mirrored value', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: /Normal/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Extended' }))
    expect(b.setTranscriptView).toHaveBeenCalledWith('extended')
    const trigger = screen.getByRole('button', { name: /Extended/ })
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Normal' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Normal' })).toBeNull()
  })
})
