/** @vitest-environment jsdom */
/**
 * The pre-plugin naming step.
 *
 * `NameCheck` runs before the plugin graph, so no other suite can reach it:
 * this one is what exercises the step, the trim the API relies on, and the two
 * ways the API's answer can come back — a stored name and a refused one.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type NameCheckComponent = (typeof import('../src/client/auth/views/NameCheck.tsx'))['NameCheck']
type Copy = (typeof import('../src/client/locales.ts'))['t']

/** Fresh module instances, so the leaving flag starts clear for the sign-out case. */
async function load() {
  vi.resetModules()
  const { NameCheck } = await import('../src/client/auth/views/NameCheck.tsx')
  const { session } = await import('../src/client/auth/services/session.ts')
  const { t } = await import('../src/client/locales.ts')
  session.reset()
  return { NameCheck, session, t }
}

/** One recorded call against the Aeven API. */
interface Call { url: string; body?: string }

const grant = { userId: 'u-1', accessToken: 'header.eyJ1c2VySWQiOiJ1LTEiLCJleHAiOjk5OTk5OTk5OTl9.sig' }

/** A scripted Aeven API, recording the routes and bodies the step sent. */
function scriptedApi(answers: Record<string, { status: number; body: unknown }>) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : input
    const route = new URL(url as string).pathname
    calls.push({
      url: route,
      ...typeof init?.body === 'string' ? { body: init.body } : {},
    })
    const answer = answers[route] ?? { status: 404, body: {} }
    return new Response(JSON.stringify(answer.body), {
      status: answer.status, headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls }
}

/**
 * The routes that get the step as far as the name request: the bearer is
 * renewed through the cookie, as it is on a page that kept only the cookie.
 * @param answers - what `/set-display-name` answers.
 * @returns the recording.
 */
const namedApi = (answers: Record<string, { status: number; body: unknown }>) =>
  scriptedApi({ '/refresh-token': { status: 200, body: grant }, ...answers })

/** The `/set-display-name` grant the API sends back for a stored name. */
const stored = {
  '/set-display-name': {
    status: 200,
    body: { result: 'display-name-set', displayName: 'Ollie', displayNameSet: true },
  },
}

/** Replace page navigation, which jsdom does not implement. */
function stubNavigation(pathname: string) {
  const assign = vi.fn()
  vi.spyOn(window, 'location', 'get').mockReturnValue({ pathname, assign } as unknown as Location)
  return assign
}

/** Mount the step and hand back what a click needs. */
function mountStep(NameCheck: NameCheckComponent, copy: Copy) {
  const onNamed = vi.fn()
  render(<NameCheck onNamed={onNamed} />)
  return {
    onNamed,
    // The query's own type parameter, not an assertion: `getByPlaceholderText`
    // defaults to `HTMLElement`, which has no `value`, and the two gates disagree
    // about the cast — `tsc` needs it and `no-unnecessary-type-assertion` rejects
    // it. A generic satisfies both, and says the same thing once.
    field: screen.getByPlaceholderText<HTMLInputElement>(copy('field.name')),
    submit: screen.getByRole('button', { name: copy('action.continue') }),
  }
}

