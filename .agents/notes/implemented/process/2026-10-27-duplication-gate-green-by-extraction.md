# Agent Note: The duplication gate went green by extraction, not by exception

Status: implemented

English | [中文](2026-10-27-duplication-gate-green-by-extraction.zh.md)

## Problem

`pnpm run duplication` reported 25 clones on `main`, so `check:all` could not pass for any change, and the `0.3.18-alpha` release was cut with that gate already red. The clones were not one problem: ten were the same helper body written twice — copied once and never deduplicated because each copy sat in a different package — while the rest were surfaces that a design deliberately keeps parallel, such as a second platform's provider and a second surface's dictionary.

## Decision

Ten clone pairs now share one owner; [the quality-gates note](2026-06-11-quality-gates.md) settled that this leaf exists, and this record settles what its red set was made of. Each extraction moved the differing part into a parameter and left the caller with its own data:

- `jsonStringOutput()` in `@aeven/tools` declares the `string` output that renders itself as text, which the terminal-controller and workspace-files tools each wrote out.
- `embeddedJsonObject()` in `@aeven/util-values` reads the first `{` to the last `}` and parses that run, the shape the tool-capability learner and the memory relevance filter both accept from a model.
- `mergeRankedHits()` in `@aeven/memory` merges score-ordered hit lists, which the memory tool and the memos recall path each implemented.
- `memosHome()` in the memos runtime names the account's memory home, which the plugin entry and the recall probe each built from the same three joins.
- `listedChoices()` in the media tool filters a seam listing to the settings surface's providers, and `catalogEntries()` in the OpenRouter provider fetches and unwraps a catalog payload; the image and video paths of each now differ only in what they call.
- `videoPlayerLabels(t)` in `@aeven/client-ui-primitives` reads the clip player's ten chrome sentences, which the camera dialog and the Imagine video view each spelled out.
- The memory settings `Commit` takes the draft and decides for itself whether Save is enabled, and `EditCommit` adds the edit-mode guard, so no call site restates the rule; `SessionOverflowToggle` in ui-workspace is the hidden-Session chevron button both the group and status-bucket rows render.

The other fifteen stay parallel and carry narrow `jscpd:ignore-start` / `jscpd:ignore-end` markers naming the owner they mirror: the account surface's two-factor sentences against `auth.aeven`'s, the model-capability glyphs in ui-settings-models against the subscription-auth models list, the Windows computer-use provider's command runner, seam facade and batch tool against the macOS provider's, and the pwsh tool and sandbox against their bash twins. The pwsh tool already carried markers for its parameter surface and execute path, so the new ones extend an established reading: a twin package owns its own copy of the shape, and the marker says which package it mirrors.

### Verification

- `pnpm run duplication` reports 0 clones in 1995 files, down from 25.
- `pnpm run typecheck` exits 0 for the host and client programs.

## Alternatives considered

**Mark all 25 as deliberate mirrors.** Ten of them were identical logic with no platform or surface reason to differ, and marking those would have kept two copies of one rule that the next change has to find twice.

**Extract the Windows provider's facade into a shared package.** The command runner, the seam facade and the batch tool are about 130 lines that differ only in the platform literal, the tool name and the words. Sharing them needs a package both providers import, which inverts the current packaging where a platform is a provider package with its own install row; that move belongs with a third platform, not with a gate cleanup.

**Leave the gate red until the next release.** `check:all` gates every change, so a red duplication leaf blocks unrelated work and hides a real new clone the day one appears.

## Consequences

A new clone now means a genuinely new clone rather than one more row in a standing list. The marked mirrors stay readable as exceptions: each names its twin, so a change to one side is visible as a change that owes the other side a look.
