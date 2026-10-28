# Agent Note: Settings draws every section from shared controls and groups the nav

Status: implemented

English | [中文](2026-10-28-settings-shared-controls-and-grouped-nav.zh.md)

## Problem

Settings had eleven nav entries, and each section drew its own rows, dropdown pills, switches, and tab strips. Only `SectionHeader` was shared. The section stylesheets carried 20 distinct border radii and 57 distinct paddings; six packages each drew a switch, seven drew the same selector pill, and three drew the same underline tabs. Boolean preferences used an On/Off dropdown in General and a switch in Account. Account's group headings matched the 16px page title, and Sync's title used weight 600. Voice was a whole page for one model row.

## Decision

`@aeven/client-ui-primitives` owns the settings controls: `SettingsGroup` and `SettingsRow` for layout and the type scale (page title 16/500, group title 14/500, row title 14/400, description 12/18 tertiary), `SettingsSelect` for a choice, `Switch` for a boolean, and `Tabs` with an `underline` variant for pages inside a section and a `pill` variant for sections that share a nav entry. Every settings section composes them, and section stylesheets keep only layout. No weight above 500 appears in the panel: a zero-specificity rule on the panel replaces the browser's bold defaults.

The nav has seven entries: Account, General, Connectors, Memory, Providers, Extensions, Personalization. The shell owns a table of grouped section ids, so Account holds Account and Sync, and Extensions holds Skills and Plugins; a grouped entry shows its members as pill tabs on the header line. Sections keep their ids, so `#!/settings/<section>` addresses still open the right tab. Appearance and Voice input are groups inside General, registered as `settings.general.item` entries, and Developer mode sits in a trailing Advanced group.

## Alternatives considered

- **A `group` option on every slot registration.** It would let each section name its group, but it widens the generic slot options for one consumer; the shell already owns the nav icon table by section id.
- **Five entries with Connections merging Providers and Connectors.** Connectors is what most readers set up first, so it stays a top-level entry.
- **Pill tabs inside each section.** Sections already draw underline tabs for their own pages; two underline strips stacked read as one level.

## Consequences

- A new setting composes the shared controls; a section stylesheet that draws its own switch, pill, or tabs repeats a solved control.
- A section stylesheet with an element-level `button` rule must exclude `[role='switch']` and `[role='tab']`, or it restyles the shared controls.
- Grouping a section is an edit to the shell's group table, not to the section's package.
