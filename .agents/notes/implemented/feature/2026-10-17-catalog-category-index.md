# Agent Note: The catalog groups by category through an index

Status: implemented

English | [中文](2026-10-17-catalog-category-index.zh.md)

## Problem

The catalog ships seventy-four skills. One alphabetical list makes a reader scan every row to find the domain they want, and the earlier category display stacked all fifteen groups into the same scroll, so the counts that answer "where is the interesting material" sat between the rows instead of in front of them.

## Decision

The Display menu keeps two choices, `By category` and `All`, and the catalog opens on `By category`. `All` is the alphabetical list. `By category` renders an index: one row per category with its name and how many skills it holds, and opening a row shows that category's skills in title order with a back control that returns to the index. A search query overrides the grouping and lists the matching skills across every category, because a reader typing a name is not browsing a domain.

Counts come from the skills the catalog carries, not from the index's own `categories` array, so a count cannot drift from the rows it describes.

## Alternatives considered

**Keep the stacked sections.** Sections with sticky headers show everything at once, but fifteen headers interleaved with rows make the page longer than the catalog and put the counts inside the scroll rather than in front of it.

**Trust `categories` for the counts.** The index records counts at sync time; deriving them from `skills` keeps one source of truth and needs no second read of a field that can disagree with the rows.

**Push grouping into the search field syntax.** A `category:` prefix would keep one list and one control, at the cost of teaching syntax for a two-level choice the Display menu already carries.

## Consequences

Two clicks reach any skill by domain, and one click reaches the index from a category. The index is what the catalog opens on, so a reader who wants a specific name uses `All` or the search field.
