# Agent Note: The skill catalog ships caveman as one installable pack

Status: implemented

English | [中文](2026-11-26-skill-catalog-ships-caveman-as-one-pack.zh.md)

## Problem

[caveman](https://github.com/JuliusBrussee/caveman), Julius Brussee's Apache-2.0 skill set, makes the agent answer tersely while keeping every technical fact. Its `caveman` skill routes `/caveman ultra` and `/caveman wenyan` to two sibling skills, `ultracave` and `megacave`, so installing `caveman` alone leaves two routes pointing at skills the account does not have.

Three facts about the pinned skills block a plain vendor. `ultracave` and `megacave` set `disable-model-invocation: true`, and the `skill` tool refuses a user-only skill, so `caveman` cannot load them. All three name `/caveman-compress`, a repository skill that rewrites a memory file through a Python script calling its own model provider (the `claude` or `codex` CLI, the Anthropic API, or an OpenAI-compatible endpoint). Each skill directory also carries a README about installing and configuring caveman in Claude Code; the catalog rebrand would turn it into false claims about Aeven.

## Decision

`vendored.json` names `caveman`, `ultracave`, and `megacave` under the `caveman` category with `pack: "caveman"`, credited to Julius Brussee, each shipping only `SKILL.md` through `files`. The sync adds the repository's Apache-2.0 `LICENSE` to each bundle because the skill directories carry none. The `repositories` map pins `JuliusBrussee/caveman` at `e74a11cc` with `patches/juliusbrussee-caveman.patch`, and `forbid` refuses `Claude`, `.claude/`, `caveman-compress`, and `disable-model-invocation` in the shipped Markdown, so a refresh that reintroduces any of them fails the sync.

The patch removes the `/caveman-compress` exemption clause from all three skills and the `disable-model-invocation` line from `ultracave` and `megacave`. Both descriptions still say to invoke them only with their own command or the `caveman` alias, so the model loads them on an explicit request. The pack closure check then records `megacave` and `ultracave` as the `caveman` row's `requires`. `curation.json` rates all three `net-new` at value 4, the catalog's `minValue`.

## Alternatives considered

**Ship `caveman` alone.** Its two alias routes would name skills the account cannot load, the failure packs exist to prevent.

**Add `caveman-compress` to the pack.** Its script sends the file's text to a provider configured outside Aeven instead of the session's model, and the other three skills only reference it in an exemption clause.

**Keep the READMEs in the bundles.** They document Claude Code installation and hooks; rebranded, they would describe Aeven features that do not exist.

## Consequences

The catalog grows from 126 to 129 skills in 16 categories. The status-line hook the skills mention does not exist here; each skill's own fallback reports the mode as `(not tracked by this host)`. Refreshing caveman means bumping `ref`, regenerating the patch against the new commit, and re-running the sync.
