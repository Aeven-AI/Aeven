# Agent Note: The skill catalog ships pstack as one installable pack

Status: implemented

English | [中文](2026-11-20-skill-catalog-ships-pstack-as-one-pack.zh.md)

## Problem

[pstack](https://github.com/backnotprop/pstack), Lauren Tan's (poteto) MIT-licensed set of Agent Skills, is a pack: `poteto-mode` routes to most of the other skills, and several skills load a sibling by name (`teach` runs `how` and `why`, `ketchup` speaks in `bro`'s voice). The catalog installed one bundle at a time, so a reader who installed `poteto-mode` alone got a router whose every route was missing.

Two facts about pstack itself made a plain vendor broken here. Every pstack skill sets `disable-model-invocation: true`, and the router reaches its leaves by file path (`../<name>/SKILL.md`). An account library stores each skill in its own revision directory, and the `skill` tool refuses a user-only skill, so neither route works after an install. The mirror also names surfaces this deployment lacks: the `poteto-agent` and `comment-sicko` subagent types, a per-harness model-settings file written by `/setup-pstack`, Cursor and Claude Code model slugs, Cursor's loop command, `cursor-team-kit`'s deslop and control skills, and other harnesses' transcript and skill directories.

## Decision

`vendored.json` names 27 pstack skills under the `pstack` category with `pack: "pstack"`. A new `repositories` map pins `backnotprop/pstack` at `4a4f41c4` and gives it a rewrite pass: `patches/backnotprop-pstack.patch`, applied to the pinned files before the catalog rebrand, and a `forbid` list of patterns no shipped Markdown file may still match. The sync fails when a hunk no longer applies or a forbidden name survives, so a refresh cannot ship a dead end silently. The same map pins `nexu-io/open-design` and `blader/humanizer` at the commits the catalog already ships, so this sync left their rows byte-identical.

The patch makes three kinds of change. It removes `disable-model-invocation` from the 20 skills another member loads, so the `skill` tool can load them; the 7 nothing routes to (`automate-me`, `blast-radius`, `correct`, `reflect`, `sharpen`, `statechart`, `teach`) stay user-only as upstream wrote them. It rewrites `poteto-mode`'s Subagents and Harness sections for this deployment: the `subagent` tool, `list_subagent_models` for per-role models, `session_search` for earlier chats, `ask_user_question`, `todo_write`, `schedule_create` for repeating checks, and `.avn/skills/` and `.agents/skills/` for skill folders. It replaces each scattered dead end in the playbooks and routed skills with a pointer to that Harness section.

The 24 one-line principles are folded into the `poteto-mode` bundle through a new per-entry `resources` map, at `principles/<title>.md`, instead of shipping 24 catalog rows. `omit` keeps `statechart`'s 3.7 MB test corpus out of its bundle.

The sync enforces pack closure: every pstack skill a member names in bold or as code must ship in the same pack, as a model-loadable member or folded into one. The names a member loads become its index row's `requires`, which Settings shows on the row and the skill page before a single install. `installCatalogPack()` installs every member through the same per-bundle import as a single install, continues past a refused member, and returns the installed, skipped, and failed names; the category page shows one switch for the pack and names any failed member.

## What the review left out

`setup-pstack` writes a model-settings file this deployment does not read, and `poteto-help` is a guide to installing and configuring pstack in Cursor; both would ship as wrong instructions. `recall` mines other harnesses' transcript directories, `make-bot-ui` drives another product's webhook bots, `ketchup-video` and the two formal-verification skills fall outside the issue's curated core, and the 24 principles live inside `poteto-mode`. The `agents/` prompts, the benny automations, and `.cursor-plugin/` stay out.

## Alternatives considered

**Ship all 58 skills as rows.** The 24 principles are one-line rules only the router reads; as rows they would add 24 descriptions to every catalog listing and to each installing account's model catalog.

**Keep every skill user-only.** The router and dependants would then be unable to load what they route to, which is the failure the pack exists to prevent.

**Prefix the names (`pstack-tdd`).** Prefixing would avoid any later collision with `avn-tdd` but rewrites nearly every cross-reference in the pack. No current catalog name collides, and the sync already refuses a duplicate name.

**Regex rules in the sync script instead of a patch.** The rewrites are sentence-level and differ per file; a patch is reviewable as a diff against the pinned source, and a failed hunk is the signal that a refresh needs review.

**Copy the rewritten skills into `authored/`.** That would lose the pinned provenance and turn every upstream fix into a manual port.

## Consequences

The catalog grows from 99 to 126 skills in 15 categories, with about 0.3 MB of new bundles. `poteto-mode`'s `watch-pr` helper still runs under Bun, which a session may not have; the Babysit playbook's `gh` commands remain the path without it. Refreshing pstack means bumping `ref`, regenerating the patch against the new commit, and re-running the sync, whose closure and forbid checks name anything the refresh broke.
