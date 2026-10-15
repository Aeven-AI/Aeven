/** The driver child's environment for a Wayland, X11, or non-Linux session. */
import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { WAYLAND_BACKEND_ENV, driverEnv } from '../src/index.ts'

describe('computer-use driver environment', () => {
  it('enables the driver native-Wayland backend on a Wayland session', () => {
    assert.deepEqual(driverEnv('linux', { WAYLAND_DISPLAY: 'wayland-0' }), { [WAYLAND_BACKEND_ENV]: '1' })
    assert.deepEqual(driverEnv('linux', { XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' }), { [WAYLAND_BACKEND_ENV]: '1' })
  })

  it('adds nothing on an X11 session, which already works', () => {
    assert.deepEqual(driverEnv('linux', { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' }), {})
  })

  it('adds nothing off Linux, and ignores empty values', () => {
    assert.deepEqual(driverEnv('darwin', { WAYLAND_DISPLAY: 'wayland-0' }), {})
    assert.deepEqual(driverEnv('win32', {}), {})
    assert.deepEqual(driverEnv('linux', { WAYLAND_DISPLAY: '', XDG_SESSION_TYPE: '' }), {})
  })
})
