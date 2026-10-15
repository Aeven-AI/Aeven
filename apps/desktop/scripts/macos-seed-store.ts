/** Sign Mach-O content in a pnpm CAS without invalidating the store index. */

import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import {
  type DecodedIndexRow,
  isExecutableMode,
  listPnpmCasObjects,
  pnpmCasPath,
  pnpmCasReferenceKey,
  pnpmPackageFileMaps,
  pnpmStoreVersionRoots,
  type PnpmCasObject,
  type PnpmStoreFileRecord,
  readPnpmIndexRows,
  writeChangedPnpmIndexRows,
} from './pnpm-store-index.ts'
import type { MacOSSigningEnvironment } from './desktop-release-environment.mjs'
import { signMacOSSeedCode, verifyMacOSSeedCode } from './verify-macos-signature.mjs'

const MACH_O_MAGICS = new Set([
  'cafebabe',
  'cafebabf',
  'cefaedfe',
  'cffaedfe',
  'feedface',
  'feedfacf',
  'bebafeca',
  'bfbafeca',
])
const MAX_CONCURRENT_CODE_SIGNERS = 4
/** Grants `com.apple.security.cs.allow-jit` under the hardened runtime. */
const JIT_ENTITLEMENTS = fileURLToPath(new URL('./jit-entitlements.plist', import.meta.url))
/** The LibreOffice kit engine executable, which maps JIT memory under the hardened runtime. */
const JIT_PACKAGE_PATTERN = /^@deepseek-ai\/libreoffice-kit-darwin-(?:arm64|x64)@/u
const JIT_FILE = 'bin/libreoffice-kit'

interface FileReference {
  readonly row: DecodedIndexRow
  /** Package-relative path of this reference. */
  readonly path: string
  readonly record: PnpmStoreFileRecord
}

interface SigningWork {
  readonly file: PnpmCasObject
  readonly references: readonly FileReference[]
  readonly temporaryPath: string
  readonly entitlements: string | undefined
}

/** Summary of native code rewritten in one pnpm store. */
export interface MacOSSeedStoreSigningResult {
  readonly signedFiles: number
  readonly prunedOrphans: number
  readonly updatedIndexRows: number
}

/** A signer used to make one writable Mach-O copy release-valid, with an entitlements plist when the code needs one. */
export type MacOSSeedCodeSigner = (path: string, identifier: string, entitlements: string | undefined) => Promise<void>

/** A verifier used to check one Mach-O file after packaging transport. */
export type MacOSSeedCodeVerifier = (path: string) => void

/** Optional execution controls for seed-store code signing. */
export interface MacOSSeedStoreSigningOptions {
  readonly signer?: MacOSSeedCodeSigner
  readonly concurrency?: number
}

function isMachO(path: string): boolean {
  const descriptor = openSync(path, 'r')
  try {
    const header = Buffer.alloc(4)
    return readSync(descriptor, header, 0, header.length, 0) === header.length
      && MACH_O_MAGICS.has(header.toString('hex'))
  } finally {
    closeSync(descriptor)
  }
}

function machOFiles(versionRoot: string): readonly PnpmCasObject[] {
  return listPnpmCasObjects(versionRoot).filter(object => isMachO(object.path))
}

function fileReferences(rows: readonly DecodedIndexRow[]): ReadonlyMap<string, readonly FileReference[]> {
  const references = new Map<string, FileReference[]>()
  for (const row of rows) {
    for (const files of pnpmPackageFileMaps(row.value, row.key)) {
      for (const [path, record] of files) {
        const key = pnpmCasReferenceKey(record.digest, isExecutableMode(record.mode))
        const values = references.get(key) ?? []
        values.push({ row, path, record })
        references.set(key, values)
      }
    }
  }
  return references
}

/** pnpm index keys are `<integrity>\t<name>@<version>`; the package identity follows the tab. */
function needsJit(references: readonly FileReference[]): boolean {
  return references.some(({ row, path }) => path === JIT_FILE && JIT_PACKAGE_PATTERN.test(row.key.slice(row.key.indexOf('\t') + 1)))
}

function writeCasFile(path: string, body: Buffer, mode: number): void {
  mkdirSync(dirname(path), { recursive: true })
  try {
    writeFileSync(path, body, { flag: 'wx', mode })
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'EEXIST' || !readFileSync(path).equals(body)) throw error
  }
  chmodSync(path, mode)
}

