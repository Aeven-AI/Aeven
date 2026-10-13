# Agent Note: Microsoft 365 connectors on one Entra application

Status: proposed

English | [中文](2026-10-07-microsoft-365-connectors.zh.md)

## Problem

The connector union already carries `microsoft365` and Settings already lists a Microsoft 365 row, but nothing backs it: the provider owns no skill definition, the Aeven API holds no Microsoft application, and a deployment reports it as not configured. The five surfaces the row promises — Outlook, Outlook Calendar, OneDrive, SharePoint, and Teams — are reachable through no other connector either, while their Google counterparts (Gmail, Drive, Calendar) ship today.

The Google connectors are the shape to follow: a maintained MCP bridge mounted once per connector row, delegated scopes owned by the API, a default verification call before the row is saved, and one skill bundle per provider. Microsoft's equivalents are not Google's: the mailbox cannot be added the way the [email connector](2026-10-06-email-account-connectors.md) adds one, because Exchange Online has retired basic authentication for IMAP and POP and basic SMTP AUTH is on the same path, so a stored password is not a durable credential for a Microsoft mailbox.

The bridge is the one piece that does not already exist in this repository. [`@softeria/ms-365-mcp-server`](https://github.com/Softeria/ms-365-mcp-server) (MIT, npm, MSAL-based, hundreds of Graph tools across mail, calendar, files, Excel, OneNote, To Do, Teams, SharePoint, and meetings) accepts a pre-obtained access token through `MS365_MCP_OAUTH_TOKEN`, filters its own tool surface through presets, `--enabled-tools`, `--org-mode`, `--allowed-scopes`, and `--read-only`, and reports the exact Graph permissions a given surface needs through `--list-permissions`. That is the same relationship the Google connectors have with the Workspace bridge: the bridge owns Graph access and the tool vocabulary, Aeven owns consent, tokens, mounting, approvals, and instruction.

## Proposal

### Five providers on one Entra application

`microsoft365` is replaced by five `ConnectorProvider` members — `outlook`, `outlook-calendar`, `onedrive`, `sharepoint`, `teams` — each with its own row, scope set, bridge surface, skill definition, icon, and Settings entry, the way `gmail`, `google-drive`, and `google-calendar` are separate today. One multi-tenant Entra application owned by the deployment holds the client secret on the Aeven API, and consent is per provider, so adding Outlook grants mail permissions and nothing else.

| Provider | Surface | Authority | Bridge surface |
| --- | --- | --- | --- |
| `outlook` | Mailbox read, search, send, drafts, folders | `common` | personal mode, mail preset |
| `outlook-calendar` | Calendars, events, invitations, free/busy | `common` | personal mode, calendar preset |
| `onedrive` | The signed-in account's own drive | `common` | personal mode, files preset |
| `sharepoint` | Site libraries, items, lists | `organizations` | `--org-mode`, SharePoint and drive tool filter |
| `teams` | Teams, channels, chats, messages | `organizations` | `--org-mode`, Teams preset |

The API owns each provider's scope list, as it owns the Google ones, and derives it from the bridge's own `--list-permissions` output for that surface rather than from a hand-copied list. The first three use the `common` authority because personal Microsoft accounts can consent to mail, calendar, and drive permissions; SharePoint and Teams are work-only.

### The Host bridge descriptor

The Host gains `microsoft.ts` beside `google.ts`, with the same three responsibilities and the same call sites:

- a `microsoftConnectors` table: provider → bridge surface (mode, preset or tool filter, read-only where the surface must not write), the default verification tool and its arguments, and the provider's delegated scopes;
- `microsoftConnection(provider, token, directory, timeoutMs)`: the private stdio configuration for one row — the bridge entry resolved from the installed package, `cwd` set to the account's own directory, and the environment carrying `MS365_MCP_OAUTH_TOKEN` with the access token the broker just issued, `MS365_MCP_EXPECTED_USERNAME` with the row's account, and the bridge's token-cache and selected-account paths inside that directory;
- `verifyMicrosoft(provider, config, timeoutMs)`: connect, list tools, and call one read tool for that surface before the row is saved, as `verifyGoogle` does.

No secret reaches the child except the short-lived token, and no refresh happens in the child: the token lives long enough for a conversation step, and the Host asks the API again for the next one, exactly as it does for Google.

### Consent, refresh, and the two failure states the API must name

- `services/connectors/ConnectorProviders.js` gains the five Microsoft entries: tenant-segmented authorize and token URLs, `kind: "oauth"`, `authorizationParams` with `prompt=select_account`, and the per-provider scope list.
- `config.js` and `.env.example` gain `connectors.microsoft.clientId` and `clientSecret` from `MICROSOFT_CONNECTOR_CLIENT_ID` and `MICROSOFT_CONNECTOR_CLIENT_SECRET`.
- `db/models/ConnectorGrant.js` gains `tenantId`, because Entra refresh is tenant-scoped: a personal account's refresh must go through `consumers`, and a work account's through its own tenant id — refreshing a personal grant through the authority it consented on fails at the first refresh, roughly an hour in. The model's comment stops naming only Google and GitHub.
- `services/connectors/ConnectorService.js` records the tenant and account the provider returned, refreshes through the recorded authority, keeps `invalid_grant` as `reauthorize`, and adds a distinct `admin-consent-required` stage for an `access_denied` callback carrying `AADSTS65001` or `AADSTS90094`, so Settings can say that an administrator has to approve rather than reporting a generic failure. Entra publishes no revocation endpoint, so `revoke()` stays a no-op and removing the row deletes the grant.
- `services/connectors/callbackPage.js` and the connector tests gain that stage in both languages.

### Rows, approvals, and skills

A Microsoft row records the account Graph reports and the tenant id, and never a token. The row mounts through the existing MCP path, so it needs no new executor rule: tools appear as `mcp__account_<connector-id-prefix>__<tool>`, the catalog follows the account's own enabled connections, and a disabled, removed, or foreign row is refused as it is today.

The approval list grows the Microsoft writes by name — send and reply, create, update, or delete an event, upload, move, rename, copy, or delete a file, create a folder, share, post or reply to a channel message, create a chat or channel — while reads stay direct. Teams administration, tenant-wide directory reads, and mailbox rules are not part of any served surface.

One skill bundle per provider ships under the preset (`outlook`, `outlook-calendar`, `onedrive`, `sharepoint`, `teams`), naming how to address the account, what the surface cannot do, and which calls ask for approval, in the form the Gmail and Calendar skills already use.

### Work list

Each step is independently reviewable, and the API ships before the Host at every step.

1. **Spike the bridge.** Install `@softeria/ms-365-mcp-server`, run it with `MS365_MCP_OAUTH_TOKEN` from a hand-obtained token against a work tenant and a personal account, capture `--list-permissions` per surface, and record the served tool names per provider. This fixes the scope lists and the verification calls before any wiring exists, and it is the step that can invalidate the choice.
2. **API: Microsoft provider entries.** `ConnectorProviders.js`, `config.js`, `.env.example`, the grant's `tenantId`, the refresh authority, the `admin-consent-required` stage, the callback page, and unit tests for start, callback, refresh, and both failure states.
3. **Host: descriptor and mounting.** `microsoft.ts`, the five provider members in `types.ts`, the zod enums, `brokeredProviders`, `connectorSkills`, the `configured` computation, and the mount and verify call sites, with tests beside the Google ones.
4. **Settings.** Five rows with brand icons, English and Chinese copy, the sign-in action per provider, an "administrator approval required" state with the deployment's admin-consent link, and the reconnect state for a revoked grant.
5. **Skills.** The five bundles, each reviewed against the surface the spike recorded.
6. **Composition and docs.** The bridge dependency in the package that mounts account integrations, the shipped profile that serves these rows, `THIRD_PARTY_NOTICES.md`, the account-integrations and Settings READMEs in both languages, and the regenerated config catalog.
7. **Teams and SharePoint last**, on the same descriptor: they need `--org-mode`, the `organizations` authority, and permissions most tenants reserve for an administrator, so they ship after the three work-and-personal providers are proven end to end.

## Phasing

1. Steps 1–6 for `outlook`, `outlook-calendar`, and `onedrive`: the personal-capable providers, which prove the API, the mount, the approvals, the skills, and the Settings states once.
2. Step 7 for `sharepoint` and `teams`, which add no new mechanics beyond mode, authority, and the administrator-approval state that step 2 already built.
3. Deferred, each needing its own note: the [Work IQ MCP servers](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview) as an optional provider where a tenant holds Copilot licences and an administrator activates them; Graph change notifications through the API into sessions, which is what would make these connectors proactive instead of read-on-demand; moving Google Calendar onto shared calendar tools; and an owned Graph bridge if the dependency's surface, approval granularity, or maintenance stops fitting.

## Alternatives considered

- **An owned Graph bridge or in-process capability seams** — our own thin Graph client with mail, calendar, drive, and teams seams, either in process or as a vendored `native/graph-mcp`; it buys a tool vocabulary we control and costs a package per seam, four new tool sets, their tests, and their docs. Rejected as the first move because the maintained bridge already serves these surfaces, and the Google connectors already demonstrate the mount, verification, and approval pattern around one.
- **One `microsoft365` connector with five surfaces** — one consent for everything, all-or-nothing scopes, one row for several accounts, and a catalog assembled for services the reader never enabled; rejected in favor of per-service providers, mirroring Google.
- **Microsoft's first-party MCP servers** — the read-only Entra-directory [MCP Server for Enterprise](https://learn.microsoft.com/en-us/graph/mcp-server/overview) answers identity questions rather than these five surfaces, and the Work IQ servers are preview, need a Microsoft 365 Copilot licence for every reader, and need per-tenant administrator activation; rejected as the default, kept as the deferred optional provider.
- **Outlook mail through the email connector's IMAP or SMTP path** — the transport Microsoft has retired for IMAP and POP and is retiring for SMTP AUTH; rejected, and the note that proposed XOAUTH2 for Outlook is superseded on that point.
- **The bridge in `--http` mode with its own OAuth** — would give the bridge the OAuth application, the consent screen, and the refresh token, which is the arrangement the connector secrets rule exists to prevent; rejected in favor of BYOT with the token issued per step by the API.

## Acceptance criteria

- All five rows can be added from Settings against a work tenant, and the mail, calendar, and drive rows also against a personal Microsoft account; each row switches off, is added again, and is removed independently.
- One read succeeds per service immediately after consent, and the verification call is the one the spike recorded for that surface: list mail, list calendars, list drive items, read a site library, read a chat.
- Sending mail, creating an event, uploading a file, and posting a channel message each ask for approval and then succeed; a read never asks.
- An account with no Microsoft connector sees none of these tools in its step catalog, and a disabled, removed, or foreign connector is refused.
- No client secret, refresh token, or access token appears in a connector row, a Remote response, a tool result, a browser response, or a log; the child process environment carries one short-lived token and no secret.
- A consent the tenant refuses because user consent is off, or because a permission needs an administrator, reports as needing administrator approval with a link; a revoked or expired grant shows its row as needing to be added again.
- Verification: `pnpm run typecheck`, a green `pnpm run build`, the API's connector unit tests, the Host's connector tests, and a live pass per service in a work tenant plus a personal account for the three providers that support one.

## Risks

- The bridge is a third-party dependency on a fast-moving Microsoft API, and its tool names, presets, and permission mapping can change under us; the spike's recorded surface is what the descriptor and the skills are written against, and a version bump re-runs it.
- Consent is the gate, not the code. Tenant policy, an unverified publisher, or an administrator who has not approved can leave every row unaddable, and compilation shows none of it.
- The bridge is broad by nature: unusable tools reach the catalog if the surface is filtered loosely, and Graph permissions are what actually bound a call. The filter, `--read-only` where it applies, and the API's scope list are the three places this is held.
- Personal Microsoft accounts cannot reach SharePoint or Teams, so those two providers stay work-only and their absence from a personal account is expected.
- Teams is the most sensitive surface here: channel reads need an administrator, and a tool that posts to a channel acts as the reader in front of colleagues, so the served surface stays narrow and writes ask every time.
- Two repositories must move together per step, with the API first, and the Host must degrade to "not configured" rather than to a failed sign-in.
