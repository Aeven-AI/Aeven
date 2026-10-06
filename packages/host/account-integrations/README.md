---
description: "Personal skill bundles and account-owned remote MCP connections."
kind: "package-reference"
---

# @aeven/host-account-integrations

English | [中文](README.zh.md)

## Summary

Signed-in users can import, inspect, enable, and remove their own skills, connect remote MCP servers, link WhatsApp numbers, and sign in Telegram accounts. Every management operation derives its owner from the authenticated request. Skills and connector credentials persist across restarts; conversations receive only their owner's integrations.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The Web bundle mounts this plugin with the [Skills and Connectors pages](../../client/ui-settings-integrations/README.md). Settings lists the account’s personal imports, skills from the deployment’s default preset, and skills from every folder workspace owned by that account. Listing is independent of open conversations; Disabled skills remain visible. File-backed entries are deduplicated by their resolved file path, including symlinks. Skills outside connectors support a persistent account-level invocation switch; removal applies only to personal imports. Preferences apply to the skill name across sources and restrict both model and user invocation without changing files or expanding workspace access. Import one `SKILL.md`, `.skill`, or ZIP bundle with exactly one skill definition. Resource paths must stay within its directory; duplicate paths, malformed frontmatter, and oversized bundles are rejected. Imports use the existing skill provider registry and invocation controls.

Custom connections accept Streamable HTTP MCP endpoints and optional bearer tokens; GitHub also accepts a personal access token for its official remote endpoint. Connection creation verifies MCP discovery before saving. Tokens are write-only and stored through the credential provider under an account-derived key. Disablement and disconnection deny subsequent calls even when a conversation still holds an older tool catalog.

Gmail, Google Drive, and Google Calendar use the maintained Google Workspace MCP bridge with service-specific Google OAuth scopes. Configure one `providers.google` OAuth application with `authorizationUrl`, `tokenUrl`, `clientId`, and optionally `clientSecretRef`. Enable the selected Google APIs in that Cloud project and register the exact `redirectUri`. Consent verifies API access before saving. Drive includes Docs, Sheets, Slides, Forms, and comments. Enable the Drive, Docs, Sheets, Slides, and Forms APIs for those skills; comments use the Drive API. Forms reuses the existing Drive consent scopes. Form creation and question edits follow ordinary document-edit permission handling; other raw Google writes retain the explicit approval gate. The discovered MCP tools determine available operations; skill instructions do not add tools.

Connector details list installed skill definitions from the existing registry: Drive owns its six Google document and file skills; Gmail, Calendar, and GitHub each own their corresponding skill. Connector skills appear once by name only in connector details and require an enabled, authorized connection. Individual skill preferences do not control connector skills. Management keeps instructions visible when invocation is disabled. Disabling or disconnecting invalidates skill discovery and removes mounted tools; the executor also rejects stale calls. Disconnect cancels pending consent and waits for any in-flight callback before deleting the connection and credential.

GitHub and Microsoft 365 sign-in require applications under `providers.github` and `providers.microsoft365` with `endpoint`, `authorizationUrl`, `tokenUrl`, `clientId`, nonempty `scopes`, and optionally `clientSecretRef`. Their MCP endpoints must accept the delegated access token. Consent uses account-bound, expiring state and PKCE; the callback verifies access to the selected API or MCP resource before saving. Expired grants refresh through serialized credential writes before conversation steps. The callback displays a localized completion page telling the user to close the browser window and return to Aeven; failed consent identifies token exchange, API access verification, or connection storage without displaying provider responses; expired consent displays restart instructions.

WhatsApp and Telegram hold one connector row per account, and each row owns one supervised daemon process bound to a loopback port the operating system chooses. The Host starts and restarts that process with backoff, holds its standard input open so a crashed Host leaves no process holding a session, and mounts its tools at `mcp__account_<connector-id-prefix>__<tool>`. Every connector is mounted before each conversation step; one that cannot connect is logged and left out of that step, and the next step tries it again, so a broken account never ends a turn. Settings links a WhatsApp number by scanning a QR code, and signs in a Telegram account by typing its phone number, the code Telegram sends, and the account's 2FA password when Telegram asks for one. A WhatsApp number is saved once the phone scans the code; a Telegram account is saved once Telegram authorizes it, and an account already signed in is rejected instead of added twice. Unlinking ends the session at the provider and deletes the connector's data directory. Each account keeps its own process and namespace, so a conversation can reach several accounts without mixing them.

