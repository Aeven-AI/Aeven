/**
 * The jail's bwrap and Landlock argument builders: a fresh root holding only
 * the configured read-only system paths, one account's workspace, a private
 * `/tmp` and `/dev/shm`, and no network, with the Landlock launcher re-confining the same view.
 *
 * @module @aeven/sandbox-jail/profile
 */

import { grantArgs } from '@deepseek-ai/node-addon-landlock-run'
import type { SandboxPolicy } from '@aeven/sandbox'

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
}

/**
 * Build the complete jail argv prefix for one call.
 * @param profile - the deployment's jail inputs.
 * @param policy - the call's confined policy; its roots are already checked to belong to one account.
 * @param readOnlyFiles - further existing host files mounted read-only at the same path, such as the session's attachments.
 * @returns the argv to place before the confined command.
 */
export function jailArgs(profile: JailProfile, policy: SandboxPolicy, readOnlyFiles: readonly string[] = []): string[] {
  const writable = policy.mode === 'workspace-write'
  const roots = [policy.workspaceRoot, ...writable ? policy.additionalWritableRoots ?? [] : []]
  const args = [
    profile.bwrap,
    '--unshare-user', '--unshare-ipc', '--unshare-pid', '--unshare-net', '--unshare-uts', '--unshare-cgroup',
    '--disable-userns', '--die-with-parent', '--new-session', '--hostname', profile.hostname,
    '--clearenv',
    ...profile.seccomp ? ['--seccomp', '3'] : [],
  ]
  for (const [name, value] of Object.entries({ ...profile.env, HOME: policy.workspaceRoot })) args.push('--setenv', name, value)
  for (const path of profile.readOnlyPaths) args.push('--ro-bind', path, path)
  for (const [link, target] of Object.entries(profile.symlinks)) args.push('--symlink', target, link)
  const size = String(profile.tmpSizeBytes)
  args.push('--dev', '/dev', '--proc', '/proc', '--size', size, '--tmpfs', '/tmp', '--size', size, '--tmpfs', '/dev/shm')
  for (const root of roots) args.push(writable ? '--bind' : '--ro-bind', root, root)
  for (const file of readOnlyFiles) args.push('--ro-bind', file, file)
  args.push('--ro-bind', profile.launcher, JAIL_LAUNCHER, '--', JAIL_LAUNCHER)
  // The jail root holds only what bwrap mounted, so read access beneath it is
  // the same view; Landlock still denies anything outside it.
  args.push(...grantArgs({ readOnly: ['/'], readWrite: ['/dev/null', '/dev/shm', ...writable ? ['/tmp', ...roots] : []] }))
  return args
}
