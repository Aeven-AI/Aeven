/**
 * Verify that no pre-rename brand token survives outside an explicit allowlist.
 *
 * This is the gate that makes the DSH -> Aeven rename *hold*. Without it the
 * next upstream cherry-pick or feature branch quietly reintroduces `dsh`, and
 * the rename decays one commit at a time.
 *
 * Scope is source and fixtures. Derived artifacts (`pnpm-lock.yaml`, `lib/`,
 * build records) are out of scope: they are regenerated from source, and a
 * correct rename makes them correct. The content-sealed archive and the legally
 * fixed attribution files are excluded because rewriting them is either
 * forbidden or wrong -- see {@link EXCLUDED_FILES} and {@link EXCLUDED_TREES}.
 *
 * Usage:
 *   tsx scripts/verify-brand.ts
 *
 * @module scripts/verify-brand
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * Ordinary English words that merely contain the letters `dsh`. These must keep
 * matching; a blind `dsh` -> `avn` pass corrupts them, which is the single
 * largest hazard of this rename.
 */
const ORDINARY_WORD_PREFIXES = [
  // `handshake` covers `handshake-abort` and the `handshake.` form, but NOT
  // `handshaking` -- that is `handshak` + `ing`, with no `e`.
  'handshake',
  'handshaking',
  'mid-handshake',
  'quantum-handshake',
  'publish-after-handshake',
  'cancel-during-handshake',
  'CardShell',
  'cardShape',
  'addShapes',
  'insertedShapes',
  'confettiGroup.addShapes',
  'headSha',
  'MatchedShare',
  'secondShared',
  'SecondSharedService',
  'isSpilledShellCall',
  '_unidentifiedShellExitedDuringHostExit',
  // `spreadsheet` is sprea + dsh + eet: an ordinary word that happens to carry the
  // letters, so a blind pass would corrupt it into `spreaavneet`. It reaches this
  // gate as `spreadsheet.setCell`, `SPREADSHEET_RECIPES` and bare `Spreadsheet`,
  // which is why the prefix covers the whole family rather than one spelling.
  'spreadsheet',
]

/**
 * Names that belong to someone else and are therefore correct as they stand.
 *
 * `dsh-coding-oauth-core` is a published external npm package, and
 * `DshHostCapability`/`DshHostCapabilities` are symbols it exports; renaming
 * either breaks module resolution. `dsh-hub-oauth-gateway` is the upstream
 * repository that package comes from.
 */
const FOREIGN_NAME_PREFIXES = [
  'dsh-coding-oauth-core',
  'DshHostCapabilit',
  'dsh-hub-oauth-gateway',
]

/**
 * HTTP path prefixes that belong to someone else.
 *
 * `dsh-coding-oauth-core` publishes its route constants under this prefix, and
 * the host registers those values verbatim, so a reference here is a path into
 * that external package rather than one of our names. Scoped to the whole
 * `/plugins/...` prefix on purpose: a bare `dsh-grok-build` identifier anywhere
 * else is still a defect.
 */
const FOREIGN_PATH_PREFIXES = [
  '/plugins/dsh-grok-build/',
]

/**
 * Path segment naming the content- and path-sealed Agent Note archive.
 *
 * `.agents/notes/archived/` is sealed on both content and filenames, so a note
 * that links into it from elsewhere must spell the sealed name or the link
 * breaks. Matching the segment rather than listing files keeps the rule correct
 * as the archive grows, and `.agents/notes/archived/` is the only `archived`
 * directory in the repository, so nothing else can hide behind it.
 */
const SEALED_ARCHIVE_SEGMENT = '/archived/'

/** Files whose content is not ours to rewrite. */
const EXCLUDED_FILES = new Map([
  // The compatibility shim exists to detect these names, so it has to spell
  // them. Scoped to these four files rather than allowlisting the tokens
  // globally: a fresh `.dsh` anywhere else is still a defect.
  ['packages/util/home-paths/src/index.ts', 'defines the pre-rename names it detects'],
  ['packages/util/home-paths/tests/home-paths.spec.ts', 'specifies the pre-rename names'],
  ['apps/cli/src/legacy-home-notice.ts', 'reports the pre-rename names'],
  ['apps/cli/tests/legacy-home-notice.spec.ts', 'specifies the pre-rename names'],
  ['scripts/sync-generated-doc-pair.mjs', 'the rename tooling documents the pre-rename names'],
  ['scripts/verify-brand.ts', 'the gate defines the patterns it rejects'],
  ['LICENSE', 'MIT copyright notice is legally fixed'],
  ['THIRD_PARTY_NOTICES.md', 'third-party attribution is legally fixed'],
  ['python/sdk/uv.lock', 'external PyPI distribution names'],
  ['pnpm-lock.yaml', 'pnpm-generated resolution'],
  ['scripts/rename-brand.mjs', 'the rename tooling defines these patterns'],
  ['scripts/rename-brand-paths.mjs', 'the rename tooling defines these patterns'],
])

/** Trees whose content is not ours to rewrite. */
const EXCLUDED_TREES = new Map([
  ['.agents/notes/archived/', 'content-sealed archive'],
  ['lib/', 'generated build output'],
])

/**
 * Match runs of identifier characters containing `dsh`, plus the hyphenated
 * product name, which contains no `dsh` substring and so needs its own case.
 */
const GREP_PATTERN = '[A-Za-z0-9_@./-]*[Dd][Ss][Hh][A-Za-z0-9_@./-]*|deepseek-harness'

