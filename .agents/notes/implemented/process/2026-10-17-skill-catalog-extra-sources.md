# Agent Note: The skill catalog vendors pinned skills from outside the upstream collection

Status: implemented

English | [中文](2026-10-17-skill-catalog-extra-sources.zh.md)

## Problem

The shipped catalog is one generated snapshot of `davila7/claude-code-templates`, so a skill worth shipping that lives in another repository had no path into Settings. Its only homes were a fork inside that collection, or an import into one account — and a single-account import offers the skill to nobody else. `aicodeking/leanrea` is such a skill: one 8 KB instruction file for reverse-engineering shipped software with plain CLI tools (Mach-O, ELF, PE, Go, Rust, .NET, Flutter, WASM, APK, SQLite, pcaps, firmware), which no shipped skill and no harness tool covers.

## Decision

`packages/skill/skill-catalog/sources.json` lists skills the collection does not carry. Each entry pins a repository, one commit, the directory holding that skill's `SKILL.md`, and the category Settings groups it under. `scripts/sync-skill-catalog.ts` reads the file beside `curation.json`, downloads each listed directory at its pinned commit, applies the same rebranding and frontmatter rename as upstream skills, and writes `catalog/bundles/<category>/<name>.zip`. `index.json` records every pin under `sources`, and `MANIFEST.md` prints one `Extra source:` line per entry.

One entry ships today: `leanrea`, from `aicodeking/leanrea` at `09ba4aa0217f82cd880f855a60b877f59f39b22b`, grouped under the new `reverse-engineering` category and reviewed `net-new` at value 5 in `curation.json`.

An extra skill installs exactly like a catalogued upstream skill: `SkillCatalog.bundle('leanrea')` reads its vendored zip, and the account import path validates the archive like any upload. Nothing about the Host, the Remote, or the Settings page changed.

## Alternatives considered

**Write the index entry and zip by hand.** The generated catalog is a release artifact, and the next sync deletes every bundle outside its own set: the addition would disappear at the following release, and until then the repository would carry data no script produces. The script had to learn the source, not the directory carry it.

**Fork leanrea into the upstream collection.** Curation is per-repository, so a fork of someone else's skill would need the same extra-source machinery to reach the catalog, plus an ongoing merge against a repository we do not own.

**Rely on the Settings import for whoever wants it.** That is one account at a time, and the point of the catalog is that a skill is offered to every account that opens Settings.

**Ship it as a preset skill instead.** `@aeven/agent-presets` already ships `in-app-browser` from `presets/aeven/skills/` into every session on the `aeven`, `standard`, `ptc`, and `cordis` presets. That route is always on rather than selectable: the skill would spend its description in every session's catalog message and its instructions on every session that loaded it, including sessions that never read a binary. A catalog skill reaches the accounts that install it, and the switch in Settings turns it back off.

**Generalize to arbitrary skill sources configured at runtime.** No consumer asks for that: the deployment ships one catalog read from disk, and a release-time pin list matches how the upstream commit and curation already work. The pin lives in data (`sources.json`), so adding or advancing a skill needs no code change.

## Consequences

Extra skills carry no popularity signal — `downloads: 0`, empty `author`, empty `keywords` — so they sort last in the catalog's default popularity order and are reached by category or search. `leanrea` is the only member of `reverse-engineering`, which reads as its own section in Settings.

Extra skills bypass `curation.json`'s `minValue` gate by construction: listing an entry is the review. The entry still carries a curation record so its value is stated for readers and the manifest's "reviewed but not vendored" count stays meaningful.

A pin that no longer resolves fails the sync loudly instead of dropping the skill, and a name colliding with a catalogued skill fails before any bundle is written. An extra source is one directory holding one `SKILL.md`; a repository contributing several skills lists each directory, and nested skill directories are not split out the way upstream's are.

Verification: regenerating with `--ref 8293bc3e6130e49391c1a3530cd73212f01aec83` (the commit the catalog already pinned) changed one index entry, one manifest line, one category row, and added `catalog/bundles/reverse-engineering/leanrea.zip`, whose `SKILL.md` is the upstream file with its `name:` frontmatter unchanged.
