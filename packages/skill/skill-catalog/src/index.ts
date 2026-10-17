/** Vendored skill catalog: the local, read-only source of installable skills. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type SchemaType from '@deepseek-ai/schemastery'

/** One skill the catalog offers, without its instructions. */
export interface CatalogSkill {
  /** Name the skill installs under. */
  readonly name: string
  /** Upstream name, which may not be kebab-case. */
  readonly displayName: string
  readonly category: string
  readonly description: string
  readonly keywords: readonly string[]
  /** Upstream install count when the catalog was vendored; Settings shows it beside the row. */
  readonly downloads: number
  readonly author: string
  /** Upstream path, shown as provenance. */
  readonly path: string
  /** Unpacked size of the vendored bundle. */
  readonly bytes: number
}

/** Every skill the catalog offers, with the categories it groups them under. */
export interface CatalogView {
  /** Upstream commit the catalog was vendored from. */
  readonly commit: string
  /** Date that vendoring ran. */
  readonly synced: string
  readonly categories: readonly { readonly name: string; readonly skills: number }[]
  readonly skills: readonly CatalogSkill[]
}

/** Catalog data location. */
export interface Config {
  /** Directory holding `index.json` and `bundles/`; defaults to this package's vendored catalog. */
  catalogDir?: string
}

export const Config: SchemaType<Config> = Schema.object({
  catalogDir: Schema.string(),
})

export const name = 'skill-catalog'

/** Vendored catalog reader. */
export class SkillCatalog extends Service {
  private readonly directory: string
  private view: CatalogView | undefined

  /**
   * @param ctx - plugin context.
   * @param config - catalog data location.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'skillCatalog')
    this.directory = config.catalogDir ?? fileURLToPath(new URL('../catalog/', import.meta.url))
  }

  /**
   * Read the vendored index.
   * @returns every catalogued skill and the category counts, parsed once per process.
   */
  list(): CatalogView {
    if (this.view !== undefined) return this.view
    const index = JSON.parse(readFileSync(join(this.directory, 'index.json'), 'utf8')) as {
      upstream: { commit: string; synced: string }
      categories: readonly { name: string; skills: number }[]
      skills: readonly CatalogSkill[]
    }
    this.view = { commit: index.upstream.commit, synced: index.upstream.synced, categories: index.categories, skills: index.skills }
    return this.view
  }

  /**
   * Read one vendored bundle as it would arrive from an upload.
   * @param name - catalogued skill name.
   * @returns the bundle file name and its base64 body.
   * @throws Error when no catalogued skill carries that name.
   */
  bundle(name: string): { path: string; base64: string } {
    const skill = this.list().skills.find(candidate => candidate.name === name)
    if (skill === undefined) throw new Error(`no catalogued skill named "${name}"`)
    const bytes = readFileSync(join(this.directory, 'bundles', skill.category, `${skill.name}.zip`))
    return { path: `${skill.name}.zip`, base64: bytes.toString('base64') }
  }
}

export default SkillCatalog

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Vendored skill catalog served to Settings. */
    skillCatalog: SkillCatalog
  }
}
