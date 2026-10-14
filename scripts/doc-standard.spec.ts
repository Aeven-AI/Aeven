/**
 * Quick comprehensive documentation-standard tests: the reference example
 * stays valid, the consolidated `avn-doc` skill carries no stale copied
 * website values or prototype-era language, and the kind system maps each
 * label to exactly one skill template. These run in `pnpm run test` and
 * `pnpm run test:docs` to guard the standard between heavier corpus gates.
 * @module scripts/doc-standard.spec
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const PACKAGE_README_GLOBS = [
  'packages/README.md',
  'packages/README.zh.md',
  'packages/*/README.md',
  'packages/*/README.zh.md',
  'packages/*/*/README.md',
  'packages/*/*/README.zh.md',
] as const

function packageReadmes(): string[] {
  return PACKAGE_README_GLOBS
    .flatMap(pattern => globSync(pattern, { cwd: root, exclude: ['**/node_modules/**'] }))
    .map(file => file.replaceAll('\\', '/'))
    .sort()
}

/**
 * The kind system: each label maps to exactly one template in the avn-doc
 * skill. The check derives the expected kind from the same mechanical facts
 * the skill documents; a kind without a template, a template without a kind,
 * or a document whose kind does not match its position fails here.
 */
const KIND_TEMPLATES: Readonly<Record<string, string>> = {
  'package-group': '.agents/skills/avn-doc/templates/package-group.md',
  'package-reference': '.agents/skills/avn-doc/templates/package-reference.md',
  'package-library': '.agents/skills/avn-doc/templates/package-library.md',
  'package-bundle': '.agents/skills/avn-doc/templates/package-bundle.md',
}

/**
 * Audited packages whose entry is a plain module API rather than a Cordis
 * plugin (`apply` export or a default service export) or an installable
 * bundle (`avn.bundle.patch`). Each entry names why the package is a
 * library; the check re-derives the entry shape so a stale entry fails loud.
 */
const PACKAGE_LIBRARIES: Readonly<Record<string, string>> = {
  'packages/boot/app-boot': 'Boot library the app bins import; plain helper exports.',
  'packages/boot/cmdline': 'Command-line library the app bins import; plain module exports.',
  'packages/client/store': 'Browser-side state primitives; plain function/type exports.',
  'packages/client/ui-primitives': 'Browser-side UI component library; plain component exports.',
  'packages/client/ui-auth-aeven': 'Authentication surface linked into the boot kernel before the plugin graph; plain function and component exports.',
  'packages/client/ui-slots': 'Browser-side slot-map declarations; plain type exports.',
  'packages/client/web': 'Browser application boot library; exports the app entry and static module table.',
  'packages/core/scope': 'Scoped-context primitives; exports functions and types without a plugin entry.',
  'packages/experimental/webworker-packer': 'Build-time VFS image packer and command library.',
  'packages/experimental/webworker-runtime': 'Browser worker runtime library with explicit host entry points.',
  'packages/hooks/hook-protocol': 'Shared wire-protocol library between the hook bridges.',
  'packages/identity/anonymous-user-id': 'Harness-home identity helper with no plugin registration.',
  'packages/sandbox/sandbox-windows-acl': 'Windows ACL sandbox library consumed by sandbox-local.',
  'packages/sdk/client': 'Client-process library; the spawned runtime owns plugin behavior.',
  'packages/sdk/protocol': 'Wire-protocol library with type declarations only.',
  'packages/session/session-telemetry': 'Telemetry Service Definition and capture library; providers mount the backend.',
  'packages/session/session-title-llm': 'Shared LLM title-provider registration and request policy.',
  'packages/subagent/subagent-in-process-driver': 'Shared one-shot child-agent driver used by provider plugins.',
  'packages/subprocess/win32-process': 'Low-level Win32 process and Job Object primitives.',
  'packages/test-support/session-snapshot': 'Test infrastructure; mounts nothing into a product composition.',
  'packages/test-support/agent-loop-testkit': 'Test helper library; mounts nothing into a product composition.',
  'packages/test-support/client-runtime': 'Browser-side test infrastructure.',
  'packages/test-support/llm-mock-server': 'Test server library; substitutes provider wire behavior.',
  'packages/test-support/loader-smoke': 'Test harness library; mounts nothing into a product composition.',
  'packages/typert/generator': 'Build-time generator run outside any agent runtime.',
  'packages/typert/protocol': 'Compiler-independent protocol declarations.',
  'packages/util/atomic-write': 'Zero-dependency filesystem write utility.',
  'packages/util/brand': 'Stateless nominal-string and canonical-key constructors.',
  'packages/util/crypto': 'Zero-dependency identifier minting utility.',
  'packages/util/deque': 'Zero-dependency circular deque utility.',
  'packages/util/home-paths': 'Zero-dependency harness-home path resolver.',
  'packages/util/launch-environment': 'Zero-dependency environment resolver.',
  'packages/util/native-command': 'Host-side subprocess runner utility.',
  'packages/util/output-retention': 'Zero-dependency retention utility.',
  'packages/util/time': 'Zero-dependency time-zone canonicalization utility.',
  'packages/util/timeout': 'Zero-dependency timeout utility.',
  'packages/util/values': 'Stateless lossless-JSON and immutable-value helpers.',
  'packages/util/workspace-path': 'Zero-dependency Workspace path formatter.',
}

