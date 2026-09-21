import { mkdtempSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { PythonCodeRuntime, resolvePythonBin } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { CodeBindingFunction } from '@aeven/code-runtime'

/**
 * Shared fixtures for the runtime's real-subprocess suites.
 *
 * The suite was one file, which made a single Vitest worker carry every case in
 * it: Vitest parallelizes files, never `describe` blocks, so the slowest case in
 * the file set the floor for the whole suite. The cases are now split by
 * `describe` across sibling specs and share this module, so the workloads
 * overlap. Keep it to fixtures only — anything that registers a test, a hook, or
 * a module mock belongs in the spec that owns it, because importing a spec
 * re-registers its `describe` (docs/testing.md).
 */

/**
 * Absolute supported interpreter path for shell wrappers. The runtime gives a
 * child only TMPDIR, so a bare `python3` inside a wrapper would resolve against
 * /bin/sh's default PATH rather than the caller's selected interpreter.
 */
export const PYABS = resolvePythonBin('python3') ?? 'python3'

// Test-created temp dirs/files, registered by the helpers below and removed
// after each test: a suite run over real python3 subprocesses must not
// permanently accumulate `avn-*` fixtures in the shared tmpdir (the runtime
// cleans its own per-run staging dir; these are the stubs and wrappers the
// tests themselves build).
const tempDirs: string[] = []

/** Test-created files, registered by the specs that build wrappers and stubs. */
export const tempFiles: string[] = []

/**
 * Remove every fixture the calling spec file created, so repeated runs do not
 * accumulate `avn-*` directories and wrappers in the shared tmpdir. Every spec
 * that reaches for a helper below registers this as its `afterEach`.
 */
export function cleanupTempFixtures(): void {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  for (const file of tempFiles.splice(0)) rmSync(file, { force: true })
}

/**
 * Build a fresh runtime per test so budgets can be tuned per case.
 *
 * Integration over REAL python3 subprocesses (no subprocess mocks — cheap and
 * local, per docs/testing.md's real-over-mock policy; the only mock is
 * `node:fs.copyFileSync` for the staging-failure cases in `runtime-seam.spec.ts`).
 */
export async function setup(config: Config = {}) {
  const ctx = new Context()
  const fiber = await ctx.plugin(PythonCodeRuntime, config)
  const runtime = ctx.codeRuntime as PythonCodeRuntime
  return { ctx, fiber, runtime }
}

/** Convenience: one namespace `tools` with the given functions. */
export function tools(functions: Record<string, CodeBindingFunction>) {
  return [{ global: 'tools', functions }]
}

/** Create a test temp dir registered for afterEach removal. */
export async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** Synchronous variant of {@link makeTempDir} for the PATH-stub fixtures. */
export function makeTempDirSync(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}
