---
description: "Personal skill bundles and account-owned remote MCP connections."
kind: "package-reference"
---

# @aeven/host-account-integrations

English | [中文](README.zh.md)

## Summary

Signed-in users can import, inspect, enable, and remove their own skills and connect remote MCP servers. Every management operation derives its owner from the authenticated request. Skills and connector credentials persist across restarts; conversations receive only their owner's integrations.

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
| `timeoutMs` | 60000 | OAuth, MCP discovery, and tool request budget |
| `consentLifetimeMs` | 600000 | Maximum consent duration |
| `redirectUri` | `http://127.0.0.1:3080/connectors/oauth/callback` | Registered callback URL |
| `providers` | `{}` | Deployment-owned OAuth applications and optional MCP resources |

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
- The Workspace bridge exposes the selected Google services. Its available tools can differ from ChatGPT’s app-backed connector.
- Custom stdio servers and generic MCP OAuth discovery are not exposed by these pages.
- Imported resources materialized for skill loading remain on disk after the catalog entry is removed.

## Dev Note

No Claude application binaries or proprietary bundled document skills are redistributed.
