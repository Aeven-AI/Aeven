// @vitest-environment jsdom
/**
 * The user prompt's action row: plugin actions seated before copy sit between edit and copy, and the actions
 * after copy keep their place.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@aeven/client-test-runtime'
import { zh as commonZh } from '@aeven/client-locale/src/locales/zh.ts'
import type { ChatNodeViewProps } from '../src/client/contract/slots.ts'
import { MessageIconActions } from '../src/client/chat/MessageIconActions.tsx'
import { zh } from '../src/client/locale.ts'

const t: ChatNodeViewProps['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

describe('actions seated before copy', () => {
  it('render between edit and copy, with the actions after copy still after it', () => {
    render(
      <MessageIconActions
        text="prompt"
        clock="start"
        onEdit={() => undefined}
        beforeCopy={<button type="button" aria-label="read aloud" />}
        extraActions={<button type="button" aria-label="feedback" />}
        t={t}
      />,
    )
    const labels = screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))
    expect(labels).toEqual([t('message.edit'), 'read aloud', t('copy'), 'feedback'])
  })

  it('leave the row as it was when nothing is seated', () => {
    render(<MessageIconActions text="prompt" clock="start" t={t} />)
    expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([t('copy')])
  })
})
