---
description: "Personal Skills and Connectors pages in Settings."
kind: "package-reference"
---

# @aeven/client-ui-settings-integrations

English | [中文](README.zh.md)

## Summary

Settings contains separate Skills and Connectors pages for the signed-in user. Skills lists the account’s personal imports, installed skills, and skills from all owned folder workspaces, with source labels and instruction inspection. Skills outside connectors have a persistent account invocation switch. Connector skills appear only in their connector details, without individual switches; their instructions open in a scrollable popup with a close button and plain tables without copy or fullscreen controls. Compact searchable rows open a dedicated detail view with rendered Markdown instructions. Personal imports also support removal. Token connection forms focus their name field when opened so they become visible in the scrolling Settings pane. Configured provider sign-in is the primary action and opens consent in the system browser on Electron or a new tab on Web. The page retains a continuation link and refreshes account state when the user returns to the application or the host invalidates the skill catalog after a connection change. Earlier list responses cannot overwrite newer refreshes. Connector rows use branded icons and show connection and activation status. Each row opens a detail view with connection controls and its installed skills. Details omit the catalog heading; a circular Back control sits in the Settings header. Disabling a connection keeps its credentials. Connectors shows GitHub, Gmail, Google Drive, Google Calendar, Microsoft 365, and custom MCP connections with account-owned management actions.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The Web bundle includes both pages. Open Settings, then Skills or Connectors. Import a SKILL.md or bundle; open its instructions to inspect the content and resource list. Custom MCP connection forms accept a name, server URL, and optional write-only bearer token. GitHub can use its official MCP endpoint with a personal access token. Provider sign-in links appear only after the [host application configuration](../../host/account-integrations/README.md) is available; unconfigured providers explain the required setup.

## Understand the implementation

<details>
<summary>Implementation internals</summary>

The plugin contributes two settings.section entries with locale-owned English and Chinese copy. Browser callbacks use the accountIntegrations Remote; no account id or stored secret is accepted from the page. The skill library is account-wide and reads no conversation state. Preset and filesystem entries display an availability label; personal imports have an enablement switch. Page state reloads on open, after successful changes, and when the window regains focus. No invariant companion is published because this page renders the authoritative Remote snapshot without a second registry.

</details>

## Model Experience

None, as these pages only manage integrations through the host Remote.

## Known Limitations and Deferred Work

- Complete provider consent in the opened link, then return to Aeven to display the saved connection.
- Saved authorization status does not continuously monitor server reachability.

## Dev Note

The host package owns storage, credential handling, and conversation tool scoping.
