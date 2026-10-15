/** The Linux Wayland setup check: required on Wayland, present only when the helper answers. */
import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { SHELL_HELPER_EXTENSION_ID, shellHelperStatus } from '../src/index.ts'

const answered: (command: string, args: string[]) => Promise<string | undefined> = async () => '(true,)\n'
const silent: (command: string, args: string[]) => Promise<string | undefined> = async () => undefined

describe('GNOME Shell helper status', () => {
  it('is required on a Linux Wayland session, and present when the helper answers', async () => {
    assert.deepEqual(await shellHelperStatus('linux', { WAYLAND_DISPLAY: 'wayland-0' }, answered), { required: true, present: true })
    assert.deepEqual(await shellHelperStatus('linux', { XDG_SESSION_TYPE: 'wayland' }, answered), { required: true, present: true })
  })

  it('is required but absent when nothing answers, naming the extension to install', async () => {
    const status = await shellHelperStatus('linux', { WAYLAND_DISPLAY: 'wayland-0' }, silent)
    assert.deepEqual(status, { required: true, present: false })
    assert.equal(SHELL_HELPER_EXTENSION_ID, 'winrects@cua')
  })

  it('treats an explicit false answer as absent, so a stale name owner is not mistaken for the helper', async () => {
    const status = await shellHelperStatus('linux', { WAYLAND_DISPLAY: 'wayland-0' }, async () => '(false,)\n')
    assert.deepEqual(status, { required: true, present: false })
  })

  it('is not required on X11 or off Linux', async () => {
    assert.deepEqual(await shellHelperStatus('linux', { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' }, answered), { required: false, present: false })
    assert.deepEqual(await shellHelperStatus('darwin', { WAYLAND_DISPLAY: 'wayland-0' }, answered), { required: false, present: false })
  })
})
