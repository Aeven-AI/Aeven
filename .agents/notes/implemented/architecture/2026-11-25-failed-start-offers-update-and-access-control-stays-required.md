# Agent Note: A failed start offers the update, and access-control plugins stay required

Status: implemented

English | [中文](2026-11-25-failed-start-offers-update-and-access-control-stays-required.zh.md)

## Problem

The desktop shell scheduled its release check only after the Host reported ready, and the update surface is a page the Host serves. A build whose Host could not start therefore never checked for a release and had no way to offer one: on 2026-11-25 installed 0.3.66 builds that rejected a stored connector could be repaired only by a manual download.

`bootTolerant()` disables any entry that fails, except the `essential` ids its caller lists. The desktop list named only the entries the shell cannot be served without. Some entries restrict the tree instead of adding to it, and the tree grants more when one is absent: `access-policy` only denies tools that bypass the filesystem sandbox, and the API controllers read `identityUsers` with `?.mayAccess(...) ?? true`, so a missing identity service admits every request.

## Decision

The startup failure window creates its own `DesktopUpdateCoordinator` and runs `updateAfterFailedStart()`: one check, the state on a status line in the window, and a native dialog that asks once whether to restart into the downloaded release. On macOS the flow has Squirrel stage the bundle; the release's profile is installed by its first launch. The coordinator's `beforeRestart` removes the window's quit-on-close listener so the installer's own close does not exit the process first.

`app-boot` exports `ACCESS_CONTROL_ENTRIES` (`access-policy`, `identity-user`, `identity-user-aeven`), and `bootTolerant()` treats them as fatal for every caller in addition to `essential`. The rule for the list: an entry belongs when its absence lets the tree do more, not when its absence removes a capability. The sandbox, sandbox policy, and approval entries are not listed, because the shells and file tools wait for the sandbox services and a missing approval service turns `ask` into denial. A bundle test asserts each listed id is a row of the base or web-app bundle.

## Alternatives considered

**Start the periodic check before the Host starts.** The update surface would still be the Host's page, and the installer must not quit the shell while startup installs a profile; the failure window is the one state where neither applies.

**Disable the tools an absent policy guards.** Each policy would need a map of what it guards, and a new guard without one would be skipped silently; refusing to start is one rule, and the update offer above covers the stuck build.

**Mark required entries in `cordis.yml`.** Loader entry metadata other than `config` and `disabled` stays literal, so a flag there would need a Loader change in vendored code.

## Consequences

A build that cannot start reaches the next release without a manual download, provided the updater is enabled for it (packaged, not a Microsoft Store install, signed on macOS). A failure in an access-control entry stops the desktop app as it did before tolerant boot. A new plugin whose absence widens access must be added to `ACCESS_CONTROL_ENTRIES`; nothing detects that mechanically.
