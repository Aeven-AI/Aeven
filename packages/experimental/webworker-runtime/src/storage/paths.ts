/**
 * Virtual root of the worker host's in-memory filesystem. Kept
 * in one module so the process shim, the path/os shims, and the VFS image
 * collector cannot drift apart.
 */

/** Virtual filesystem root; `process.cwd()` and every absolute path start here. */
export const AVN_ROOT = '/avn'

/** `$AVN_HOME`: durable-state directory inside the image. */
export const AVN_HOME = `${AVN_ROOT}/home`

/** Flat, symlink-free package tree resolved by the worker module loader. */
export const AVN_NODE_MODULES = `${AVN_ROOT}/node_modules`

/** Directory holding the composed cordis.yml and the agent-preset tree. */
export const AVN_CONFIG = `${AVN_ROOT}/config`

/** Default (empty) workspace directory. */
export const AVN_WORKSPACE = `${AVN_ROOT}/workspace`

/** Temporary directory reported by `os.tmpdir()`. */
export const AVN_TMP = `${AVN_ROOT}/tmp`
