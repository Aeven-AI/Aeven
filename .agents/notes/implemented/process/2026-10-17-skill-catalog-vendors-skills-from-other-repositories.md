# Agent Note: The skill catalog vendors skills from other repositories

Status: implemented

English | [中文](2026-10-17-skill-catalog-vendors-skills-from-other-repositories.zh.md)

## Problem

The shipped catalog had two origins: the reviewed subset of `davila7/claude-code-templates`, and skills written in this repository that `catalog/sources.json` names by directory. A third party that publishes skills in the same `SKILL.md` layout therefore had no route in. The OpenDesign 0.25 release publishes ten motion-craft skills in exactly that layout — motion planning, a 160-case effect library, UI animation craft, animation review, GSAP, and media-driven web motion — and the catalog carries no motion skill at all. Copying them into `authored/` would present another repository's writing as this one's and lose the upstream commit the next review needs; leaving them out costs the catalog the only motion craft available to it.

## Decision

`packages/skill/skill-catalog/vendored.json` names every skill the catalog ships from another repository: the repository, the directory holding the skill's `SKILL.md`, the category Settings groups it under, the credited author, and, for a skill whose own description is written in another language, the English summary its row shows. `scripts/sync-skill-catalog.ts` pins each named repository's default-branch commit, downloads that skill directory, rewrites the frontmatter to the installed name, and bundles it the way it bundles a downloaded skill. The row's `path` reads `<repo>/<path>`, which is the source line Settings renders.

The reviewed value bar stays in one file. A vendored entry ships only when `curation.json` rates it at or above `minValue`; `vendored.json` states where a skill comes from, `curation.json` states whether it ships. An entry below the bar stays recorded in both files, so a rejected or pending source remains visible to the next review.

A bundle carries the licence it is redistributed under: a skill that ships its own `LICENSE` keeps it, and a skill whose only licence is its repository's gets that root `LICENSE` added to the bundle.

## What the bar left out

Two OpenDesign entries ship no instructions. `remotion` and `threejs` describe their upstream project and tell the reader to install it, so both are recorded at `low-value` and do not ship. `remotion` also names a skill the primary collection already claims, and an install never takes a name twice.

## Alternatives considered

**Vendor the whole OpenDesign collection.** Most of its 169 entries are that product's routes into other providers (Figma, fal, venice) or advertisement stubs, so the catalog would carry rows whose installs do nothing for an Aeven account. Ten reviewed motion skills are the part that adds capability here.

**Copy the ten skills into `authored/`.** `sources.json` exists for writing this repository authors. A copy would attribute another project's prose to this one, and every upstream correction would become a manual diff.

**Hard-code the second collection in the sync script.** A constant beside `UPSTREAM` puts where-skills-come-from into code, so adding or retiring a repository would need a script change and a fresh review of the script. The data file keeps that decision reviewable as data.

**Record the second repository in `index.json` and `CatalogSkill`.** Settings renders `path` as the source line, so `<repo>/<path>` already reads correctly, and a field no surface displays would add RPC schema for no behavior.

## Consequences

The catalog grows to 73 skills in 15 categories, `animation-motion` among them, with about 2.4 MB of additional bundles. Attribution now rests on each bundle's `SOURCES.md` and `LICENSE`, which the sync preserves rather than regenerates. Vendored prose written for another host keeps that host's wording where it names its own tooling, and the two Chinese-language skills carry an English catalog summary only, because translating their bodies is a review this change does not attempt.
