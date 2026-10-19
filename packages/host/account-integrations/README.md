---
description: "Personal skill bundles and account-owned remote MCP connections."
kind: "package-reference"
---

# @aeven/host-account-integrations

English | [中文](README.zh.md)

## Summary

Signed-in users can import, inspect, enable, and remove their own skills, connect remote MCP servers, link WhatsApp numbers, sign in Telegram accounts, add Discord servers, and connect Slack workspaces. Every management operation derives its owner from the authenticated request. Skills and connector credentials persist across restarts; conversations receive only their owner's integrations.

Connector write approvals offer a session grant for the same account and tool operation. Google Workspace raw calls additionally scope the grant to the service and resource-method path. Account ownership, connection, and enablement checks run before every approval request.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The Web bundle mounts this plugin with the [Skills and Connectors pages](../../client/ui-settings-integrations/README.md). Settings lists the account’s own skills: imported bundles and installed skills. Discovered skills — a repository, the deployment’s preset, and every owned folder workspace — are not listed, because they are always available and carry no account-level switch; a skill a connector owns appears only in that connector’s details. Listing is independent of open conversations, and a disabled skill remains visible. Each listed skill has one persistent account-level invocation switch, and removing it deletes the stored bundle. The preference applies to that skill name and restricts both model and user invocation without changing files or expanding workspace access. Import one `SKILL.md`, `.skill`, or ZIP bundle with exactly one skill definition. Resource paths must stay within its directory; duplicate paths, malformed frontmatter, and oversized bundles are rejected. Imports use the existing skill provider registry and invocation controls.

When an account enables the installed `reverse-engineering` skill, its first conversation request starts downloading REA, Ghidra, and a compatible JDK into `$AVN_HOME/runtimes/reverse-engineering` in the background. No request waits for that download: the REA tools are connected for later requests of that agent once the archive checksums and Ghidra readiness are verified, and every request stays usable meanwhile. A failed setup is logged and retried only after `retryDelayMs`, never as a request failure. Later requests reuse the installation; importing or enabling the skill alone downloads nothing. The `reverseEngineering` configuration selects versions, budgets, and the retry delay. Downloads require network access. Specialized engines beyond Ghidra remain separate prerequisites.

Custom connections accept Streamable HTTP MCP endpoints and optional bearer tokens; GitHub also accepts a personal access token for its official remote endpoint. Connection creation verifies MCP discovery before saving. Tokens are write-only and stored through the credential provider under an account-derived key. Disablement and disconnection deny subsequent calls even when a conversation still holds an older tool catalog.

Gmail, Google Drive, and Google Calendar use the maintained Google Workspace MCP bridge with service-specific Google OAuth scopes. The OAuth application, its scopes, and every grant live on the Aeven API named by `apiUrl`; the Host holds no client secret or refresh token. Consent verifies API access before saving. Drive includes Docs, Sheets, Slides, Forms, and comments. Enable the Drive, Docs, Sheets, Slides, and Forms APIs for those skills; comments use the Drive API. Forms reuses the existing Drive consent scopes. Form creation and question edits follow ordinary document-edit permission handling; other raw Google writes retain the explicit approval gate. The discovered MCP tools determine available operations; skill instructions do not add tools.

Connector details list installed skill definitions from the existing registry: Drive owns its six Google document and file skills; Gmail, Calendar, and GitHub each own their corresponding skill. Connector skills appear once by name only in connector details and require an enabled, authorized connection. Individual skill preferences do not control connector skills. Management keeps instructions visible when invocation is disabled. Disabling or disconnecting invalidates skill discovery and removes mounted tools; the executor also rejects stale calls. Disconnect cancels pending consent and waits for any in-flight callback before deleting the connection and credential.

Google, Microsoft, and GitHub sign in through the Aeven API's connector broker, authenticated with the signed-in user's own Aeven session. The API starts the consent with account-bound, expiring state and PKCE, receives the provider's redirect, spends the code with the application's secret, and stores the grant encrypted; its callback page tells the user to close the window and return to Aeven, naming a failed step without provider responses. When Settings is read again after the reader returns, the Host fetches an access token, verifies access to the selected API or MCP resource, and saves the connector, or removes the grant when verification fails. Before conversation steps the Host asks the API for a current access token, which the API refreshes; a grant the provider revoked marks the connector for reconnection. Microsoft 365 has no application on the Aeven API and is reported as not configured.

