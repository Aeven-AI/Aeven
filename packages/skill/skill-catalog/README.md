---
description: "Vendored skill catalog: browse the shipped skills grouped by category and install one into an account."
kind: "package-reference"
---

# @aeven/skill-catalog

English | [中文](README.zh.md)

## Summary

A release ships a skill catalog inside this package: the reviewed high-value subset of the upstream `davila7/claude-code-templates` collection, together with skills written in this repository for targets that collection does not cover (today `reverse-engineering` and `leanrea`) and a reviewed set other repositories publish in the same `SKILL.md` layout (today ten motion skills from `nexu-io/open-design`), as an index plus one zip per skill. Settings browses it as one title-ordered list or by category — an index of categories with their skill counts, then one category's skills — searches it, and installs a chosen skill into the signed-in account's own library. Nothing in the catalog reaches a model until someone installs it.

The Host fetches nothing at runtime: the index and the bundles are files in this package, read through `ctx.skillCatalog`. An install hands the vendored zip to the account's ordinary import path, so path validation, the size ceiling, resource storage, and catalog invalidation behave exactly as a manual upload.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----


<a id="use-this-package"></a>
## Use this package

The web application bundle mounts this plugin beside [`@aeven/host-account-integrations`](../../host/account-integrations/README.md), which serves the catalog to Settings and performs the install through `catalog()` and `installCatalogSkill()`. Removing the composition row removes the Catalog view; the rest of the Skills page keeps working.

The Catalog view is the default half of the Skills page while an account has installed nothing, and one switch at the top of the page moves between the account's own skills and the catalog.

-----


<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`scripts/sync-skill-catalog.ts` regenerates the catalog while preparing a release, never inside a running deployment. One run pins an upstream commit, downloads every skill whose reviewed value reaches `curation.json`'s `minValue` and whose name is not in its `exclude` list, and writes `catalog/index.json`, `catalog/bundles/<category>/<name>.zip`, and `catalog/MANIFEST.md`.

Installed names come from the upstream directory name, which is the kebab-case identity the skill registry requires; a basename two skills share is prefixed with its category, and a name two skills of one category share falls back to the whole upstream path. Every vendored `SKILL.md` carries the same name in its frontmatter, so the bundle and the index agree. A skill directory nested inside another is vendored as its own entry and excluded from its parent's bundle.

`SkillCatalog.list()` parses `index.json` once per process. `SkillCatalog.bundle(name)` reads one zip and returns the file-and-base64 upload the account Remote already accepts. `catalogDir` points the service at another directory, which is how a derived catalog or a test fixture is served.

`catalog/sources.json` names the skills the collection does not carry: each entry names a directory in this repository holding that skill's `SKILL.md`, and states the category Settings groups it under. The sync packages each one the way it packages a vendored skill, records it in `index.json` and `MANIFEST.md`, and builds the bundle from the directory as it stands, so a skill written here reaches the next release by editing that directory and re-running the sync.

`catalog/vendored.json` covers the third origin: a skill another repository publishes in the same `SKILL.md` layout. Each entry names that repository, the skill directory inside it, its category, its credited author, and, for a skill whose own description is written in another language, the English summary the catalog row shows. The sync pins that repository's default-branch commit, bundles the directory the way it bundles a downloaded skill, records `<repo>/<path>` as the row's provenance, and adds the repository's `LICENSE` to the bundle when the skill carries none of its own. An entry ships under the same `curation.json` value bar as everything else, so widening or retiring a source stays one edit.

</details>

-----


<a id="model-experience"></a>
## Model Experience

None, as this package only reads a shipped catalog and hands one bundle to the account import path.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected until an installed skill reaches the catalog.


## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A snapshot, not a feed.** Upstream changes arrive by regenerating the catalog during a release, and the popularity numbers stay at their vendored values. A skill written here moves only when its directory changes and the sync runs again.
- **Upstream instructions are vendored unchanged.** Some reference Claude Code surfaces, or Python and Node tooling a deployment may not have; nothing rewrites them at install.
- **No invariant companion** — No invariant companion is published because the service reads one immutable file set and holds no second registry, so there is no independent observation to check.

-----


### Dev Note

<a id="dev-note"></a>

<details>
<summary>Working context for maintainers — click to expand</summary>

Regenerate with `pnpm exec tsx scripts/sync-skill-catalog.ts`; it needs network access and the `zip` command-line tool. The generated `catalog/` directory is data, not source: it is excluded from the Markdown documentation gates.

</details>
