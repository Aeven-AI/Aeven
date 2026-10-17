import { describe, expect, it } from 'vitest'
import { desktopUpdatePrompt } from '../src/update-prompt.ts'

describe('desktop update prompts', () => {
  it('stays silent for every state nobody asked about', () => {
    expect(desktopUpdatePrompt({ phase: 'checking' }, { manual: false, promptedVersion: undefined })).toBe('silent')
    expect(desktopUpdatePrompt({ phase: 'idle' }, { manual: false, promptedVersion: undefined })).toBe('silent')
    expect(desktopUpdatePrompt(
      { phase: 'available', version: '1.1.0' },
      { manual: false, promptedVersion: undefined },
    )).toBe('silent')
    expect(desktopUpdatePrompt({ phase: 'installing', version: '1.1.0' }, { manual: false, promptedVersion: '1.1.0' }))
      .toBe('silent')
    expect(desktopUpdatePrompt({ phase: 'error', message: 'offline' }, { manual: false, promptedVersion: undefined }))
      .toBe('silent')
    // The popup a reader opened follows its own download through onChange.
    expect(desktopUpdatePrompt(
      { phase: 'downloading', version: '1.1.0', percent: 40 },
      { manual: true, promptedVersion: undefined },
    )).toBe('silent')
  })

  it('answers a check the reader asked for, whatever it found', () => {
    expect(desktopUpdatePrompt({ phase: 'idle' }, { manual: true, promptedVersion: undefined })).toBe('current')
    expect(desktopUpdatePrompt({ phase: 'error', message: 'offline' }, { manual: true, promptedVersion: undefined }))
      .toBe('error')
    expect(desktopUpdatePrompt(
      { phase: 'available', version: '1.1.0' },
      { manual: true, promptedVersion: undefined },
    )).toBe('downloading')
  })

  it('offers a downloaded release once, and again when the reader asks', () => {
    const downloaded = { phase: 'ready', version: '1.1.0' } as const
    expect(desktopUpdatePrompt(downloaded, { manual: false, promptedVersion: undefined })).toBe('ready')
    expect(desktopUpdatePrompt(downloaded, { manual: false, promptedVersion: '1.1.0' })).toBe('silent')
    expect(desktopUpdatePrompt(downloaded, { manual: true, promptedVersion: '1.1.0' })).toBe('ready')
    // A release published after the offered one is a new offer.
    expect(desktopUpdatePrompt(downloaded, { manual: false, promptedVersion: '1.0.0' })).toBe('ready')
  })
})