WhatsApp and Telegram hold one connector row per account, and each row owns one supervised daemon process bound to a loopback port the operating system chooses. The Host starts and restarts that process with backoff, holds its standard input open so a crashed Host leaves no process holding a session, and mounts its tools at `mcp__<provider>_<connector-id-prefix>__<tool>`. Every connector is mounted before each conversation step; one that cannot connect is logged and left out of that step, and the next step tries it again, so a broken account never ends a turn. Settings links a WhatsApp number by scanning a QR code, and signs in a Telegram account by typing its phone number, the code Telegram sends, and the account's 2FA password when Telegram asks for one. A WhatsApp number is saved once the phone scans the code; a Telegram account is saved once Telegram authorizes it, and an account already signed in is rejected instead of added twice. Unlinking ends the session at the provider and deletes the connector's data directory. Each account keeps its own process and namespace, so a conversation can reach several accounts without mixing them.

The Telegram daemon is the vendored [`bstuff/telegram-mcp`](../../../native/telegram-mcp/README.md) server under an Aeven entry that adds the loopback MCP endpoint and the sign-in control routes. The deployment's registered Telegram application identifiers come from the Aeven API with a signed-in user's session and are cached in the credential provider, so accounts already linked start at boot; the Host passes them only to the daemon's environment, so they never reach a tool schema, a model request, or a browser response. Every MTProto client presents these identifiers, so they identify the application and grant no account. Each account's session string, cached identity, and downloads stay in that account's own directory. A user signs in by scanning a QR code with the Telegram app or with a phone number and code, and Telegram then asks for the 2FA password when the account has one. A Telegram account keeps one connector id for each user, derived from the user and the Telegram user id: signing in a signed-out account again restores it in place, and signing it in again after unlinking it gets the same id, so its tool names stay stable for conversations that already use them. Signing in an account that is already signed in is refused as a duplicate.

Discord holds one connector row per guild. Every row is backed by the same Aeven Discord application and its bot, and the guild id is what separates them: tools mount per row as `mcp__<provider>_<connector-id-prefix>__<tool>`, each guild runs in its own stdio child process that takes no guild argument, and each row is enabled, disabled, and removed on its own. Adding a server opens Discord's bot authorization screen from Settings; the callback spends the code, confirms the bot is a member, reads the guild name, icon, and installer, and stores the row. Installing into a guild the account already connected refreshes that row instead of duplicating it, the connector id is derived from the account and the guild id so tool names survive reinstalling, and `maxDiscordGuilds` bounds the guilds one account may connect. Removing a server takes the Aeven bot out of the guild where Discord allows it, then deletes the row; a guild row owns no credential record of its own.

The Discord child process is the [native/discord-mcp](../../../native/discord-mcp/README.md) server: a curated surface of thirteen tools for reading channels, messages, threads, members, and server information and for posting, replying, reacting, uploading a file, and opening a thread, with administration and moderation — kick, ban, bulk-ban, timeout, message deletion and purging, roles, channels and permissions, invites, the audit log, AutoMod, and server settings — served only while `discordAdminTools` is on. The Aeven Discord application's client secret and bot token live on the Aeven API. The install consent goes through the API's connector broker, which confirms the bot joined the guild; the child process sends every Discord call to the API's Discord proxy with the owner's Aeven session, and the proxy acts as the bot only for paths inside a guild that owner installed it into. The child restarts with the new session when the owner's session rotates. Removing a server takes the bot out of the guild only once no other Aeven user still has it installed there. The install link requests the permission bitfield of the served surface, `discordPermissions` replaces it, and Discord reserves server-wide text search for user accounts, so `search_messages` walks messages under a scan budget and reports what it covered.

