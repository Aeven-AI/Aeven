/**
 * Remove files the Desktop runtime never loads from third-party packages in the seed's pnpm store.
 *
 * Pruning rewrites each package's `package_index` record and deletes content objects no remaining record
 * references, so pnpm installs a smaller, self-consistent package from the store: `pnpm install --offline`
 * links only files the index lists, and the seed's `integrity.json` is computed after pruning. First-party
 * packages (`file:` tarballs from the Desktop package set) are never pruned: they ship exactly what they
 * publish. A rule for a pinned package version that matches nothing fails the build, so upgrading that
 * package forces its rule to be reviewed.
 */

import { unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  isExecutableMode,
  listPnpmCasObjects,
  pnpmCasReferenceKey,
  pnpmPackageFileMaps,
  pnpmStoreVersionRoots,
  readPnpmIndexRows,
  writeChangedPnpmIndexRows,
} from './pnpm-store-index.ts'

/** Release target whose native payload the pruned store keeps. */
export interface SeedStorePruneTarget {
  readonly platform: 'darwin' | 'win32' | 'linux'
  readonly arch: 'arm64' | 'x64'
}

/** Files removed from one exact third-party package version, with the reason nothing loads them. */
export interface SeedStorePackageRule {
  readonly name: string
  readonly version: string
  readonly reason: string
  /** Package-relative paths to remove on this target: a trailing `/` removes a directory. */
  readonly remove: (target: SeedStorePruneTarget) => readonly string[]
}

/** Counts reported after pruning one store. */
export interface SeedStorePruneResult {
  readonly removedFiles: number
  readonly removedBytes: number
  readonly deletedObjects: number
  readonly updatedIndexRows: number
}

/**
 * Package files no Desktop code path loads, independent of the package:
 * source maps (the Host runs without `--enable-source-maps`), TypeScript declarations and sources (Node refuses
 * to strip types under `node_modules`), Windows debug symbols, and release-history Markdown.
 */
const UNLOADED_FILE_PATTERN = new RegExp(
  String.raw`(?:\.map|\.d\.[cm]?ts|(?<!\.d)\.[cm]?tsx?|\.pdb)$`
  + String.raw`|(?:^|\/)(?:readme|changelog|history|changes|contributing|code_of_conduct|security|upgrading)(?:\.[a-z0-9-]+)*\.md$`,
  'iu',
)

/** Node-style prebuilt directory for one platform and architecture, as node-gyp-build and prebuildify lay it out. */
const PREBUILD_DIRECTORY_PATTERN = /(?:^|\/)prebuilds\/([a-z0-9]+-[a-z0-9]+)\//u

/** Pinned package rules; each names the only files its package's Node entry point reads. */
export const SEED_STORE_PACKAGE_RULES: readonly SeedStorePackageRule[] = [
  {
    name: 'tesseract.js-core',
    version: '7.0.0',
    reason: 'tesseract.js 7 in Node loads a full (non-LSTM-only) core and its `.wasm` beside the loader: its Node `getCore` compares the boolean `lstmOnly` with numeric OEM codes, so the LSTM-only branch never matches. The `.wasm.js` copies embed the same WebAssembly for browsers.',
    remove: () => [
      'tesseract-core-lstm.js',
      'tesseract-core-lstm.wasm',
      'tesseract-core-simd-lstm.js',
      'tesseract-core-simd-lstm.wasm',
      'tesseract-core-relaxedsimd-lstm.js',
      'tesseract-core-relaxedsimd-lstm.wasm',
      'tesseract-core.wasm.js',
      'tesseract-core-lstm.wasm.js',
      'tesseract-core-simd.wasm.js',
      'tesseract-core-simd-lstm.wasm.js',
      'tesseract-core-relaxedsimd.wasm.js',
      'tesseract-core-relaxedsimd-lstm.wasm.js',
    ],
  },
  {
    name: '@tesseract.js-data/eng',
    version: '1.0.0',
    reason: 'The OCR provider reads only the `4.0.0_best_int` language model.',
    remove: () => ['4.0.0/'],
  },
  {
    name: 'pdfjs-dist',
    version: '6.1.200',
    reason: 'The OCR worker imports `legacy/build/pdf.mjs`, whose Node fake worker imports `legacy/build/pdf.worker.mjs`; the provider passes `wasm/` and `standard_fonts/`. The modern build, viewer, image decoders, minified copies, and sandbox are browser entry points.',
    remove: () => [
      'build/',
      'web/',
      'image_decoders/',
      'types/',
      'legacy/web/',
      'legacy/image_decoders/',
      'legacy/build/pdf.min.mjs',
      'legacy/build/pdf.worker.min.mjs',
      'legacy/build/pdf.sandbox.mjs',
      'legacy/build/pdf.sandbox.min.mjs',
    ],
  },
  {
    name: 'node-pty',
    version: '1.2.0-beta.15',
    reason: 'Only the Windows postinstall copies ConPTY from `third_party/conpty`.',
    remove: target => target.platform === 'win32' ? [] : ['third_party/'],
  },
  {
    name: 'onnxruntime-node',
    version: '1.24.3',
    reason: 'The binding loads `bin/napi-v6/<platform>/<arch>/` for the running Host only; the package ships every platform\'s runtime.',
    remove: (target) => {
      const all = { darwin: ['arm64'], linux: ['arm64', 'x64'], win32: ['arm64', 'x64'] } as const
      return Object.entries(all).flatMap(([platform, archs]) => archs
        .filter(arch => platform !== target.platform || arch !== target.arch)
        .map(arch => `bin/napi-v6/${platform}/${arch}/`))
    },
  },
  {
    name: 'onnxruntime-web',
    version: '1.26.0-dev.20260416-b7804b056c',
    reason: '@huggingface/transformers 4.2.0 inlines its WebAssembly runtime into `transformers.node.mjs` and runs inference through onnxruntime-node in the Host; no Desktop code path imports this package\'s `dist/`.',
    remove: () => ['dist/'],
  },
]

