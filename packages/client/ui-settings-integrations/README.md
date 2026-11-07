---
description: "Personal Skills and Connectors pages in Settings."
kind: "package-reference"
---

# @aeven/client-ui-settings-integrations

English | [中文](README.zh.md)

## Summary

Settings contains separate Skills and Connectors pages for the signed-in user. Skills lists the account’s own skills — imported bundles and installed skills — with instruction inspection. Skills use the same layout as Connectors: a search field beside Import, then rows with name, description, and one switch for account invocation. Import opens the page’s own card chrome, a scrolling body whose edges fade and whose scrollbar stays hidden, holding a GitHub URL, npm package, or dependency name above the skills Claude Code and Codex installed on this computer, grouped per agent and sorted by name; one switch per agent skill copies it into the library or deletes that copy. Each row opens a page addressed as `#!/settings/skills/<skill id>` with the switch, rendered instructions, bundle files, and Remove; the circular Back control in the Settings header returns to the list. Skill and connector pages render no text above 16px and no weight above 500, rendered instructions included. Connector skills appear only in their connector details, without individual switches; their instructions open in a scrollable popup with a close button and plain tables without copy or fullscreen controls. Token connection forms focus their name field when opened so they become visible in the scrolling Settings pane. Configured provider sign-in is the primary action and opens consent in the system browser on Electron or a new tab on Web. The page retains a continuation link and refreshes account state when the user returns to the application or the host invalidates the skill catalog after a connection change. Earlier list responses cannot overwrite newer refreshes. Each connector row shows its brand mark in a round black badge and one switch, which is on while a signed-in connection is available in conversations. Turning it on starts sign-in, or opens the token form for GitHub without configured sign-in and for custom MCP; turning it off disconnects and deletes the stored credentials, so there is no paused state. A connection disabled before this rule turns back on without a new sign-in. Each row opens a detail page addressed as `#!/settings/connectors/<provider>`, so it can be linked and browser Back returns to the list. The page holds the same switch, the token form, and the connector's skills; custom MCP lists each server with a Remove action. Details omit the catalog heading; a circular Back control sits in the Settings header. Connectors shows GitHub, Gmail, Google Drive, Google Calendar, Outlook, Outlook Calendar, OneDrive, SharePoint, Teams, email accounts, WhatsApp numbers, Telegram accounts, Discord servers, Slack workspaces, and custom MCP connections with account-owned management actions. Email, WhatsApp, Telegram, and Discord each keep one connection per account, number, signed-in account, or Discord guild, so their pages list those rows with a switch and a remove action, and a button that adds another: an account form, a QR code, a sign-in, or Discord's install screen. WhatsApp's linking card also offers a phone-number code, which it opens first on a touch screen, because a phone cannot scan a QR code shown on its own screen. Its number field sits beside a country-code box that starts at the browser language's country; a number typed with `+` or `00` moves its code into the box, and a national trunk `0` is dropped. The code shows and copies as its eight capitals; when WhatsApp replaces it after a mismatched entry the card shows the new one with a notice, and WhatsApp's rate limit gets its own message. Slack keeps one connection per workspace and uses the ordinary provider page: its switch signs a workspace in, or disconnects every connected workspace of that provider. In a conversation, a call to a linked WhatsApp number's `list_messages` or `get_message_context` draws as one card per chat, outside the folded process group: chat bubbles by day, the reader's own on the right, with photos and stickers, GIFs that loop silently, videos that play muted as they come into view, photos and videos fading in once loaded, documents that download under their own name, and voice notes with a play button and a waveform that fills as they play and seeks where pressed.

Microsoft rows show the verified account address. A consent requiring administrator approval shows a distinct message and application-specific approval link; an ordinary failed consent or expired grant offers another sign-in. SharePoint and Teams require work accounts.

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

The plugin contributes two settings.section entries with locale-owned English and Chinese copy. Browser callbacks use the accountIntegrations Remote; no account id or stored secret is accepted from the page. The skill library is account-wide and reads no conversation state. Every listed skill is account-owned and carries an enablement switch. Page state reloads on open, after successful changes, and when the window regains focus. No invariant companion is published because this page renders the authoritative Remote snapshot without a second registry. The WhatsApp card reads the messages from the call's durable `tool/result` meta (`structuredContent.messages`, which the MCP bridge records) and registers under the account-independent tool view key `mcp__whatsapp__<tool>`. It loads each photo, sticker, GIF, and voice note when it nears the viewport, through `accountIntegrations.whatsAppMessageMedia`, which answers only for the acting user's own number; the bytes become object URLs that live until the plugin is disposed. A `connector-cards` Turn index names the card calls so the chat keeps them visible like image calls.

</details>

## Model Experience

None, as these pages only manage integrations through the host Remote, and the WhatsApp card draws from the result meta the model never reads.

#### KV Cache effect

None; no prompt input originates here.

## Known Limitations and Deferred Work

- Complete provider consent in the opened link, then return to Aeven to display the saved connection.
- Saved authorization status does not continuously monitor server reachability.

### Dev Note

The host package owns storage, credential handling, and conversation tool scoping.
