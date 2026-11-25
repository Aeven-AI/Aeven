# Agent Note: The desktop app starts without plugins that fail to start

Status: implemented

English | [中文](2026-11-25-desktop-starts-without-failing-plugins.zh.md)

## Problem

`boot()` treats any entry that fails to apply or activate as fatal for the whole tree: the transactional Loader rolls the group back and the desktop Host exits, so the app does not open. A single plugin rejecting data another build stored (the connector schema on 2026-11-25) took the whole desktop app down.

## Decision

`app-boot` adds `bootTolerant()`. After a failed boot it reads the failed entries from the error (`failedEntries()`: the innermost `failed to apply loader entry <id>` on each cause chain, and the entries the activation audit now reports through `EntriesNotActivatedError`), disables them with `{ id, disabled: true }` patch rows, and boots again, up to `maxAttempts` boots, so dependents of a disabled entry are disabled in the next round. Group wrappers are not recorded, because disabling a group would switch off its healthy children.

The desktop Host boots with it. `connection`, `typert-gateway`, `modules`, `webserver`, and `desktop-http-frontend` are essential and stay fatal, as does the existing check for the connection, gateway, client-module, and web-server services. Each skipped entry is logged, carried in the `ready` event as `skippedPlugins`, and named in a non-blocking warning the shell shows.

CLI, headless, and hosted profiles keep `boot()`: there a missing plugin should fail the run or the deploy loudly.

## Alternatives considered

**Make the vendored Loader non-transactional.** It would change upstream Cordis semantics for every consumer and needs a logged vendor modification; the retry stays in owned code.

**Catch failures inside each plugin.** Every plugin would need its own guard, and a new plugin without one would bring the app down again.

## Consequences

A plugin that fails no longer stops the desktop app; the features it provides are absent until it starts cleanly, and the warning says which. Each retry is a full boot, so a failing start takes longer, bounded by five boots.