function parsePackageId(key: string): { name: string; version: string } | undefined {
  const separator = key.indexOf('\t')
  if (separator === -1) throw new Error(`desktop seed prune: unsupported pnpm index key ${JSON.stringify(key)}`)
  const id = key.slice(separator + 1)
  if (id.startsWith('file:')) return undefined
  const at = id.lastIndexOf('@')
  if (at <= 0) throw new Error(`desktop seed prune: unsupported pnpm package id ${JSON.stringify(id)}`)
  return { name: id.slice(0, at), version: id.slice(at + 1) }
}

function matchesRule(path: string, removals: readonly string[]): boolean {
  return removals.some(removal => removal.endsWith('/') ? path.startsWith(removal) : path === removal)
}

/**
 * Whether the Desktop runtime on `target` never loads one third-party package file.
 * @param path - Package-relative POSIX path.
 * @param target - Release target.
 * @param removals - Package rule paths for this package on this target.
 * @returns True when the file is removed from the seed.
 */
export function isUnloadedSeedFile(path: string, target: SeedStorePruneTarget, removals: readonly string[] = []): boolean {
  if (path === 'package.json') return false
  if (UNLOADED_FILE_PATTERN.test(path)) return true
  const prebuild = PREBUILD_DIRECTORY_PATTERN.exec(path)
  if (prebuild !== null && prebuild[1] !== `${target.platform}-${target.arch}`) return true
  return matchesRule(path, removals)
}

/**
 * Prune every version directory of a loose seed store and delete content no package references any longer.
 * @param storeRoot - Loose pnpm store populated by the seed install.
 * @param target - Release target whose prebuilt binaries are kept.
 * @param rules - Pinned package rules.
 * @returns Totals across version directories after every index transaction commits.
 * @throws When a rule matches no package or removes no file, before any index row or content object changes.
 */
export function pruneSeedStore(
  storeRoot: string,
  target: SeedStorePruneTarget,
  rules: readonly SeedStorePackageRule[] = SEED_STORE_PACKAGE_RULES,
): SeedStorePruneResult {
  const roots = pnpmStoreVersionRoots(storeRoot)
  if (roots.length === 0) throw new Error(`desktop seed prune: no pnpm store versions found in ${storeRoot}`)
  const ruleHits = new Map(rules.map(rule => [`${rule.name}@${rule.version}`, 0]))
  const prepared = roots.map((root) => {
    const database = new DatabaseSync(join(root, 'index.db'))
    const rows = readPnpmIndexRows(database)
    let removedFiles = 0
    let removedBytes = 0
    for (const row of rows) {
      const id = parsePackageId(row.key)
      if (id === undefined) continue
      const ruleKey = `${id.name}@${id.version}`
      const rule = rules.find(candidate => candidate.name === id.name && candidate.version === id.version)
      const removals = rule?.remove(target) ?? []
      pnpmPackageFileMaps(row.value, row.key)
      const files = row.value.files
      if (files === undefined) continue
      for (const [path, record] of [...files]) {
        if (!isUnloadedSeedFile(path, target, removals)) continue
        files.delete(path)
        removedFiles += 1
        removedBytes += record.size
        row.changed = true
        if (matchesRule(path, removals)) ruleHits.set(ruleKey, (ruleHits.get(ruleKey) ?? 0) + 1)
      }
    }
    return { root, database, rows, removedFiles, removedBytes }
  })
  try {
    const stale = rules.filter(rule => rule.remove(target).length > 0 && ruleHits.get(`${rule.name}@${rule.version}`) === 0)
    if (stale.length > 0) {
      throw new Error(`desktop seed prune: rules removed nothing from ${stale.map(rule => `${rule.name}@${rule.version}`).join(', ')}; review them against the installed package`)
    }
    let result: SeedStorePruneResult = { removedFiles: 0, removedBytes: 0, deletedObjects: 0, updatedIndexRows: 0 }
    for (const { root, database, rows, removedFiles, removedBytes } of prepared) {
      const referenced = new Set<string>()
      for (const row of rows) {
        for (const files of pnpmPackageFileMaps(row.value, row.key)) {
          for (const record of files.values()) referenced.add(pnpmCasReferenceKey(record.digest, isExecutableMode(record.mode)))
        }
      }
      const updatedIndexRows = writeChangedPnpmIndexRows(database, rows)
      let deletedObjects = 0
      for (const object of listPnpmCasObjects(root)) {
        if (referenced.has(pnpmCasReferenceKey(object.digest, object.executable))) continue
        unlinkSync(object.path)
        deletedObjects += 1
      }
      database.exec('VACUUM')
      result = {
        removedFiles: result.removedFiles + removedFiles,
        removedBytes: result.removedBytes + removedBytes,
        deletedObjects: result.deletedObjects + deletedObjects,
        updatedIndexRows: result.updatedIndexRows + updatedIndexRows,
      }
    }
    return result
  } finally {
    for (const { database } of prepared) database.close()
  }
}
