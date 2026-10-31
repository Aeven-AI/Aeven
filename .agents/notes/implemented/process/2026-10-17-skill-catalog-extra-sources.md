# Agent Note: The skill catalog ships skills the upstream collection does not carry

Status: implemented

English | [中文](2026-10-17-skill-catalog-extra-sources.zh.md)

## Problem

The shipped catalog is one generated snapshot of `davila7/claude-code-templates`, so a skill worth shipping that lives in neither that collection nor this repository had no path into Settings. Its only homes were a fork inside that collection, or an import into one account — and a single-account import offers the skill to nobody else, while a fork of someone else's text puts a copyright notice inside a model-visible file.

## Decision

`packages/skill/skill-catalog/sources.json` lists skills the collection does not carry. Each entry names a directory in this repository holding that skill's `SKILL.md`, relative to the repository root, and states the category Settings groups it under. `scripts/sync-skill-catalog.ts` reads the file beside `curation.json`, stages each directory through the same rebranding rewrite and frontmatter rename a vendored skill gets, and writes `catalog/bundles/<category>/<name>.zip`. `index.json` records each one under `sources` with its directory as the entry's `path`, and `MANIFEST.md` prints one `Authored source:` line per entry.

Thirty-one entries ship today: `reverse-engineering` and `leanrea` under the `reverse-engineering` category, and the 29 `aeven-stack` workflow skills under `aeven-stack`. [The skill note](../feature/2026-10-17-authored-reverse-engineering-skill.md) owns what the first one says, and [the pack note](../feature/2026-10-31-aeven-stack-skill-pack.md) owns the last 29.

An authored skill installs exactly like a catalogued upstream skill: `SkillCatalog.bundle('reverse-engineering')` reads its vendored zip, and the account import path validates the archive like any upload. Nothing about the Host, the Remote, or the Settings page changed, and the install is what makes the skill removable again from Settings.

## Alternatives considered

**Write the index entry and zip by hand.** The generated catalog is a release artifact, and the next sync deletes every bundle outside its own set: the addition would disappear at the following release, and until then the repository would carry data no script produces. The script had to learn the source, not the directory carry it.

**Pin the skill from a repository outside this one.** An earlier form of this path downloaded third-party skills at a pinned commit. Every edit then needs a merge against a repository we do not own, and the redistributed text keeps its author's copyright notice inside a file the model reads. No skill the collection lacks needs that today: the one that did is now written here. A third-party skill that earns a place later brings the pinned form back with its notice.

**Ship it as a preset skill instead.** `@aeven/agent-presets` already ships `in-app-browser` from `presets/aeven/skills/` into every session on the `aeven` preset. That route is always on rather than selectable: the skill would spend its description in every session's catalog message and its instructions on every session that loaded it, including sessions that never read a binary. A catalog skill reaches the accounts that install it, and the switch in Settings turns it back off.

**Rely on the Settings import for whoever wants it.** That is one account at a time, and the point of the catalog is that a skill is offered to every account that opens Settings.

**Generalize to arbitrary skill sources configured at runtime.** No consumer asks for that: the deployment ships one catalog read from disk, and a release-time list matches how the upstream commit and curation already work. The source lives in data (`sources.json`), so adding a skill needs no code change.

## Consequences

Authored skills carry no popularity signal — `downloads: 0`, empty `author`, empty `keywords` — so they sort last in the catalog's default popularity order and are reached by category or search. The `reverse-engineering` and `aeven-stack` categories hold only authored skills, so each reads as its own section in Settings.

Authored skills bypass `curation.json`'s `minValue` gate by construction: listing an entry is the review. The entry still carries a curation record so its value is stated for readers and the manifest's "reviewed but not vendored" count stays meaningful.

A directory without a `SKILL.md` fails the sync loudly instead of dropping the skill, and a name colliding with a catalogued skill fails before any bundle is written. One entry is one directory holding one `SKILL.md`; nested skill directories are not split out the way upstream's are.

Verification: regenerating with `--ref 8293bc3e6130e49391c1a3530cd73212f01aec83` (the commit the catalog already pinned) changed one index entry, one manifest line, one category row, wrote `catalog/bundles/reverse-engineering/reverse-engineering.zip` from the authored directory, and removed the bundle it replaces.
