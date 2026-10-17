# Agent Note: Settings lists skills in title order

Status: implemented

English | [中文](2026-10-17-skills-listed-in-title-order.zh.md)

## Problem

The Skills page ordered the catalog by upstream install count, and left the account's own library in whatever order the Host reported it. Install count is a popularity signal from a repository the catalog vendors, and the page's job is a different one: a reader looks for a skill by name, or scans a category to see what exists. Popularity ordering buries exactly the entries that need finding — every skill this repository writes arrives with `downloads: 0` and sorts last, so a new first-party skill sat at the bottom of its own category while a 9,000-install third-party skill it competes with sat at the top. The library list had no order at all, so imports appeared in arrival order and stayed there.

## Decision

`IntegrationsSection` sorts every skills list by title, through one comparator over the name the row shows: the catalog's `displayName` where the entry has one, the install name otherwise, compared case- and accent-insensitively.

The library list, the catalog's single list and each catalog category all go through it. The Display menu keeps two layouts — one list of every skill, or grouped by category — and both read in title order, so the option now chooses grouping rather than ranking; its first label reads `All` instead of `Popularity`. The install count stays visible beside each catalog row as text, since it is still a signal a reader may want, just not the one that decides position.

## Alternatives considered

**Keep popularity order and add a sort control.** A three-way sort menu over a list a person reads once trades a real cost — another piece of state, another label to translate, another test — for a choice almost nobody makes. Title order needs no control and is the order the reader's own search already assumes.

**Sort the catalog by title but keep the library by arrival.** The two halves of one page then answer to different orders, and a skill installed from the catalog reappears somewhere else in the library list. One rule for both is what makes the switch feel like it moved a skill into the same list rather than into a different one.

**Sort by category name, then title, in the single list.** Grouping already exists as the second layout, and a reader who wants it can pick it. Ordering the single list by category first hides the alphabetical run a reader scans for.

## Consequences

A skill written here is findable by name on the day it ships, which is the property the catalog needed for `reverse-engineering`: the category holds one entry, and the list no longer implies that an uninstalled popularity figure ranks two skills against each other.

Popularity left the ordering but stayed in the data: `downloads` remains on every catalog entry, still shown as installs on each row, and the catalog package's own documentation no longer claims Settings orders by it. A deployment that wants a ranked view has the count to build one from, and the index still carries it.

The Skills page's copy changed with the behavior: the catalog intro no longer describes repositories pinned alongside the upstream collection, and the display option is labelled `All`.
