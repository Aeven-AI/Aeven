/** Process-lifetime kernel exclusion shared by Host and Session writers. */
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname, toNamespacedPath } from 'node:path'

/**
 * Try to hold a persistent lock file until release or process exit.
 * Callers must never unlink the lock file while contenders can run.
 * @param path - absolute lock file shared by every contender.
 * @returns idempotent release, or undefined while another descriptor owns it.
 */
export async function tryAcquireFileLock(path: string): Promise<(() => void) | undefined> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const koffi = (await import('koffi')).default
  if (process.platform === 'win32') {
    const kernel = koffi.load('kernel32.dll')
    const create = kernel.func('__stdcall', 'CreateFileW', 'void *', ['str16', 'uint', 'uint', 'void *', 'uint', 'uint', 'void *'])
    const close = kernel.func('__stdcall', 'CloseHandle', 'int', ['void *'])
    const lastError = kernel.func('__stdcall', 'GetLastError', 'uint', [])
    const handle: unknown = create(toNamespacedPath(path), 0xC0000000, 0, null, 4, 0x80, null)
    if (handle === null || koffi.address(handle) === 0xFFFFFFFFFFFFFFFFn || koffi.address(handle) === 0xFFFFFFFFn) {
      const code: unknown = lastError()
      if (code === 32 || code === 33) return undefined
      throw new Error(`process lock failed for "${path}" (Win32 ${String(code)})`)
    }
    let released = false
    return () => {
      if (released) return
      released = true
      if (!close(handle)) throw new Error(`process lock release failed for "${path}"`)
    }
  }
  const libc = koffi.load(process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6')
  const flock = libc.func('int flock(int fd, int operation)')
  const fd = openSync(path, 'a', 0o600)
  if (flock(fd, 2 | 4) !== 0) {
    const errno = koffi.errno()
    closeSync(fd)
    if (errno === 11 || errno === 35) return undefined
    throw new Error(`process lock failed for "${path}" (errno ${String(errno)})`)
  }
  let released = false
  return () => {
    if (released) return
    released = true
    closeSync(fd)
  }
}
