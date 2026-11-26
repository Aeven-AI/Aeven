# Agent Note: Conversation narrows to phone width beside the right sidebar

Status: implemented

English | [中文](2026-11-26-conversation-narrows-to-phone-width-beside-right-sidebar.zh.md)

## Problem

The right sidebar ([`@aeven/client-ui-sidebar-right`](../../../../packages/client/ui-sidebar-right/README.md)) laid itself over the conversation whenever the conversation beside it would drop under 640px (`CENTER_MIN`), and its drag stopped at 70% of the window. On a 1280px window with the left sidebar open, a 600px panel already covered the conversation, so the reader could not keep the conversation readable beside a wide panel. Pages that count cards per row, Inspiration and Bots, took their breakpoints from the window, so a narrowed conversation kept the desktop rows.

## Decision

- **Phone-width floor.** `RIGHTBAR_CONVERSATION_MIN` (375px) in `columns.ts` replaces both the 640px overlay floor and the 70% ceiling. The panel takes a column while its floor leaves the conversation 375px, and its drag stops where the conversation reaches 375px. `AppFrame` subtracts the left sidebar and details columns from that ceiling, reading the left sidebar's painted width from the `--dsw-aeven-sidebar-width` token, because ui-sidebar paints at the token rather than at the stored preference.
- **Page-owned breakpoints.** Inspiration and Bots measure their own content width with `useNarrowerThan` (moved from `TurnRail.tsx` to `@aeven/client-ui-primitives`) and mark `data-cards` or `data-phone`. Each threshold is the old window breakpoint less the page inset per side, so a full-width page breaks where it did before.
- **Side spacing.** The narrowed conversation keeps the 24px page inset; only a phone window uses 16px.

## Alternatives considered

**CSS container queries** were rejected: they need Safari 16.0, below the client's iOS/Safari 14.5 baseline, and `verify-css-baseline` refuses them. A container on the conversation column was already rejected for its style-recalculation cost during sidebar slides (`ConversationRoot.module.css`). **A frame-level width attribute** would need every page to restate its breakpoints against one shared value; the pages own different thresholds.

## Consequences

The transcript's own phone rules, such as the hypermarkdown table and code-block rules, still follow the window, so a 375px conversation beside the panel keeps their desktop forms. `CENTER_MIN` now serves only `computeColumns`, which no production code calls.
