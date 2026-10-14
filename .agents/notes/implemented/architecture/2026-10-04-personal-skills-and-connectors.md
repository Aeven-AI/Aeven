# Agent Note: Personal skills and connectors

Status: implemented

English | [中文](2026-10-04-personal-skills-and-connectors.zh.md)

## Problem

Settings offers each signed-in person their own skills and connectors, so every management call must act for the authenticated account rather than for an account a browser request names. The same ownership has to hold where the work runs: a conversation's tool catalog and the skill registry both outlive a disconnect, and a connection the person disabled, deleted, or never owned must not stay usable through a stale catalog or a cached instruction body.

## Decision

The [account integration host](../../../../packages/host/account-integrations/README.md) derives every management owner from the authenticated request. Browser requests do not select an account. Personal skill discovery uses the conversation's durable owner; connector credentials are addressed by the account and connector identities. Connector tools register in the owning agent's scope, with scope lifetime owned by both the integration plugin and conversation. The executor rejects disabled, deleted, and foreign-account connections even when an older tool catalog remains visible.

## Provider applications

Custom Streamable HTTP MCP connections and GitHub personal access tokens use existing MCP tool discovery. Google services share a deployment-owned OAuth application and use the maintained Google Workspace MCP bridge and service-specific consent scopes published in OpenAI plugins. Skill bundles preserve upstream content; available operations are determined by the tools actually discovered from the MCP server. Microsoft 365 and GitHub OAuth sign-in require deployment-owned application registrations and compatible MCP resources. Consent state captures the initiating account and PKCE verifier, expires, and is consumed once. The callback does not derive ownership from a browser's ambient login. The credential provider serializes refresh operations and never returns stored secrets through the management Remote.

## Connector skill ownership

Connector metadata names the installed skill definitions belonging to each provider. Settings resolves their bodies through the existing registry rather than maintaining a second skill library. Google Drive owns its six document and file skills, including Forms; Gmail, Calendar, and GitHub own concise connector-specific instructions. Connector skills appear once by name only in connector details, with instructions in a closable popup. Their invocation follows the enabled, authorized connection; individual account skill preferences do not apply. Disconnecting or disabling invalidates skill catalogs and disposes mounted tools while the executor rejects stale calls. Credentials persist through disablement. Settings observes the existing skill-change notification for OAuth completion and connection mutations, and discards superseded list responses. Disconnect cancels pending consent and waits for in-flight callbacks before deleting saved state. Connection status represents stored authorization rather than continuous server reachability. Forms API `forms.create` and `forms.batchUpdate` use ordinary document-edit permission handling, consistent with curated Sheets and Docs edits. Other raw Google writes retain their explicit approval gate.

## Skill resources

Settings derives library ownership from the authenticated account and reads personal imports, the deployment’s default preset scope, and every folder workspace owned by that account through the existing skill registry. Its Remote accepts no conversation id and the browser reads no selected conversation state. Workspace definitions are listed in the library while their invocation remains scoped to their workspace. Preset and filesystem skill files remain managed at their source; account imports alone support removal. Account preferences persist by skill name across sources. A reversible registry invocation policy sets both invocation permissions to false when disabled, on catalog observations and definition loads, including cached candidates. Disabled skills remain visible for inspection. Preferences do not alter source invocation permissions when enabled or expand workspace access.

Imports validate archive size, relative resource paths, metadata, and invocation controls. The account domain is authoritative for bundle content; private resource directories are materialized when a skill is loaded. Removing the catalog entry does not erase already materialized resource files. Registry invalidation also clears browser slash-menu catalogs. Proprietary Claude document bundles and extracted application binaries are excluded from redistribution.

## Alternatives considered

**Adopt the account a browser request names, or the conversation it is looking at, as the owner.** Rejected: ownership comes from the authenticated request alone, the management Remote accepts no conversation id and reads no selected conversation state, and the executor refuses a disabled, deleted, or foreign-account connection even while an older tool catalog is visible.

**Maintain a second skill library for connector instructions.** Rejected: connector metadata names the installed skill definitions belonging to each provider and Settings resolves their bodies through the existing registry, so connector instructions cannot drift from the skills the registry publishes.

**Let individual account skill preferences govern connector skills.** Rejected: a connector skill's invocation follows the enabled, authorized connection, so a per-account preference would leave an instruction body reachable through a connection the account turned off.

**Report connection status as server reachability.** Rejected: status represents the stored authorization, and re-probing every provider on a timer would spend provider quota to answer a question the stored grant already answers.

## Consequences

- Credentials persist through disablement, so re-enabling a connection needs no new sign-in, and stored secrets never travel back through the management Remote.
- Disconnect cancels pending consent and waits for in-flight callbacks before deleting saved state; disabling or disconnecting invalidates skill catalogs and disposes mounted tools, and the executor still rejects a stale call.
- Connector skills appear once, by name, in their own connector's details, with instructions in a closable popup, and they add no separate entry to the skills list.
- Workspace definitions are listed in the library while their invocation stays scoped to their workspace; only account imports support removal, and preset and filesystem skill files stay managed at their source.
- Imports validate archive size, relative resource paths, metadata, and invocation controls, and proprietary Claude document bundles and extracted application binaries are excluded from redistribution.
- Verification is limited to TypeScript and builds at the user's request: a green build does not establish provider sign-in, which needs OAuth registrations and user authorization.

## Verification scope

The user requested TypeScript compilation and builds without test suites. Provider consent requires OAuth registrations and user authorization; a green build does not establish successful provider sign-in. Earlier identity, skill invocation, and MCP lifecycle notes retain their independent scope; this decision does not supersede them.
