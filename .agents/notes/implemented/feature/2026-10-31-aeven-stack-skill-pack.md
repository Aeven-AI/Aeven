# Agent Note: The aeven-stack skill pack ships in the catalog

Status: implemented

English | [中文](2026-10-31-aeven-stack-skill-pack.zh.md)

## Problem

The catalog carried no general working-method skills: it shipped domain skills (design, security, motion, document processing) and two authored reverse-engineering skills, so a session that needed a plan-verify-review discipline had nothing to install. A third-party pack, `aicodeking/deepseek-stack`, already covers exactly that gap with 29 skills, each one loop with a stop condition and a demand for evidence. It is written for another model vendor: its `ds-` names, its model claims, its help skill's routing table, and its references to that vendor's directories all name things Aeven does not have.

## Decision

**The pack ships as 29 authored sources under one category.** Every skill lives at `packages/skill/skill-catalog/authored/<name>/SKILL.md` and is listed in `catalog/sources.json` under category `aeven-stack`, so Settings shows one row for the pack instead of 29 scattered rows. The port keeps the upstream loops, stop conditions, and rules as written; only the identity and the harness facts changed. The `sources.json` mechanism itself is owned by [the extra-sources note](../process/2026-10-17-skill-catalog-extra-sources.md), and the same maintenance path as [the authored reverse-engineering skill](2026-10-17-authored-reverse-engineering-skill.md).

**Naming is `avn-` for the skills and `aeven-stack` for the pack's entry skill.** `ds-adopt` installs as `avn-adopt`, and so on for all 28, which follows the repository's existing `avn-` prefix for skill names. The pack's routing skill, upstream `ds-help` — the one that answers "which of these fits my task" — installs as `aeven-stack`, so the pack has one entry point named after itself. No `avn-` name collides with a repository skill under `.agents/skills/` or with a vendored catalog name.

**The port rewrites every fact about the other vendor.** `ds-` cross-references became `avn-`, `<vendor> is cheap enough` became a statement about the artifact rather than the model, "the harness's question tool" became Aeven's question tool, and the places that offered "a second CLI, such as Codex or Claude" now name an `avn` profile run, a subagent with a model setting, or another provider's CLI. Model claims were removed rather than replaced with an Aeven model name, because these skills reason about cost and reviewers, not about a specific model's behaviour.

**The upstream MIT notice travels with every ported skill.** `scripts/sync-skill-catalog.ts` adds a repository `LICENSE` to a vendored bundle but not to an authored one, so each of the 29 directories carries the upstream `LICENSE` beside its `SKILL.md` and every bundle redistributes the notice it is obligated to.

## Verification

`pnpm exec tsx scripts/sync-skill-catalog.ts --ref 8293bc3e6130e49391c1a3530cd73212f01aec83` regenerated `catalog/index.json`, `catalog/MANIFEST.md`, and one zip per skill: 99 skills in 14 categories, with `aeven-stack` holding 29. Each of the 29 bundles was unzipped and its frontmatter `name:` compared with the file name: all match, and `avn-watch-pr.zip` carries its `scripts/watch_pr.py` as well. `grep -rniE "ds-[a-z]|deepseek|/ds-"` over the authored `aeven-stack` directories returns nothing.

## Alternatives considered

**Register the pack through `catalog/vendored.json`.** Rejected: that path downloads a repository's files as it finds them, which would ship `ds-` names the skill registry accepts but the repository does not use, and would credit a provenance path rather than ship the rewritten text this repository maintains.

**Keep the `ds-` names so an upstream update maps one to one.** Rejected: the prefix is the one thing a reader sees in the catalog list, and the pack's own routing table would then mix two vocabularies in the same paragraph.

**One category per area (planning, review, shipping).** Rejected: the pack is installed and reasoned about as a whole, and splitting it would scatter the routing skill from the skills it routes to.

**Leave the pack's help skill as `avn-help`.** Rejected: `aeven-stack` names the entry point the way a reader looks for the pack, and no other catalog skill uses the repository's own product name.

## Consequences

- Widening or retiring the pack stays a `sources.json` edit plus a re-run of the sync; adding a skill to it means an `authored/<name>/` directory, a `sources.json` row, and a row in the `aeven-stack` routing table.
- The port is a copy, not a vendored source: an upstream improvement does not arrive with a sync run, and arrives only when someone reads the upstream file and ports the change.
- The skills name Aeven mechanics that exist today (subagents, the workflow tool, the question tool, background jobs). A change to any of those surfaces leaves the matching skill stale.