beforeEach(() => {
  ;(globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__ = { apiUrl: 'http://api.test' }
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the naming step', () => {
  it('asks what to call the reader, and Continue stores the field', async () => {
    const { NameCheck, session, t } = await load()
    const api = namedApi(stored)
    const { onNamed, field, submit } = mountStep(NameCheck, t)
    expect(screen.getByText(t('name.title'))).toBeDefined()
    expect(screen.getByText(t('name.prompt'))).toBeDefined()
    expect(field.value).toBe('')

    fireEvent.change(field, { target: { value: 'Ollie' } })
    fireEvent.click(submit)

    await vi.waitFor(() => { expect(onNamed).toHaveBeenCalledTimes(1) })
    expect(api.calls.at(-1)).toEqual({
      url: '/set-display-name', body: JSON.stringify({ displayName: 'Ollie' }),
    })
    expect(session.displayName).toBe('Ollie')
    expect(session.displayNameSet).toBe(true)
  })

  it('stores the name without the padding the field carried', async () => {
    const { NameCheck, t } = await load()
    const api = namedApi(stored)
    const { onNamed, field, submit } = mountStep(NameCheck, t)

    // Both what a reader cannot see and what they cannot mean: the API would
    // store either verbatim, and every surface would then show it back.
    fireEvent.change(field, { target: { value: '  \u200BOllie\uFEFF  ' } })
    fireEvent.click(submit)

    await vi.waitFor(() => { expect(onNamed).toHaveBeenCalledTimes(1) })
    expect(api.calls.at(-1)?.body).toBe(JSON.stringify({ displayName: 'Ollie' }))
  })

  it('submits through the form, so the field can be entered', async () => {
    const { NameCheck, t } = await load()
    const api = namedApi(stored)
    const { onNamed, field } = mountStep(NameCheck, t)

    fireEvent.change(field, { target: { value: 'Ollie' } })
    fireEvent.submit(field.closest('form') as HTMLFormElement)

    await vi.waitFor(() => { expect(onNamed).toHaveBeenCalledTimes(1) })
    expect(api.calls.filter(call => call.url === '/set-display-name')).toHaveLength(1)
  })

  it('refuses what a reader cannot see, before asking the API', async () => {
    const { NameCheck, t } = await load()
    const api = scriptedApi({})
    const { onNamed, field, submit } = mountStep(NameCheck, t)

    fireEvent.change(field, { target: { value: '\u200B\u200B\u200D' } })
    fireEvent.click(submit)

    // The API answers `invalid-display-name` for an empty name, so the step
    // answers first and says why in the reader's own words.
    expect(api.calls.filter(call => call.url === '/set-display-name')).toHaveLength(0)
    expect(screen.getByText(t('name.promptAnonymous'))).toBeDefined()
    expect(onNamed).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(field)
  })

  it('recovers the normal prompt once the field holds a name again', async () => {
    const { NameCheck, t } = await load()
    scriptedApi({})
    const { field, submit } = mountStep(NameCheck, t)

    fireEvent.change(field, { target: { value: '\u200B' } })
    fireEvent.click(submit)
    expect(screen.getByText(t('name.promptAnonymous'))).toBeDefined()

    // A refusal is not sticky: the next attempt with a real name is answered
    // with the ordinary prompt rather than the anonymous line.
    namedApi(stored)
    fireEvent.change(field, { target: { value: 'Ollie' } })
    fireEvent.click(submit)
    expect(screen.getByText(t('name.prompt'))).toBeDefined()
  })

  it('keeps the typed name when the API reports no name of its own', async () => {
    const { NameCheck, session, t } = await load()
    // The grant is what matters, not the echo: a deployment that answers
    // `display-name-set` without repeating the name must not blank the reader.
    namedApi({ '/set-display-name': { status: 200, body: { result: 'display-name-set' } } })
    const { onNamed, field, submit } = mountStep(NameCheck, t)

    fireEvent.change(field, { target: { value: 'Ollie' } })
    fireEvent.click(submit)

    await vi.waitFor(() => { expect(onNamed).toHaveBeenCalledTimes(1) })
    expect(session.displayName).toBe('Ollie')
    expect(session.displayNameSet).toBe(true)
  })

  it('starts from the name the account already holds', async () => {
    const { NameCheck, session, t } = await load()
    scriptedApi({})
    session.adoptDisplayName('Ollie')

    expect(mountStep(NameCheck, t).field.value).toBe('Ollie')
  })

  it('reports a name the API refuses, and stays on the step', async () => {
    const { NameCheck, session, t } = await load()
    const assign = stubNavigation('/')
    namedApi({ '/set-display-name': { status: 400, body: { error: 'invalid-display-name' } } })
    const { onNamed, field, submit } = mountStep(NameCheck, t)

    fireEvent.change(field, { target: { value: 'Ollie' } })
    fireEvent.click(submit)

    // A refused name is not a refused credential: the reader stays signed in
    // and the step says what happened.
    await screen.findByText(t('name.saveFailed'))
    expect(onNamed).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
    expect(session.displayNameSet).toBeUndefined()
  })

  it('reports a refused credential to the page owner, which is what leaves the step', async () => {
    const { NameCheck, session, t } = await load()
    const { onSessionEnded } = await import('../src/client/auth/services/watch.ts')
    const assign = stubNavigation('/')
    const ended = vi.fn()
    const stop = onSessionEnded(ended)
    namedApi({ '/set-display-name': { status: 401, body: { error: 'invalid-access-token' } } })
    const { onNamed, field, submit } = mountStep(NameCheck, t)

    fireEvent.change(field, { target: { value: 'Ollie' } })
    fireEvent.click(submit)

    // The step is not somewhere to leave a reader whose credential has lapsed:
    // the boot kernel hears this and presents the sign-in screen in place.
    await vi.waitFor(() => { expect(ended).toHaveBeenCalledOnce() })
    expect(assign).not.toHaveBeenCalled()
    expect(onNamed).not.toHaveBeenCalled()
    expect(session.displayNameSet).toBeUndefined()
    stop()
  })
})