async function runConcurrent<T>(
  values: readonly T[],
  concurrency: number,
  run: (value: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const failure: { error?: unknown; failed: boolean } = { failed: false }
  const worker = async (): Promise<void> => {
    while (!failure.failed) {
      const index = next
      if (index >= values.length) return
      next += 1
      try {
        await run(values[index] as T)
      } catch (error) {
        if (!failure.failed) {
          failure.failed = true
          failure.error = error
        }
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => worker(),
  )
  await Promise.all(workers)
  if (failure.failed) throw failure.error
}

async function rewriteVersionStore(
  versionRoot: string,
  appId: string,
  signer: MacOSSeedCodeSigner,
  concurrency: number,
): Promise<MacOSSeedStoreSigningResult> {
  const databasePath = join(versionRoot, 'index.db')
  if (!existsSync(databasePath)) {
    throw new Error(`desktop seed signing: pnpm store has no package index: ${databasePath}`)
  }
  const database = new DatabaseSync(databasePath)
  const workRoot = mkdtempSync(join(tmpdir(), 'avn-desktop-seed-signing-'))
  const obsoleteFiles = new Set<string>()
  let prunedOrphans = 0
  let rows: readonly DecodedIndexRow[] = []
  try {
    rows = readPnpmIndexRows(database)
    const references = fileReferences(rows)
    const signingWork: SigningWork[] = []
    for (const file of machOFiles(versionRoot)) {
      const body = readFileSync(file.path)
      const actualDigest = createHash('sha512').update(body).digest('hex')
      if (actualDigest !== file.digest) {
        throw new Error(`desktop seed signing: pnpm CAS digest mismatch at ${file.path}`)
      }
      const fileReferences = references.get(pnpmCasReferenceKey(file.digest, file.executable)) ?? []
      if (fileReferences.length === 0) {
        obsoleteFiles.add(file.path)
        prunedOrphans += 1
        continue
      }
      const temporary = join(workRoot, `${signingWork.length.toString().padStart(4, '0')}-${basename(file.path)}`)
      copyFileSync(file.path, temporary)
      chmodSync(temporary, 0o755)
      signingWork.push({
        file,
        references: fileReferences,
        temporaryPath: temporary,
        entitlements: needsJit(fileReferences) ? JIT_ENTITLEMENTS : undefined,
      })
    }
    await runConcurrent(signingWork, concurrency, async (work) => {
      await signer(work.temporaryPath, `${appId}.seed.${work.file.digest.slice(0, 32)}`, work.entitlements)
    })
    for (const work of signingWork) {
      const signedBody = readFileSync(work.temporaryPath)
      if (!isMachO(work.temporaryPath)) {
        throw new Error(`desktop seed signing: signer produced non-Mach-O content for ${work.file.path}`)
      }
      const signedDigest = createHash('sha512').update(signedBody).digest('hex')
      const mode = work.file.executable ? 0o755 : 0o644
      const destination = pnpmCasPath(versionRoot, signedDigest, work.file.executable)
      writeCasFile(destination, signedBody, mode)
      const checkedAt = Date.now()
      for (const reference of work.references) {
        reference.record.checkedAt = checkedAt
        reference.record.digest = signedDigest
        reference.record.mode = mode
        reference.record.size = signedBody.length
        reference.row.changed = true
      }
      if (destination !== work.file.path) obsoleteFiles.add(work.file.path)
    }
    const updatedIndexRows = writeChangedPnpmIndexRows(database, rows)
    for (const path of obsoleteFiles) unlinkSync(path)
    database.exec('VACUUM')
    return { signedFiles: signingWork.length, prunedOrphans, updatedIndexRows }
  } finally {
    database.close()
    rmSync(workRoot, { recursive: true, force: true })
  }
}

/**
 * Replace every Mach-O CAS object with a Developer ID signed object and update pnpm's SHA-512 index.
 * A signer rejection leaves the original CAS objects and package index unchanged.
 * @param storeRoot - Loose pnpm store prepared for the packaged seed.
 * @param appId - Electron application ID used as the signing identifier prefix.
 * @param expected - Company Developer ID identity and Team ID.
 * @param options - Optional signer and worker bound used by focused tests.
 * @returns Counts for release diagnostics after every signer completes and the index transaction commits.
 */
export async function signMacOSSeedStore(
  storeRoot: string,
  appId: string,
  expected: MacOSSigningEnvironment,
  options: MacOSSeedStoreSigningOptions = {},
): Promise<MacOSSeedStoreSigningResult> {
  const roots = pnpmStoreVersionRoots(storeRoot)
  if (roots.length === 0) throw new Error(`desktop seed signing: no pnpm store versions found in ${storeRoot}`)
  const concurrency = options.concurrency ?? Math.min(MAX_CONCURRENT_CODE_SIGNERS, availableParallelism())
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error(`desktop seed signing: concurrency must be a positive integer; received ${String(concurrency)}`)
  }
  const signer = options.signer ?? (async (path, identifier, entitlements) => {
    await signMacOSSeedCode(path, identifier, expected, entitlements)
  })
  const results: MacOSSeedStoreSigningResult[] = []
  for (const root of roots) results.push(await rewriteVersionStore(root, appId, signer, concurrency))
  return results.reduce((total, current) => ({
    signedFiles: total.signedFiles + current.signedFiles,
    prunedOrphans: total.prunedOrphans + current.prunedOrphans,
    updatedIndexRows: total.updatedIndexRows + current.updatedIndexRows,
  }), { signedFiles: 0, prunedOrphans: 0, updatedIndexRows: 0 })
}

/**
 * Verify that every Mach-O CAS object has the expected Developer ID, timestamp, and hardened runtime.
 * @param storeRoot - Loose or extracted pnpm store.
 * @param expected - Company Developer ID identity and Team ID.
 * @param verifier - Injectable signature verifier used by focused tests.
 * @returns Number of verified Mach-O files.
 */
export function verifyMacOSSeedStore(
  storeRoot: string,
  expected: MacOSSigningEnvironment,
  verifier: MacOSSeedCodeVerifier = (path) => { verifyMacOSSeedCode(path, expected) },
): number {
  let count = 0
  for (const root of pnpmStoreVersionRoots(storeRoot)) {
    for (const file of machOFiles(root)) {
      verifier(file.path)
      count += 1
    }
  }
  return count
}
