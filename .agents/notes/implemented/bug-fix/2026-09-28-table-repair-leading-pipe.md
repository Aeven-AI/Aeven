# Agent Note: Table repair requires a row's leading pipe

Status: implemented

English | [中文](2026-09-28-table-repair-leading-pipe.zh.md)

## Problem

GFM needs a delimiter row before a run of pipe lines is a table, and models write tables without one. The engine repaired that by rebuilding **any** run of two or more pipe-carrying lines as a table with a synthetic header and delimiter. A pipe is not evidence of a table: reasoning and answers carry shell pipelines in bullet lists (`` - `ls -R | head -50` ``), regex alternations (`` `\b(?:I|we)\s+` ``), TypeScript unions (`'redirect' | 'window'`), and `||` inside code snippets.

Two consecutive such lines were rewritten into a two-column table, in the settle pass and again while streaming. In one recorded session's reasoning the pair `` - `\b(?:I|we)\s+` … `` / `- Other branches: …` rendered as a table with a blank header. Across 80 stored sessions, 14 of 22 pipe-runs were prose rather than tables; every genuine headless table in that data opens each line with its own pipe.

The streaming detector had the same rule at the block level: two pipes anywhere in the buffer typed the whole block as a table, so a single prose sentence carrying two pipes was rendered as a one-row table, and a large delta carrying a table followed by prose folded that prose in as extra rows — the boundary for a table block was the buffer's *last* blank line, and the headless conversion then rebuilt the prose as rows.

## Decision

A line is a table row when, after up to three spaces of indentation and any blockquote markers, it opens with a pipe. `src/engine/table/rows.ts` owns that rule; `patterns.tableRowRegex` and `patterns.tableRowScanRegex` are the same row shape, one anchored to a line and one searching a text.

- The settle pass converts a run only when every line in it is a row (`findTableRuns`), so a bullet list, a regex alternation or a snippet stays prose.
- The streaming detector types a block as a table only when the block it would drain — the buffer up to its first blank line — is made of rows, and counts that head's pipes rather than the whole buffer's.
- `convertTable` leaves a buffer that is not made of rows untouched. A block typed as a table from its first row can still turn out to be prose, and rebuilding it would invent rows.
- A table block ends at its first blank line. A table cannot contain one, and taking the last instead absorbed the prose that followed a table in the same delta.
- A closed text block runs the same run repair as a whole-document render, so a headless table inside prose looks the same while it streams and after the transcript is rendered again from the log.
- `convertTableHeadless` puts the run's indentation on every line it emits, not only the first. An indented run inside a list item now stays a table instead of leaving its synthetic header and delimiter as literal text.

Rows without leading pipes are prose. `a | b` over `c | d` and a headless run indented under a list item are still recognised as the tables they are, and a table written with a delimiter row is unaffected: remark-gfm parses it without any repair.

## Alternatives considered

**Keep the pipe-count rule and require matching cell counts.** Two prose lines usually agree on their pipe count — the same bullet with a different pipeline, the same `||` in two statements — so the rule that produced the defect would survive it. The observed false positives differ from the observed true positives only in whether the line opens with a pipe.

**Repair only runs that sit at the top level.** Indentation is not the discriminator either: a table under a list item is legitimate, and prose is indented too.

**Split runs into maximal row sub-runs, so a table embedded in prose is still rebuilt.** Nothing in the stored sessions needs it — every prose run is prose throughout and every table run is rows throughout — and it would convert a mixed blob nobody verified. The strict reading is the one with evidence behind it.

**Type a buffer as a table from its first row alone.** A row followed by an ordinary sentence would then be rebuilt as a table for one frame and revert to prose when the block closed. Requiring the whole head keeps the frame and the settled render identical.

## Consequences

Prose that carries pipes renders as the text it is, in the transcript, in reasoning, and while the reply streams; the pipes stay visible rather than becoming columns. A headless table whose rows do not each open with a pipe is no longer rebuilt — it renders as literal pipes in a paragraph, which is what GFM does with it anyway. A single row line still renders as a table while streaming and as a paragraph once settled: `findTableRuns` requires two lines, and that limit is unchanged here.

`src/engine/table/**`, `src/engine/repair/tables.ts`, `src/engine/stream/detect-block-type.ts`, `src/engine/stream/find-block-boundary.ts` and the closed-text-block path in `src/engine/renderer.tsx` carry the decision. `tests/correctness/pipe-prose.client.spec.ts` pins prose verses tables in the settled render and at chunk sizes 1, 3 and 200; `tests/unit/table/rows.client.spec.ts` pins the row rule; `tests/unit/stream/block-detection.client.spec.ts` pins the block types.
