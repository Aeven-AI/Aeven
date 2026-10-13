# Agent Note: Aeven web visual language

Status: implemented

English | [中文](2026-09-03-aeven-web-visual-language.zh.md)

## Problem

The web client used a visual baseline with blue-tinted navigation and message surfaces, compact 14px conversation text, several unrelated corner radii, a 920px adaptive reading cap, and an elevated composer. The Aeven client uses a warmer and quieter system: variable-weight typography, a `rgb(242, 242, 242)` canvas, white content surfaces, 30px primary corners, 40px controls, 24px desktop gutters, 16px mobile gutters, a 1024px reading column, and a flat composer. Copying those values into each CSS Module would make later tuning depend on another cross-package sweep.

## Decision

`packages/client/ui-theme/src/styles/aeven-language.css` is the final product-language layer after the generated platform and typography sheets. It owns the `--dsw-aeven-*` geometry and spacing variables and remaps existing semantic color and typography aliases to the Aeven values. Component CSS consumes those shared variables for chat width, page inset, spacing, control size, surface radius, content/control radius, and reading line height. The application entry self-hosts the Google Sans Flex and Google Sans Code variable-font files (SIL OFL, latin subset); the existing system stacks remain fallbacks. Typeface is the one place the web client departs from the reference client, which draws in Geist.

Conversation, sidebar, workspace rows, settings, and shared primitives adopt the centralized variables. The conversation column and composer both cap at 1024px, the user bubble and composer use white 30px surfaces, the composer has no border or elevation shadow, controls use the shared 40px/20px geometry, and Markdown uses the reference heading, paragraph, list, rule, inline-code, and code-block rhythm. The sidebar uses the reference 280px translucent panel, 20px top-right corner, full-width 40px rows, 24px desktop and 16px mobile row insets, 40px desktop bottom inset, flat hover and selected states, and 400ms easing. The 12–17px user font-size setting remains authoritative and shifts the Aeven type ladder through the existing delta variables.

The client retains its plugin layout, sidebar seats, view tabs, details panel, settings information architecture, dark preference, and feature action and status icons. The sidebar follows the reference interaction: its layout column collapses to zero width, all menu content disappears, and a 68×40px hamburger button remains at the upper-left; the expanded toggle adds the reference double-left chevron. Dark mode adapts the Aeven neutral hierarchy to dark surfaces through the same alias table; feature components still contain no theme selectors. Third-party themes continue to override semantic aliases after registration.

This decision supersedes only the visual-baseline values in the [web styling system note](2026-07-19-web-styling-system.md), the default width relationship in the [shared composer width note](../feature/2026-08-04-web-composer-shared-width-axis.md), the composer's elevation in the [elevation note](../feature/2026-09-01-web-elevation-stroke-shadows.md). Their framework, interaction, and browser-rendering rationale remains active.

## Alternatives considered

**Copy the reference CSS structure and component markup wholesale.** Rejected because it would replace B's plugin seats, sidebar, settings, interaction states, and icons instead of changing its visual language.

**Write the Aeven numbers directly in each component module.** Rejected because the same radius, control, width, and gutter decisions would have many owners. A final theme-owned variable layer gives those constants one edit point while modules keep local layout rules.

**Replace every B icon with the reference set.** Rejected because feature icon identity is part of B's product behavior. Only the sidebar open/close control uses the reference hamburger and double-left chevron required by the menu interaction.

**Drop dark mode because the reference is light-only.** Rejected because B already exposes a durable theme preference. A neutral dark mapping preserves that capability without changing the light reference target.

## Consequences

The light client follows the Aeven visual hierarchy while remaining recognizable and operational as the harness. Geometry can be retuned from `aeven-language.css`; components no longer need coordinated literal edits for the shared constants. Closing the sidebar gives the conversation the full viewport width and leaves no icon rail; users reopen it from the overlaid hamburger. The added font assets increase the application payload by about 53KB before compression. User-selected font sizes and dragged conversation widths can still move away from the baseline. Some dense tool and status rows keep their compact local geometry because widening every operational row would reduce transcript scanability and change established interaction footprints.