/**
 * Package READMEs declaring a kind the kind system does not define, keyed by README
 * path with the debt each one carries. The corpus is the truth for this gate, so the
 * debt is recorded here rather than fixed in the README, and an exempt README keeps
 * every other metadata check. The registry self-invalidates: an entry whose file is
 * gone, or whose kind now matches its position, fails the spec until the entry goes.
 */
const PACKAGE_KIND_DEBT: Readonly<Record<string, string>> = {
  'packages/client/ui-settings-personalization/README.md':
    'declares kind "package", which the kind system does not define; the package is a plugin, so its kind is package-reference',
  'packages/client/ui-settings-personalization/README.zh.md':
    'declares kind "package", which the kind system does not define; the package is a plugin, so its kind is package-reference',
  'packages/preset/personalization/README.md':
    'declares kind "package", which the kind system does not define; the package is a plugin, so its kind is package-reference',
  'packages/preset/personalization/README.zh.md':
    'declares kind "package", which the kind system does not define; the package is a plugin, so its kind is package-reference',
}

/**
 * Package READMEs whose section skeleton deviates from the package standard, keyed by
 * README path; each value is the exact structure error the README carries, so it names
 * the sections the README lacks. The corpus is the truth for this gate, so a deviation
 * is recorded here rather than fixed in the README, and the recorded list is exactly
 * what the check asserts, which self-invalidates: an entry whose file is gone, or whose
 * README now carries every section, fails the spec until the entry goes. Group READMEs
 * (`packages/<group>/README.md`) are not in this corpus.
 */
