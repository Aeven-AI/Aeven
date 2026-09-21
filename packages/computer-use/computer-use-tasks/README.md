---
description: "Normalizes public desktop task sets (OSWorld, MacAgentBench, WindowsAgentArena) into one task-intent catalog."
kind: "package-reference"
---

# @aeven/computer-use-tasks

English | [中文](README.zh.md)

## Summary

Three public benchmarks describe desktop work in three different JSON shapes but agree on what matters: an instruction, the applications it concerns, how the environment is prepared, and what the result is checked against. This package reads all three into one record, so they can be used as a single source of intents.

**A benchmark task is an intent, not a recipe.** A recipe declares one parameterized operation and how to verify it; a benchmark task declares a goal, a prepared starting state, and an end-state check, and is reached through whatever UI sequence an agent invents. So the honest output here is a **catalog**: domains, instructions, and the semantic vocabulary the end-state checks reveal, from which recipes are curated by hand. Claiming a mechanical translation from instruction text to an operation would produce confident nonsense.

Reading the real sets produced **1,199 intents with zero parse failures**: 369 from OSWorld, 676 from MacAgentBench, 154 from WindowsAgentArena.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The sources are fetched rather than vendored — about 9 MB of JSON, and their licenses are not ours to redistribute. Sparse clones of the task directories are enough:

```bash
npx tsx packages/computer-use/computer-use-tasks/examples/catalog.ts \
  <osworld>/evaluation_examples/examples \
  <macagentbench>/tasks \
  <windowsagentarena>/src/win-arena-container/client/evaluation_examples_windows/examples \
  task-intent-catalog.md
```

Or from code:

```ts
import { readTaskSets, normalizeIntents, groupByApp } from '@aeven/computer-use-tasks'

const { intents, failures } = readTaskSets([
  { root: '/path/to/OSWorld/evaluation_examples/examples', source: 'osworld' },
  { root: '/path/to/MacAgentBench/tasks', source: 'macagentbench' },
])

for (const [app, tasks] of groupByApp(normalizeIntents(intents))) {
  console.log(app, tasks.length)
}
```

## Understand the implementation

### What each source contributes

| source | tasks | strongest contribution |
| --- | --- | --- |
| OSWorld | 369 | LibreOffice depth — 100 Calc, 66 Writer, 55 Impress tasks after normalization |
| MacAgentBench | 676 | macOS breadth across 25+ applications, with checks that name the semantic end state |
| WindowsAgentArena | 154 | Windows application coverage, in OSWorld's shape |

### A fourth source: semantic tool catalogs

`X-PLUG/OSWorld-MCP` publishes, per application, a list of validated semantic
operations in OpenAI function-calling shape — a name, a description, and a
parameter schema. That is a different kind of evidence from a task: a task says
what a *user wanted*, a tool says what an *application can be asked to do*, with the
argument names already decided. So it is read as its own source rather than folded
into the task records.

Measured on the published catalogs: **132 operations** across LibreOffice Calc (26),
Impress (21), Writer (15), Chrome (12), VLC (12), VS Code (20), and OS utilities.

A name-overlap heuristic that tried to report which operations a recipe book failed
to cover was written and then **removed**: it flagged `save` as uncovered because
the recipe is named `spreadsheet.saveAs`. A coverage report that invents gaps is
worse than none, so coverage is stated explicitly instead, in
`@aeven/computer-use-router`'s capability model.

### The end-state check vocabulary is the valuable part

A check named `calendar_check_weekly_event` states the semantic end state directly — an event with a given name, hour, and weekday — which is exactly the vocabulary a recipe's verification needs. So the catalog records every check name, and the set of them shows which end states these sources collectively know how to verify, and therefore which recipes could carry a real assertion rather than a file-exists stand-in.

Measured on the real sets, the checks that assert actual content are dominated by `compare_table` (85 tasks), `compare_pptx_files` (49), `find_str_in_list` (44), `compare_docx_files` (21), `calendar_check_weekly_event_advanced` (17), and `compare_pdfs` (14).

### Domains are normalized before grouping

The sources write the same application several ways — LibreOffice Calc appears as `libreoffice calc`, `libreoffice_calc`, and `libreoffice-calc` — and they carry harness artefacts in the same field: the largest raw "domain" is `terminal_no_reset`, 244 tasks whose snapshot sets a reset flag, not an application those tasks concern.

Left alone, both problems mislead in a specific way: the counts are what a reader uses to decide where to invest, so a split count understates an application and a harness artefact overstates one. Normalization runs before grouping, **265 harness-only intents are set aside explicitly**, and every rename is reported rather than applied silently.

### Nothing is dropped quietly

A JSON file that is not a task (no id and instruction pair) is *skipped*; a file that cannot be parsed is a *failure*, reported with its path and reason. A catalog that silently omitted what it could not read would understate the source, and the count is what a reader uses to judge whether the catalog is worth trusting. On the real sets: zero failures.

## Further Exploration

- [`@aeven/computer-use-router`](../computer-use-router/README.md) — the recipes curated from this catalog.
- [`@aeven/computer-use-benchmark`](../computer-use-benchmark/README.md) — step counts for the tasks that recipes cover.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **It produces a catalog, not recipes.** Mapping an instruction to an operation is curation. Only the check names are mechanical, and only some of them correspond to an operation we can perform.
- **Application names are not bundle ids.** Normalization canonicalizes spelling, not identity; mapping `pages` to `com.apple.Pages` is a separate decision.
- **The sources are fetched, not vendored**, so the numbers are reproducible by the runner but not present in the repository.
- **Two-thirds of the intents have no recipe and may never get one.** Many are Chrome, GIMP, VLC, or harness tasks outside this stack's current scope, and 265 concern no application at all.
- **Some checks are harness-internal.** `sleep`, `execute`, and `activate_window` appear as checks because sources reuse the evaluator array for setup; the catalog reports them, and a reader has to know they are not end-state assertions.
- **No deduplication across sources.** The same LibreOffice task may appear in more than one benchmark, so total counts are not distinct task counts.
- **Tool catalogs are capabilities, not tasks.** They say an operation exists and what it is called; they do not say a user asked for it, and they carry no end-state check.

<a id="dev-note"></a>
## Dev Note

The importer found a real disagreement between the sources on the first run: OSWorld writes the evaluator's `func` as a **string**, MacAgentBench writes it as an **array**. One adapter tolerant of both reads them identically, and a test pins it.

The most useful output is not the 1,199 figure but the two correction figures: 265 intents set aside as harness-only, and the renames that turn a split `libreoffice-calc` count of 22 + 11 + 67 into an honest 100. Both exist because a raw count would have been misleading in the direction that costs work — understating where to invest, and overstating where not to.

**Runtime invariant:** No companion is published because The package imports benchmark task sets and normalizes them into intents as pure functions, so it has no runtime sequence to compare and no mutable relation to maintain.