/** One offending occurrence. */
interface Finding {
  readonly path: string
  readonly line: number
  readonly token: string
}

/**
 * Whether a path is out of scope for the gate.
 * @param path - repository-relative path.
 * @returns the exclusion reason, or `undefined` when the path is in scope.
 */
function exclusionReason(path: string): string | undefined {
  const file = EXCLUDED_FILES.get(path)
  if (file !== undefined) return file
  for (const [prefix, reason] of EXCLUDED_TREES) {
    if (path.startsWith(prefix) || path.includes(`/${prefix}`)) return reason
  }
  return undefined
}

/**
 * Whether one matched run is an allowed survivor.
 * @param token - the matched run.
 * @returns true when the token is ordinary prose or a foreign name.
 */
function isAllowed(token: string): boolean {
  if (FOREIGN_NAME_PREFIXES.some(prefix => token.startsWith(prefix))) return true
  // `/` is an identifier character here, so a route literal arrives as one run
  // spanning the whole path. Test the path prefix before stripping, or the
  // foreign segment inside `/plugins/<name>/oauth` would look like our own.
  if (FOREIGN_PATH_PREFIXES.some(prefix => token.startsWith(prefix))) return true
  if (token.includes(SEALED_ARCHIVE_SEGMENT)) return true
  // A run may carry surrounding punctuation -- `/` is an identifier character
  // for paths, so a fixture reference reads `/handshake-abort/`. Classify the
  // word inside it, not the raw run, or ordinary prose slips through.
  const word = token.replace(/^[/.]+/, '').replace(/[/.]+$/, '')
  // Case-insensitively, because the same ordinary word arrives as `spreadsheet`,
  // `Spreadsheet` and `SPREADSHEET_RECIPES`, and enumerating spellings would make
  // each new capitalisation a fresh gate failure.
  const lowered = word.toLowerCase()
  return ORDINARY_WORD_PREFIXES.some(prefix => lowered.startsWith(prefix.toLowerCase()))
}

/**
 * Extract every brand-ish run from one line of file content.
 * @param content - the matched line.
 * @returns the runs found, in order.
 */
function runsIn(content: string): string[] {
  return content.match(/[A-Za-z0-9_@./-]*[Dd][Ss][Hh][A-Za-z0-9_@./-]*|deepseek-harness/g) ?? []
}

/**
 * Classify one line of file content, pushing offending runs.
 * @param path - repository-relative path, already known to be in scope.
 * @param line - 1-based line number.
 * @param content - the line's text.
 * @param into - findings accumulator.
 */
function scanLine(path: string, line: number, content: string, into: Finding[]): void {
  for (const token of runsIn(content)) {
    if (isAllowed(token)) continue
    into.push({ path, line, token })
  }
}

/**
 * Collect every offending occurrence across tracked files.
 * @returns findings from the committed tree.
 */
function collectTracked(): Finding[] {
  let output: string
  try {
    output = execFileSync('git', ['grep', '-I', '-n', '-E', GREP_PATTERN, '--', '.'], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    })
  } catch (error) {
    // git grep exits 1 when nothing matched, which is the success case here.
    const status = (error as { status?: number }).status
    if (status === 1) return []
    throw error
  }

  const findings: Finding[] = []
  for (const record of output.split('\n')) {
    if (record.length === 0) continue
    const first = record.indexOf(':')
    const second = record.indexOf(':', first + 1)
    if (first === -1 || second === -1) continue
    const path = record.slice(0, first).replace(/^\.\//, '')
    if (exclusionReason(path) !== undefined) continue
    scanLine(path, Number(record.slice(first + 1, second)), record.slice(second + 1), findings)
  }
  return findings
}

/**
 * Collect findings from files that are neither committed nor gitignored.
 *
 * `git grep` only reads the tree, so without this a brand-new file stays
 * invisible until it is committed -- and the gate is meant to be runnable
 * before that. Ignored paths (`lib/`, build records) are skipped by
 * `--exclude-standard`, which is what keeps generated output out of scope.
 * @returns findings from untracked files.
 */
function collectUntracked(): Finding[] {
  const listed = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' })
  const findings: Finding[] = []
  for (const path of listed.split('\n')) {
    if (path.length === 0 || exclusionReason(path) !== undefined) continue
    let content: string
    try {
      content = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    content.split('\n').forEach((text, index) => { scanLine(path, index + 1, text, findings) })
  }
  return findings
}

/** Collect every offending occurrence across the working tree. */
function collect(): Finding[] {
  return [...collectTracked(), ...collectUntracked()]
}

const findings = collect()

if (findings.length > 0) {
  const byToken = new Map<string, number>()
  for (const finding of findings) byToken.set(finding.token, (byToken.get(finding.token) ?? 0) + 1)
  console.error(`verify-brand: ${findings.length} pre-rename token(s) outside the allowlist:`)
  for (const [token, count] of [...byToken].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.error(`  ${String(count).padStart(5)}  ${token}`)
  }
  console.error('\n  first occurrences:')
  for (const finding of findings.slice(0, 10)) {
    console.error(`    ${finding.path}:${String(finding.line)}  ${finding.token}`)
  }
  console.error(
    '\n  If a name belongs to an external package, or the file is derived or legally fixed,'
    + '\n  add it to scripts/verify-brand.ts rather than renaming it.',
  )
  process.exit(1)
}

console.log('verify-brand: no pre-rename tokens outside the allowlist.')