const PACKAGE_SKELETON_DEBT: Readonly<Record<string, readonly string[]>> = {
  'packages/capability/capability/README.md': ['missing Table of Contents'],
  'packages/capability/capability/README.zh.md': ['missing 目录'],
  'packages/capability/tool-capability/README.md': ['missing Table of Contents'],
  'packages/capability/tool-capability/README.zh.md': ['missing 目录'],
  'packages/client/ui-automations/README.md': ['missing Table of Contents', 'missing Dev Note'],
  'packages/client/ui-automations/README.zh.md': ['missing 目录', 'missing 开发备注'],
  'packages/client/ui-imagine/README.zh.md': ['missing 概述', 'missing 开发备注'],
  'packages/client/ui-location/README.zh.md': ['missing 概述'],
  'packages/client/ui-settings-integrations/README.zh.md': ['missing 概述', 'missing 开发备注'],
  'packages/client/ui-settings-memory/README.md': ['missing Table of Contents'],
  'packages/client/ui-settings-memory/README.zh.md': ['missing 目录'],
  'packages/client/ui-settings-personalization/README.md': ['missing Table of Contents', 'missing Dev Note'],
  'packages/client/ui-settings-personalization/README.zh.md': ['missing 目录', 'missing 开发备注'],
  'packages/core/automations/README.md': ['missing Table of Contents', 'missing Dev Note'],
  'packages/core/automations/README.zh.md': ['missing 概述', 'missing 目录', 'missing 开发备注'],
  'packages/guard/access-policy/README.md': ['missing Dev Note'],
  'packages/guard/access-policy/README.zh.md': ['missing 概述', 'missing 开发备注'],
  'packages/interaction/tool-location/README.zh.md': ['missing 概述'],
  'packages/mail/mail/README.md': ['missing Table of Contents', 'missing Dev Note'],
  'packages/mail/mail/README.zh.md': ['missing 目录', 'missing 开发备注'],
  'packages/mail/tool-mail/README.md': ['missing Table of Contents', 'missing Dev Note'],
  'packages/mail/tool-mail/README.zh.md': ['missing 目录', 'missing 开发备注'],
  'packages/memory/api-memory-manager/README.md': ['missing Table of Contents'],
  'packages/memory/api-memory-manager/README.zh.md': ['missing 目录'],
  'packages/memory/memory-context/README.md': ['missing Table of Contents'],
  'packages/memory/memory-context/README.zh.md': ['missing 目录'],
  'packages/memory/memory-invariants/README.md': ['missing Table of Contents'],
  'packages/memory/memory-invariants/README.zh.md': ['missing 目录'],
  'packages/memory/memory-memos/README.md': ['missing Table of Contents'],
  'packages/memory/memory-memos/README.zh.md': ['missing 目录'],
  'packages/memory/memory/README.md': ['missing Table of Contents'],
  'packages/memory/memory/README.zh.md': ['missing 目录'],
  'packages/memory/tool-memory/README.md': ['missing Table of Contents'],
  'packages/memory/tool-memory/README.zh.md': ['missing 目录'],
  'packages/preset/personalization/README.md': ['missing Table of Contents', 'missing Dev Note'],
  'packages/preset/personalization/README.zh.md': ['missing 目录', 'missing 开发备注'],
  'packages/sandbox/tool-elevation/README.zh.md': ['missing 概述'],
  'packages/skill/skill-catalog/README.zh.md': ['missing 概述'],
  'packages/speech/speech-to-text-whisper/README.md': ['missing Table of Contents', 'missing Dev Note'],
  'packages/speech/speech-to-text-whisper/README.zh.md': ['missing 目录', 'missing 开发备注'],
  'packages/web/browser-chromium/README.md': ['missing Table of Contents', 'missing Dev Note'],
  'packages/web/browser-chromium/README.zh.md': ['missing 目录', 'missing 开发备注'],
  'packages/web/tool-browser/README.zh.md': ['missing 概述'],
  'packages/web/tool-image-search/README.md': ['missing Dev Note'],
  'packages/web/tool-image-search/README.zh.md': ['missing 开发备注'],
}

function readFrontmatter(file: string): Record<string, unknown> {
  const source = readFileSync(resolve(root, file), 'utf8')
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(source)
  expect(match, `${file}: YAML frontmatter`).not.toBeNull()
  const metadata = load(match?.[1] ?? '')
  expect(metadata, `${file}: frontmatter object`).toBeTypeOf('object')
  expect(Array.isArray(metadata), `${file}: frontmatter object`).toBe(false)
  return metadata as Record<string, unknown>
}

function packageDir(file: string): string {
  return file.replaceAll('\\', '/').replace(/\/README\.zh\.md$/, '').replace(/\/README\.md$/, '')
}

/** Whether the package manifest declares `avn.bundle.patch`. */
function declaresBundle(dir: string): boolean {
  const manifest = resolve(root, dir, 'package.json')
  if (!existsSync(manifest)) return false
  const metadata = JSON.parse(readFileSync(manifest, 'utf8')) as { avn?: { bundle?: { patch?: string } } }
  return metadata.avn?.bundle?.patch !== undefined
}

