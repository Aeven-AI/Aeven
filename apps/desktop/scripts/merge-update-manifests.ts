/**
 * Merge two electron-builder update manifests for one platform into one feed.
 *
 * Windows x64 and arm64 build on separate runners, and each writes its own
 * `latest.yml` (or `alpha.yml`, ... for a prerelease). A GitHub Release holds
 * one file of that name, so the release job merges the two: the merged feed
 * lists both installers, and electron-updater picks the one whose file name
 * carries the running process's architecture. The primary manifest keeps its
 * top-level `path` and `sha512`, which older updaters read.
 *
 * Usage: tsx scripts/merge-update-manifests.ts <primary.yml> <secondary.yml> <output.yml>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dump, load } from 'js-yaml'

/** One downloadable file an update manifest lists. */
export interface UpdateManifestFile {
  readonly url: string
  readonly sha512: string
  readonly size: number
  readonly [key: string]: unknown
}

/** The fields of an electron-builder update manifest this merge reads. */
export interface UpdateManifest {
  readonly version: string
  readonly files: readonly UpdateManifestFile[]
  readonly [key: string]: unknown
}

function parseManifest(raw: string, source: string): UpdateManifest {
  const value: unknown = load(raw)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`merge-update-manifests: ${source} is not a manifest object`)
  }
  const manifest = value as Record<string, unknown>
  if (typeof manifest['version'] !== 'string' || !Array.isArray(manifest['files'])) {
    throw new Error(`merge-update-manifests: ${source} has no version or files list`)
  }
  return manifest as UpdateManifest
}

/**
 * Merge two manifests of one release.
 * @param primary - the manifest whose top-level fields the merged feed keeps.
 * @param secondary - the manifest whose files are added.
 * @returns the merged manifest.
 * @throws when the two describe different versions.
 */
export function mergeUpdateManifests(primary: UpdateManifest, secondary: UpdateManifest): UpdateManifest {
  if (primary.version !== secondary.version) {
    throw new Error(`merge-update-manifests: versions differ (${primary.version} vs ${secondary.version})`)
  }
  const urls = new Set(primary.files.map(file => file.url))
  return { ...primary, files: [...primary.files, ...secondary.files.filter(file => !urls.has(file.url))] }
}

function main(): void {
  const [primaryPath, secondaryPath, outputPath] = process.argv.slice(2)
  if (primaryPath === undefined || secondaryPath === undefined || outputPath === undefined) {
    throw new Error('usage: merge-update-manifests <primary.yml> <secondary.yml> <output.yml>')
  }
  const merged = mergeUpdateManifests(
    parseManifest(readFileSync(primaryPath, 'utf8'), primaryPath),
    parseManifest(readFileSync(secondaryPath, 'utf8'), secondaryPath),
  )
  writeFileSync(outputPath, dump(merged, { lineWidth: -1 }))
  console.log(`merge-update-manifests: ${outputPath} lists ${String(merged.files.length)} files for ${merged.version}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
