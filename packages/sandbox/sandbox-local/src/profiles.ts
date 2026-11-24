/**
 * Internal platform-profile builders for the local sandbox provider.
 *
 * @module @aeven/sandbox-local/profiles
 */

import { existsSync } from 'node:fs'
import { grantArgs as landlockGrantArgs } from '@deepseek-ai/node-addon-landlock-run'
import { writableRoots } from '@aeven/sandbox'
import type { SandboxExecutionPolicy, SandboxPolicy } from '@aeven/sandbox'

/**
 * Build the bwrap profile arguments for one file-effect policy.
 * @param policy - file-effect policy to express as bwrap mounts.
 * @returns profile arguments before the trailing separator and command argv.
 */
export function bwrapProfileArgs(policy: SandboxPolicy): string[] {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-pid', '--proc', '/proc', '--die-with-parent']
  if (policy.mode === 'workspace-write') {
    args.push('--tmpfs', '/tmp')
    for (const root of [policy.workspaceRoot, ...policy.additionalWritableRoots ?? []]) args.push('--bind', root, root)
    // A later read-only mount wins over an enclosing writable bind; bwrap can only mount a path that exists.
    for (const root of policy.protectedRoots ?? []) if (existsSync(root)) args.push('--ro-bind', root, root)
  }
  return args
}

/**
 * Build the Landlock launcher grants for one file-effect policy.
 * @param policy - file-effect policy to express as Landlock allow-list grants.
 * @returns launcher grant arguments before the trailing separator and command argv.
 */
export function landlockProfileArgs(policy: SandboxPolicy): string[] {
  const readWrite = ['/dev/null']
  if (policy.mode === 'workspace-write') {
    readWrite.push('/tmp', policy.workspaceRoot, ...policy.additionalWritableRoots ?? [])
  }
  return landlockGrantArgs({ readOnly: ['/'], readWrite })
}

/** Quote one path as an SBPL string literal. */
function sbplString(path: string): string {
  return `"${path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}

/**
 * Build the sandbox-exec arguments and SBPL profile for one policy. The
 * writable roots come from the shared {@link writableRoots} helper (canonical,
 * deduplicated) so the Seatbelt grant and the in-process fs fence
 * (`@aeven/fs-sandbox`) can never drift apart.
 * @param policy - file-effect policy to express as an SBPL profile.
 * @returns sandbox-exec arguments before the trailing separator and command argv.
 */
export function seatbeltProfileArgs(policy: SandboxPolicy): string[] {
  const forms = ['(version 1)', '(allow default)', '(deny file-write*)', `(allow file-write* (literal ${sbplString('/dev/null')}))`]
  const roots = writableRoots(policy)
  if (roots.length > 0) {
    forms.push(`(allow file-write* ${roots.map(root => `(subpath ${sbplString(root)})`).join(' ')})`)
  }
  forms.push(...protectedForms(policy))
  return ['-p', forms.join(' ')]
}

/** SBPL denials for the policy's protected roots; a later rule wins over an earlier allow. */
function protectedForms(policy: SandboxExecutionPolicy): string[] {
  const roots = policy.protectedRoots ?? []
  return roots.length === 0 ? [] : [`(deny file-write* ${roots.map(root => `(subpath ${sbplString(root)})`).join(' ')})`]
}

/**
 * Build the sandbox-exec arguments for an unconfined execution that may write anywhere except the policy's
 * protected roots.
 * @param policy - the per-call policy whose protected roots are denied.
 * @returns sandbox-exec arguments before the trailing separator and command argv.
 */
export function seatbeltProtectArgs(policy: SandboxExecutionPolicy): string[] {
  return ['-p', ['(version 1)', '(allow default)', ...protectedForms(policy)].join(' ')]
}