/** The expected kind for one package README, from the facts the skill documents. */
function expectedKind(file: string): string {
  const normalized = file.replaceAll('\\', '/')
  if (normalized.split('/').length <= 3) return 'package-group'
  const dir = packageDir(normalized)
  if (declaresBundle(dir)) return 'package-bundle'
  if (Object.hasOwn(PACKAGE_LIBRARIES, dir)) return 'package-library'
  return 'package-reference'
}

function packageReadmeMetadataErrors(file: string, metadata: Record<string, unknown>): string[] {
  const errors: string[] = []
  if (metadata.kind !== expectedKind(file)) errors.push(`kind must be ${expectedKind(file)}`)
  if (typeof metadata.description !== 'string' || metadata.description.trim() === '') {
    errors.push('description must be a non-empty string')
  }
  for (const field of ['name', 'audience', 'tags', 'i18n']) {
    if (field in metadata) errors.push(`${field} is redundant or has no governed consumer`)
  }
  return errors
}

function packageReadmeStructureErrors(file: string, source: string): string[] {
  const chinese = file.endsWith('.zh.md')
  const required = chinese
    ? [[/^## 概述$/m, '概述'], [/^## 目录$/m, '目录'], [/^#{2,3} 开发备注$/m, '开发备注']] as const
    : [[/^## Summary$/m, 'Summary'], [/^## Table of Contents$/m, 'Table of Contents'], [/^#{2,3} Dev Note$/m, 'Dev Note']] as const
  return required.flatMap(([pattern, label]) => pattern.test(source) ? [] : [`missing ${label}`])
}

describe('avn-doc skill consolidation', () => {
  it('carries no prototype-era language', () => {
    const files = [
      '.agents/skills/avn-doc/SKILL.md',
      '.agents/skills/avn-doc/references/metadata-links-i18n.md',
      '.agents/skills/avn-doc/references/structure-hierarchy.md',
      '.agents/skills/avn-doc/references/style.md',
      '.agents/skills/avn-doc/references/review.md',
      '.agents/skills/avn-doc/references/website-sync.md',
    ]
    for (const file of files) {
      const source = readFileSync(resolve(root, file), 'utf8')
      expect(source, file).not.toMatch(/\bprototype\b/i)
    }
  })

  it('copies no stale website sidebar or section-owner values', () => {
    const source = readFileSync(resolve(root, '.agents/skills/avn-doc/references/website-sync.md'), 'utf8')
    expect(source).not.toContain('en-docs')
    expect(source).not.toContain('sectionOrder')
  })

  it('keeps the reference example linked from the skill', () => {
    const skill = readFileSync(resolve(root, '.agents/skills/avn-doc/SKILL.md'), 'utf8')
    expect(skill).toContain('session-persistence-jsonl/README.md')
    expect(skill).toContain('session-persistence-jsonl/README.zh.md')
  })

  it('defines controlled English as a precision-preserving review discipline', () => {
    const skill = readFileSync(resolve(root, '.agents/skills/avn-doc/SKILL.md'), 'utf8')
    const style = readFileSync(resolve(root, '.agents/skills/avn-doc/references/style.md'), 'utf8')
    expect(skill).toContain('references/style.md#controlled-technical-english')
    expect(style).toContain('not certified ASD-STE100 compliance')
    expect(style).toContain('review prompts, not mechanical gates')
    expect(style).toContain('Never remove or strengthen `must`, `may`, `never`')
  })

  it('maps every kind label to exactly one skill template that exists', () => {
    const templateFiles = globSync('.agents/skills/avn-doc/templates/*.md', { cwd: root }).map(path => path.split(sep).join('/')).sort()
    const registered = Object.values(KIND_TEMPLATES).sort()
    expect(templateFiles).toEqual(registered)
    for (const [kind, template] of Object.entries(KIND_TEMPLATES)) {
      expect(existsSync(resolve(root, template)), `${kind}: template ${template}`).toBe(true)
    }
  })

  it('maps package README kinds to their documentation standards', () => {
    const files = packageReadmes()
    expect(files.length).toBeGreaterThan(0)
    for (const file of Object.keys(PACKAGE_KIND_DEBT)) {
      expect(files, `${file}: recorded kind debt names a README this check reads`).toContain(file)
    }

    for (const file of files) {
      const metadata = readFrontmatter(file)
      // A recorded kind debt excuses this README from the kind equality alone: a
      // description or a redundant field still fails the check below.
      const expected = Object.hasOwn(PACKAGE_KIND_DEBT, file) ? [`kind must be ${expectedKind(file)}`] : []
      expect(packageReadmeMetadataErrors(file, metadata), file).toEqual(expected)
    }
  })

  it('keeps the audited library registry accurate: every entry has a plain module entry and no bundle declaration', () => {
    for (const [dir, reason] of Object.entries(PACKAGE_LIBRARIES)) {
      expect(reason.trim().length, `${dir}: library justification`).toBeGreaterThan(0)
      expect(declaresBundle(dir), `${dir}: a bundle declaration makes this package-bundle, not a library`).toBe(false)
      const entry = resolve(root, dir, 'src/index.ts')
      expect(existsSync(entry), `${dir}: library entry`).toBe(true)
      const source = readFileSync(entry, 'utf8')
      expect(source, `${dir}: entry must be a plain module, not a plugin`).not.toMatch(/export (?:default|\{[^}]*default[^}]*\} from)/u)
      expect(source, `${dir}: entry must be a plain module, not a plugin`).not.toMatch(/export (?:async )?(?:function|const) apply\b/u)
    }
  })

  it('keeps every package README on the summary, contents, and Dev Note skeleton', () => {
    const files = packageReadmes().filter(file => file.split('/').length === 4)
    for (const file of Object.keys(PACKAGE_SKELETON_DEBT)) {
      expect(files, `${file}: recorded skeleton debt names a README this check reads`).toContain(file)
    }

    for (const file of files) {
      const source = readFileSync(resolve(root, file), 'utf8')
      // A recorded debt replaces the empty expectation with the exact sections this
      // README lacks, so an unrecorded deviation and a settled debt both fail here.
      expect(packageReadmeStructureErrors(file, source), file).toEqual(PACKAGE_SKELETON_DEBT[file] ?? [])
    }
  })

  it('rejects redundant fields and a kind that does not match the README position', () => {
    expect(packageReadmeMetadataErrors('packages/example/README.md', {
      description: 'Example group.',
      kind: 'package-reference',
      name: 'example',
      audience: ['developer'],
      tags: ['example'],
      i18n: { counterpart: 'README.zh.md' },
    })).toEqual([
      'kind must be package-group',
      'name is redundant or has no governed consumer',
      'audience is redundant or has no governed consumer',
      'tags is redundant or has no governed consumer',
      'i18n is redundant or has no governed consumer',
    ])
    expect(packageReadmeMetadataErrors('packages\\example\\package\\README.md', {
      description: 'Example package.',
      kind: 'package-reference',
    })).toEqual([])
  })

  it('rejects README-local i18n metadata', () => {
    expect(packageReadmeMetadataErrors('packages\\example\\package\\README.md', {
      description: 'Example package.',
      kind: 'package-reference',
      i18n: {
        'counterpart': 'packages/example/package/README.zh.md',
        'line-aligned': true,
      },
    })).toEqual([
      'i18n is redundant or has no governed consumer',
    ])
  })
})

describe('reference-example README pair', () => {
  const dir = 'packages/session/session-persistence-jsonl'

  it('keeps exact English/Chinese physical line alignment', () => {
    const sourceLines = readFileSync(resolve(root, dir, 'README.md'), 'utf8').split('\n').length
    const zhLines = readFileSync(resolve(root, dir, 'README.zh.md'), 'utf8').split('\n').length
    expect(sourceLines).toBe(zhLines)
  })

  it('keeps the sidecar consistency record present', () => {
    const sidecar = readFileSync(resolve(root, dir, 'README.i18n.yaml'), 'utf8')
    expect(sidecar).toMatch(/^README\.md: [0-9a-f]{40}$/m)
    expect(sidecar).toMatch(/^README\.zh\.md: [0-9a-f]{40}$/m)
  })
})
