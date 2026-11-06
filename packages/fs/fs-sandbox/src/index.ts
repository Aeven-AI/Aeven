/**
 * `SandboxedFileSystem`: the sandbox-enforcing implementation of the
 * `@aeven/fs` Service Definition. It extends `LocalFileSystem` so all
 * text-storage mechanics — resolve, stat, read/stream, list, the atomic
 * write and the read-match-write edit critical section — are the local
 * implementation's, verbatim; this package adds only the per-call POLICY fence
 * on the two mutations. Reads pass through untouched: every mode permits
 * reading.
 *
 * The fence is a policy check in TRUSTED code over a MODEL-CONTROLLED path,
 * NOT a kernel boundary — the operations are the seam's own (open, rename),
 * and only the target path is untrusted, so canonicalize-then-contain is the
 * complete answer to this surface. This is containment, not a security
 * boundary; kernel-grade isolation of untrusted CODE stays `ctx.shell`'s job
 * (`@aeven/bash-sandbox`). The residual
 * TOCTOU (an ancestor symlink swapped between the containment re-check and the
 * syscall) is narrowed by re-canonicalizing immediately before delegating and
 * is accepted for this threat model.
 *
 * Per-call policy: `read-only` denies every mutation; `workspace-write` allows
 * a mutation only when the target canonicalizes under the policy's workspace
 * root or a platform temp area from the shared `writableRoots` policy;
 * `danger-full-access` delegates unfenced. A denial throws the structured
 * `FS_SANDBOX_DENIED`.
 *
 * @module @aeven/fs-sandbox
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { LocalFileSystem } from '@aeven/fs-local'
import type { Config as LocalConfig } from '@aeven/fs-local'
import { FsError } from '@aeven/fs'
import type { FsEditOutcome, FsEditRequest, FsTarget, FsVersion, FsWriteIntent, FsWriteOutcome } from '@aeven/fs'
import { writableRoots } from '@aeven/sandbox'
import type { SandboxExecutionPolicy, SandboxMode } from '@aeven/sandbox'
import type {} from '@aeven/sandbox-policy'
import { isPathUnder } from './containment.ts'
import { readVerified, streamVerified } from './verified-read.ts'

/**
 * Plugin config: the local backend's knobs (`cwd` resolution default and
 * `diffBasisMaxBytes` overwrite-presentation bound) plus read verification.
 * The sandbox default (mode + `workspace-write` fallback root) is NOT here —
 * `ctx.sandboxPolicy` resolves each calling session for every enforcing
 * capability.
 */
export interface Config extends LocalConfig {
  /**
   * Read every file through a descriptor checked to be the resolved file
   * (default false; Linux only). A Host whose confined processes share the
   * directories its own readers serve sets true, so a path component swapped
   * for a symlink between resolve and read cannot redirect the read.
   */
  verifyReads?: boolean
}

/**
 * Sandbox-enforcing filesystem backend. Registers as `ctx.fs` (loading it
 * INSTEAD OF `avn-fs-local`, together with a `ctx.sandboxPolicy`, is the whole
 * swap — the model-facing tools are untouched). Its configured default mode is
 * the capability fact exposed by {@link sandboxMode}; `avn-tool-fs` resolves
 * each session's mode and cwd into a policy for every mutation, while an
 * approved escalation may stamp a strictly wider mode for one call.
 */
export class SandboxedFileSystem extends LocalFileSystem {
  static inject = ['sandboxPolicy']

  // Inline schema call: the config catalog walks `static Config` statically.
  static override Config: z<Config> = z.intersect([
    LocalFileSystem.Config,
    z.object({ verifyReads: z.boolean().default(false) }),
  ])

  private readonly defaultMode: SandboxMode
  private readonly verifyReads: boolean
  constructor(ctx: Context, config: Config) {
    super(ctx, config)
    this.defaultMode = ctx.sandboxPolicy.defaultMode
    this.verifyReads = config.verifyReads ?? false
    if (this.verifyReads && process.platform !== 'linux') throw new Error('fs-sandbox: verifyReads requires Linux')
  }

  override async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    return this.verifyReads ? readVerified(target, opened => super.readText(opened, signal)) : super.readText(target, signal)
  }

  override streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    return this.verifyReads
      ? Promise.resolve(streamVerified(target, opened => super.streamText(opened, signal)))
      : super.streamText(target, signal)
  }

  override async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    return this.verifyReads
      ? readVerified(target, opened => super.readBytes(opened, signal, maxBytes))
      : super.readBytes(target, signal, maxBytes)
  }

  /** The deployment default mode — the capability fact the tool layer reads to advertise escalation. */
  override get sandboxMode(): SandboxMode {
    return this.defaultMode
  }

  /**
   * Fence the write by the per-call policy, then delegate to the inherited
   * atomic write. See {@link checkedTarget}.
   * @param target - the resolved target to write.
   * @param content - the full new file content.
   * @param expected - the write intent guarding the write; omit for unconditional.
   * @param signal - aborts before atomic publication takes effect.
   * @param sandboxPolicy - the per-call mode and workspace root; omit to use
   *   the deployment fallback.
   * @returns the write outcome from the inherited backend.
   */
  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome> {
    return super.writeText(await this.checkedTarget(target, sandboxPolicy), content, expected, signal)
  }

  /**
   * Fence the edit by the per-call policy, then delegate to the inherited
   * atomic edit. See {@link checkedTarget}.
   * @param target - the resolved target to edit.
   * @param edit - the literal search/replace request.
   * @param expected - the version guard; omit for an unconditional edit.
   * @param signal - aborts before atomic publication takes effect.
   * @param sandboxPolicy - the per-call mode and workspace root; omit to use
   *   the deployment fallback.
   * @returns the edit outcome from the inherited backend.
   */
  override async editText(
    target: FsTarget,
    edit: FsEditRequest | readonly FsEditRequest[],
    expected?: { version: FsVersion },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsEditOutcome> {
    return super.editText(await this.checkedTarget(target, sandboxPolicy), edit, expected, signal)
  }

  /**
   * Enforce the per-call policy against `target` and return the EXACT target the
   * mutation must use, so the checked identity is the mutated one (no
   * check-here-write-there TOCTOU). `read-only` denies; `workspace-write`
   * re-canonicalizes NOW (`resolve` realpaths the deepest existing ancestor,
   * reflecting a concurrently swapped symlink), requires containment under a
   * writable root, and returns THAT fresh target; `danger-full-access` returns
   * the caller's target unfenced. Throws the structured `FS_SANDBOX_DENIED` on
   * refusal — the tool layer maps it to the model-facing `[sandbox: …]` marker
   * and the escalation hint.
   */
  private async checkedTarget(target: FsTarget, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsTarget> {
    const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()
    const { mode } = policy
    if (mode === 'danger-full-access') return target
    if (mode === 'read-only') {
      throw new FsError(`cannot write "${target.displayPath}": file access denied under read-only mode`, 'FS_SANDBOX_DENIED')
    }
    // workspace-write: containment on the FRESH canonical path (catches a
    // symlink ancestor swapped since the tool resolved this target), and the
    // mutation delegates with THIS fresh target — never the stale one.
    const fresh = await this.resolve(target.displayPath)
    let contained = false
    for (const root of writableRoots(policy)) {
      if (await isPathUnder(fresh.targetKey, root)) {
        contained = true
        break
      }
    }
    if (!contained) {
      throw new FsError(`cannot write "${target.displayPath}": file access denied under workspace-write mode`, 'FS_SANDBOX_DENIED')
    }
    return fresh
  }
}

export default SandboxedFileSystem
