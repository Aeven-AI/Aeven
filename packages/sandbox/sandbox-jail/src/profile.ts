/**
 * The jail's bwrap and Landlock argument builders: a fresh root holding only
 * the configured read-only system paths, one account's workspace, a private
 * `/tmp` and `/dev/shm`, and no network beyond the egress proxy's socket, with the Landlock launcher re-confining
 * the same view.
 *
 * @module @aeven/sandbox-jail/profile
 */

import { join, relative } from 'node:path'
import { grantArgs } from '@deepseek-ai/node-addon-landlock-run'
import type { SandboxPolicy } from '@aeven/sandbox'
import { JAIL_EGRESS_DIR, JAIL_EGRESS_RELAY, relayEnv } from './egress.ts'
import { JAIL_ZYGOTE_DIR } from './zygote.ts'

/** Where the Landlock launcher is mounted inside every jail. */
export const JAIL_LAUNCHER = '/run/aeven/landlock-run'

/** The resolved inputs one jail is built from. */
export interface JailProfile {
  /** Host path of bubblewrap. */
  bwrap: string
  /** Host path of the Landlock launcher, mounted read-only at {@link JAIL_LAUNCHER}. */
  launcher: string
  /** Existing host paths mounted read-only at the same path. */
  readOnlyPaths: readonly string[]
  /** Symlinks created in the jail root, keyed by link path. */
  symlinks: Readonly<Record<string, string>>
  /** The complete environment of the confined command; `HOME` is the workspace root. */
  env: Readonly<Record<string, string>>
  /** Size bound of each of the private `/tmp` and `/dev/shm`, in bytes. */
  tmpSizeBytes: number
  /** Host name the confined command sees. */
  hostname: string
  /** Whether bubblewrap reads a system-call filter from descriptor 3. */
  seccomp: boolean
  /** Host directory of the Python zygote's socket, mounted read-only at {@link JAIL_ZYGOTE_DIR}; absent without a zygote. */
  zygoteDir?: string | undefined
  /**
   * Set when an egress proxy runs: the call's account socket directory is mounted read-only at {@link JAIL_EGRESS_DIR}, the relay
   * program at {@link JAIL_EGRESS_RELAY}, and the proxy variables and the Git URL rewrites of `gitHosts` name the
   * relay's loopback `port`. The caller
   * places the relay's argv before the command.
   */
  egress?: { readonly relay: string; readonly port: number; readonly gitHosts: readonly string[] } | undefined
  /**
   * Set when bubblewrap runs as a sandbox user, who cannot enter the Host's data directory: roots are mounted from
   * the second mount of the accounts root at `accountsPath`, and read-only files are copied in from descriptors the
   * launch step opens.
   */
  sandboxUser?: { readonly accountsRoot: string; readonly accountsPath: string } | undefined
}

/** First descriptor number {@link jailArgs} assigns to a file the launch step opens; 3 carries the seccomp filter. */
export const FIRST_BIND_DESCRIPTOR = 10

/** The jail argv prefix of one call and the paths its launch step opens for it. */
export interface JailArgs {
  /** The argv to place before the confined command. */
  args: string[]
  /** Host files the launch step opens read-only at these descriptor numbers before bubblewrap starts. */
  opens: { fd: number; path: string }[]
}

/**
 * Build the complete jail argv prefix for one call.
 * @param profile - the deployment's jail inputs.
 * @param policy - the call's confined policy; its roots are already checked to belong to one account.
 * @param readOnlyFiles - further existing host files mounted read-only at the same path, such as the session's attachments.
 * @param egressDir - the calling account's egress socket directory; required when `profile.egress` is set.
 * @returns the argv prefix and the descriptors its launch step must open.
 */
export function jailArgs(profile: JailProfile, policy: SandboxPolicy, readOnlyFiles: readonly string[] = [], egressDir?: string): JailArgs {
  const writable = policy.mode === 'workspace-write'
  const roots = [policy.workspaceRoot, ...writable ? policy.additionalWritableRoots ?? [] : []]
  const args = [
    profile.bwrap,
    '--unshare-user', '--unshare-ipc', '--unshare-pid', '--unshare-net', '--unshare-uts', '--unshare-cgroup',
    '--disable-userns', '--die-with-parent', '--new-session', '--hostname', profile.hostname,
    '--clearenv',
    ...profile.seccomp ? ['--seccomp', '3'] : [],
  ]
  const egressEnv = profile.egress === undefined ? {} : relayEnv(profile.egress.port, profile.egress.gitHosts)
  const env = { ...profile.env, ...egressEnv, HOME: policy.workspaceRoot }
  for (const [name, value] of Object.entries(env)) args.push('--setenv', name, value)
  for (const path of profile.readOnlyPaths) args.push('--ro-bind', path, path)
  for (const [link, target] of Object.entries(profile.symlinks)) args.push('--symlink', target, link)
  const size = String(profile.tmpSizeBytes)
  args.push('--dev', '/dev', '--proc', '/proc', '--size', size, '--tmpfs', '/tmp', '--size', size, '--tmpfs', '/dev/shm')
  const opens: JailArgs['opens'] = []
  const user = profile.sandboxUser
  for (const root of roots) {
    const source = user === undefined ? root : join(user.accountsPath, relative(user.accountsRoot, root))
    args.push(writable ? '--bind' : '--ro-bind', source, root)
  }
  for (const file of readOnlyFiles) {
    if (user === undefined) {
      args.push('--ro-bind', file, file)
      continue
    }
    const fd = FIRST_BIND_DESCRIPTOR + opens.length
    opens.push({ fd, path: file })
    args.push('--ro-bind-data', String(fd), file)
  }
  if (profile.zygoteDir !== undefined) args.push('--ro-bind', profile.zygoteDir, JAIL_ZYGOTE_DIR)
  if (profile.egress !== undefined && egressDir !== undefined) {
    args.push('--ro-bind', egressDir, JAIL_EGRESS_DIR, '--ro-bind', profile.egress.relay, JAIL_EGRESS_RELAY)
  }
  args.push('--ro-bind', profile.launcher, JAIL_LAUNCHER, '--', JAIL_LAUNCHER)
  // The jail root holds only what bwrap mounted, so read access beneath it is
  // the same view; Landlock still denies anything outside it.
  args.push(...grantArgs({ readOnly: ['/'], readWrite: ['/dev/null', '/dev/shm', ...writable ? ['/tmp', ...roots] : []] }))
  return { args, opens }
}