Slack holds one connector row per workspace and, unlike the brokered providers, needs no application on the Aeven API: Slack's PKCE client is a public client, so the login runs on this Host and the only Slack value a deployment configures is the application's public client id. `authorize('slack')` binds the configured loopback port, returns the consent URL for Settings to open, and completes the login when the browser returns with a code: the exchange sends `code_verifier` and no client secret, and Slack's own token test names the workspace and the account the row records. The connector id is derived from the account and the team id so tool names survive reconnecting, `maxSlackWorkspaces` bounds the rows, and the row mounts [Slack's MCP server](https://docs.slack.dev/ai/slack-mcp-server/) over Streamable HTTP with the stored user token as its bearer. The requested scopes are the workspace surface — searching public and private channels, files, and people, reading channels, threads, profiles, and channel members, and the writes those tools need — and `slackDirectMessages` adds direct-message search and history, which the application has to register as well. Reads run directly; a name that does not read as a read asks for approval and posts as the reader, not as a bot. `probeSlackToken` asks Slack about the stored token at most once per `slackVerifyIntervalMs`, so a revoked sign-in stops claiming to be connected, and disconnecting revokes the token at Slack.

Reading WhatsApp, Telegram, Discord, or Slack content — message text, file names, member lists — reaches the model as other people's data. Tools that only read an account run directly; sending, editing, deleting, forwarding, reacting, pinning, muting, marking as read, scheduling, typing indicators, dice, polls, and every group change ask the user for approval first. On Discord, posting, replying, reacting, uploading a file, and opening a thread ask for approval, and every administration or moderation call asks separately, naming the change.

Google, Microsoft, GitHub, Discord, and Telegram need the Aeven API whose connector broker holds their application credentials:

```yaml
- id: account-integrations
  config:
    apiUrl: https://api.aeven.example
```

Slack is the one provider that needs no credential on the Aeven API: its PKCE client is a public client, so the deployment holds one public client id and the login runs on the Host.

### Setting up the Slack application

Create the application in the Slack workspace that will use it, either by pasting the manifest below under **From a manifest** or by hand, then enable PKCE and copy the client id from **Basic Information → App Credentials**. The registered redirect has to match the port the Host binds, and every user scope the connector asks for has to be on the application:

```json
{
  "display_information": {
    "name": "Aeven"
  },
  "oauth_config": {
    "redirect_urls": [
      "http://127.0.0.1:12751/callback"
    ],
    "scopes": {
      "user": [
        "search:read.public",
        "search:read.private",
        "search:read.files",
        "search:read.users",
        "channels:read",
        "groups:read",
        "im:read",
        "mpim:read",
        "channels:history",
        "groups:history",
        "users:read",
        "files:read",
        "emoji:read",
        "chat:write",
        "reactions:read",
        "reactions:write",
        "files:write",
        "canvases:read",
        "canvases:write",
        "lists:read",
        "lists:write",
        "channels:write",
        "groups:write",
        "im:write",
        "mpim:write"
      ]
    },
    "pkce_enabled": true
  },
  "settings": {
    "org_deploy_enabled": false,
    "socket_mode_enabled": false,
    "token_rotation_enabled": false
  }
}
```

Two properties of that application are worth knowing before it exists. Enabling PKCE is a one-way setting: Slack will not let the application return to a confidential client without support. And Slack serves MCP only to applications published in its marketplace or to internal applications, so a workspace administrator has to approve the application before any workspace can connect.

Register the client id and the callback port in the profile that serves the connectors:

```yaml
- id: account-integrations
  config:
    apiUrl: https://api.aeven.example
    slackClientId: 1234567890.1234567890
    slackCallbackPort: 12751
```

| Field | Default | Meaning |
|---|---|---|
| `maxSkillBytes` | 10485760 | Maximum decoded bundle size |
| `timeoutMs` | 60000 | OAuth, MCP discovery, daemon control, and tool request budget |
| `consentLifetimeMs` | 600000 | Maximum consent or sign-in duration |
| `apiUrl` | none | Aeven API origin whose connector broker holds every provider credential; absent leaves Google, Microsoft, GitHub, Discord, and Telegram unavailable |
| `credentialRef` | `AEVEN_TOKEN` | Credential reference holding each signed-in user's Aeven access token |
| `maxEmailAccounts` | 20 | Email accounts one account may connect |
| `maxWhatsAppAccounts` | 10 | WhatsApp numbers one account may link |
| `maxTelegramAccounts` | 10 | Telegram accounts one account may sign in |
| `whatsappBinaryPath` | platform package | WhatsApp daemon executable |
| `whatsappStartupTimeoutMs`, `whatsappStopGraceMs` | 15000, 5000 | Time to bind the loopback port, and to exit after stdin closes |
| `whatsappPairingPollMs` | 1500 | Interval between QR-state reads |
| `whatsappRestartDelayMs`, `whatsappMaxRestartDelayMs` | 1000, 60000 | Restart backoff bounds |
| `telegramEntryPath` | vendored package | Telegram daemon entry |
| `telegramStartupTimeoutMs`, `telegramStopGraceMs` | 15000, 5000 | Time to bind the loopback port, and to exit after stdin closes |
| `telegramPairingPollMs` | 1500 | Interval between sign-in state reads |
| `telegramRestartDelayMs`, `telegramMaxRestartDelayMs` | 1000, 60000 | Restart backoff bounds |
| `maxDiscordGuilds` | 25 | Discord guilds one account may connect |
| `discordEntryPath` | vendored package | Discord connector server entry |
| `discordPermissions` | curated surface bitfield | Permission bitfield the install link requests |
| `discordAdminTools` | false | Serve the administration and moderation tools, and request the permissions they need |
| `discordVerifyIntervalMs` | 300000 | Time a verified guild membership is trusted before Discord is asked again |
| `maxSlackWorkspaces` | 10 | Slack workspaces one account may connect |
| `slackClientId` | none | The deployment's Slack application client id, which is public; absent leaves Slack unavailable |
| `slackCallbackPort` | 12751 | Loopback port the Slack application registered as `http://127.0.0.1:<port>/callback` |
| `slackDirectMessages` | false | Also request direct-message search and history, which the application must register too |
| `slackVerifyIntervalMs` | 300000 | Time a live Slack token is trusted before Slack is asked again |

Microsoft has five independently enabled providers: Outlook, Outlook Calendar, OneDrive, SharePoint, and Teams. The maintained Graph bridge receives a short-lived token from the broker and serves an explicit per-provider tool list. Bridge login and account-management tools never enter the harness catalog. Reads run directly; every served Microsoft write asks for approval by its actual tool identity, including names shortened by the MCP bridge. A completed consent is saved only after Graph account identity and a service read succeed. The row contains account and tenant metadata; refresh tokens stay on the API.

The Node API needs `MICROSOFT_CONNECTOR_CLIENT_ID` and `MICROSOFT_CONNECTOR_CLIENT_SECRET` for one application accepting work and personal accounts, with its web callback registered. SharePoint and Teams use work-only consent. Administrator refusals appear in Settings with the application's per-provider approval link; after approval the user signs in again. Expired or revoked grants require reconnecting.

## Understand the implementation

<details>
<summary>Implementation internals</summary>

The account domain stores metadata and validated skill resources; the credential provider owns secrets. The skill provider filters every lookup by account owner. Connector scopes belong to this plugin and are disposed when their conversation ends; the existing MCP client registers discovered tools in the owning agent's scope. Skill changes invalidate browser slash-menu catalogs through the forwarded registry event. No invariant companion is published because these operations use the storage, identity, credential, skill, and tool registries directly.

</details>

## Model Experience

### Personal skill catalog

#### What the model sees

The [skill loader](../../skill/tool-skill/README.md) publishes enabled, model-invocable personal skills and loads their instruction bodies and resource directory on demand.

#### Token effect

Catalog cost grows with enabled skills. Loaded instructions add their content to the session history.

#### KV Cache effect

Imports, replacement, and enablement changes alter the next catalog observation. Previously logged skill instructions remain part of the conversation history.

### Connector tools

#### What the model sees

The [MCP client](../../mcp/mcp-client/README.md) publish the enabled owner's tools under `mcp__<provider>_<connector-id-prefix>__<tool>` names. Credentials never enter tool schemas or model results.

#### Token effect

Enabled MCP servers add their discovered tool schemas. Calls add their results. This plugin adds no separate system prompt.

#### KV Cache effect

Connecting, disabling, or disconnecting a server changes the next step's tool catalog and can change its reusable request prefix.

## Known Limitations and Deferred Work

- Provider sign-in requires the Aeven API's registered applications and user authorization; compilation does not verify real consent. Microsoft work tenants may require administrator consent and publisher verification.
- Brokered connectors act through the owner's Aeven session: a conversation step that runs while the owner has no live session on this Host leaves Google, Microsoft, GitHub, and Discord tools out of that step.
- Linking a WhatsApp number needs the user's phone, and signing in Telegram needs that deployment's registered Telegram application plus the user's phone, code, and 2FA password. Neither path signs in against a live account in tests; the daemon's sign-in handling is covered with a replaced Telegram client.
- Telegram signs in as the user's own account (a user session, not a bot), so Telegram's API terms apply and automated bulk action can put the account at risk.
- The Workspace bridge exposes the selected Google services. Its available tools can differ from ChatGPT’s app-backed connector.
- Custom stdio servers and generic MCP OAuth discovery are not exposed by these pages.
- Adding a Discord server needs the Aeven Discord application on the Aeven API, with the Message Content and Server Members intents enabled in the Discord Developer Portal and the API's callback URL registered; no test installs against Discord.
- Discord messages arrive only when a conversation reads them; a Gateway listener for incoming messages and mentions is deferred.
- Discord reserves server-wide text search for user accounts, so `search_messages` covers the window it scanned and says so.
- Connecting a Slack workspace needs a Slack application with PKCE enabled and `http://127.0.0.1:<slackCallbackPort>/callback` registered; Slack allows MCP only for marketplace-published or internal applications, and a workspace administrator can refuse the integration, so a first connection may need an administrator. No test connects to Slack.
- Enabling PKCE is one-way on the Slack application, and its refresh tokens expire after 30 days without use, so a workspace left idle has to be connected again.
- Direct-message search and history require `slackDirectMessages` at consent time and must be registered on the application; a workspace connected without them has to be connected again to gain them.
- Imported resources materialized for skill loading remain on disk after the catalog entry is removed.

### Dev Note

No Claude application binaries or proprietary bundled document skills are redistributed.