The Telegram daemon is the vendored [`bstuff/telegram-mcp`](../../../native/telegram-mcp/README.md) server under an Aeven entry that adds the loopback MCP endpoint and the sign-in control routes. The deployment owns one registered Telegram application and points `telegramApiIdRef` and `telegramApiHashRef` at credential references; the Host resolves those values and passes them only to the daemon's environment, so they never reach a tool schema, a model request, or a browser response. Each account's session string, cached identity, and downloads stay in that account's own directory. A user signs in by scanning a QR code with the Telegram app or with a phone number and code, and Telegram then asks for the 2FA password when the account has one. A Telegram account keeps one connector id for each user, derived from the user and the Telegram user id: signing in a signed-out account again restores it in place, and signing it in again after unlinking it gets the same id, so its tool names stay stable for conversations that already use them. Signing in an account that is already signed in is refused as a duplicate.

Reading WhatsApp or Telegram content — message text, file names, member lists — reaches the model as other people's data. Tools that only read the account run directly; sending, editing, deleting, forwarding, reacting, pinning, muting, marking as read, scheduling, typing indicators, dice, polls, and every group change ask the user for approval first.

An administrator can configure Google in the web profile's `cordis.patch.yml`; `clientSecretRef` names a credential managed by the deployment's credential provider:

```yaml
- id: account-integrations
  config:
    redirectUri: http://127.0.0.1:3080/connectors/oauth/callback
    providers:
      google:
        authorizationUrl: https://accounts.google.com/o/oauth2/v2/auth
        tokenUrl: https://oauth2.googleapis.com/token
        clientId: YOUR_GOOGLE_CLIENT_ID
        clientSecretRef: YOUR_GOOGLE_CLIENT_SECRET_REFERENCE
```

| Field | Default | Meaning |
|---|---|---|
| `maxSkillBytes` | 10485760 | Maximum decoded bundle size |
| `timeoutMs` | 60000 | OAuth, MCP discovery, daemon control, and tool request budget |
| `consentLifetimeMs` | 600000 | Maximum consent or sign-in duration |
| `redirectUri` | `http://127.0.0.1:3080/connectors/oauth/callback` | Registered callback URL |
| `providers` | `{}` | Deployment-owned OAuth applications and optional MCP resources |
| `maxEmailAccounts` | 20 | Email accounts one account may connect |
| `maxWhatsAppAccounts` | 10 | WhatsApp numbers one account may link |
| `maxTelegramAccounts` | 10 | Telegram accounts one account may sign in |
| `whatsappBinaryPath` | platform package | WhatsApp daemon executable |
| `whatsappStartupTimeoutMs`, `whatsappStopGraceMs` | 15000, 5000 | Time to bind the loopback port, and to exit after stdin closes |
| `whatsappPairingPollMs` | 1500 | Interval between QR-state reads |
| `whatsappRestartDelayMs`, `whatsappMaxRestartDelayMs` | 1000, 60000 | Restart backoff bounds |
| `telegramEntryPath` | vendored package | Telegram daemon entry |
| `telegramApiIdRef`, `telegramApiHashRef` | `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | Credential references holding the registered Telegram application |
| `telegramStartupTimeoutMs`, `telegramStopGraceMs` | 15000, 5000 | Time to bind the loopback port, and to exit after stdin closes |
| `telegramPairingPollMs` | 1500 | Interval between sign-in state reads |
| `telegramRestartDelayMs`, `telegramMaxRestartDelayMs` | 1000, 60000 | Restart backoff bounds |

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

The [MCP client](../../mcp/mcp-client/README.md) publish the enabled owner's tools under `mcp__account_<connector-id-prefix>__<tool>` names. Credentials never enter tool schemas or model results.

#### Token effect

Enabled MCP servers add their discovered tool schemas. Calls add their results. This plugin adds no separate system prompt.

#### KV Cache effect

Connecting, disabling, or disconnecting a server changes the next step's tool catalog and can change its reusable request prefix.

## Known Limitations and Deferred Work

- Provider sign-in requires registered applications and user authorization; compilation does not verify real consent. Microsoft 365 additionally needs a compatible MCP server.
- Linking a WhatsApp number needs the user's phone, and signing in Telegram needs that deployment's registered Telegram application plus the user's phone, code, and 2FA password. Neither path signs in against a live account in tests; the daemon's sign-in handling is covered with a replaced Telegram client.
- Telegram signs in as the user's own account (a user session, not a bot), so Telegram's API terms apply and automated bulk action can put the account at risk.
- The Workspace bridge exposes the selected Google services. Its available tools can differ from ChatGPT’s app-backed connector.
- Custom stdio servers and generic MCP OAuth discovery are not exposed by these pages.
- Imported resources materialized for skill loading remain on disk after the catalog entry is removed.

## Dev Note

No Claude application binaries or proprietary bundled document skills are redistributed.
