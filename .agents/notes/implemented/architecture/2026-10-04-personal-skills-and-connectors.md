# Agent Note: Personal skills and connectors

Status: implemented

English | [中文](2026-10-04-personal-skills-and-connectors.zh.md)

## Decision

The [account integration host](../../../../packages/host/account-integrations/README.md) derives every management owner from the authenticated request. Browser requests do not select an account. Personal skill discovery uses the conversation's durable owner; connector credentials are addressed by the account and connector identities. Connector tools register in the owning agent's scope, with scope lifetime owned by both the integration plugin and conversation. The executor rejects disabled, deleted, and foreign-account connections even when an older tool catalog remains visible.

## Provider applications

Custom Streamable HTTP MCP connections and GitHub personal access tokens use existing MCP tool discovery. Google services share a deployment-owned OAuth application and use the maintained Google Workspace MCP bridge and service-specific consent scopes published in OpenAI plugins. Skill bundles preserve upstream content; available operations are determined by the tools actually discovered from the MCP server. Microsoft 365 and GitHub OAuth sign-in require deployment-owned application registrations and compatible MCP resources. Consent state captures the initiating account and PKCE verifier, expires, and is consumed once. The callback does not derive ownership from a browser's ambient login. The credential provider serializes refresh operations and never returns stored secrets through the management Remote.

## Connector skill ownership

Connector metadata names the installed skill definitions belonging to each provider. Settings resolves their bodies through the existing registry rather than maintaining a second skill library. Google Drive owns its six document and file skills, including Forms; Gmail, Calendar, and GitHub own concise connector-specific instructions. Connector skills appear once by name only in connector details, with instructions in a closable popup. Their invocation follows the enabled, authorized connection; individual account skill preferences do not apply. Disconnecting or disabling invalidates skill catalogs and disposes mounted tools while the executor rejects stale calls. Credentials persist through disablement. Settings observes the existing skill-change notification for OAuth completion and connection mutations, and discards superseded list responses. Disconnect cancels pending consent and waits for in-flight callbacks before deleting saved state. Connection status represents stored authorization rather than continuous server reachability. Forms API `forms.create` and `forms.batchUpdate` use ordinary document-edit permission handling, consistent with curated Sheets and Docs edits. Other raw Google writes retain their explicit approval gate.

## Skill resources

Settings derives library ownership from the authenticated account and reads personal imports, the deployment’s default preset scope, and every folder workspace owned by that account through the existing skill registry. Its Remote accepts no conversation id and the browser reads no selected conversation state. Workspace definitions are listed in the library while their invocation remains scoped to their workspace. Preset and filesystem skill files remain managed at their source; account imports alone support removal. Account preferences persist by skill name across sources. A reversible registry invocation policy sets both invocation permissions to false when disabled, on catalog observations and definition loads, including cached candidates. Disabled skills remain visible for inspection. Preferences do not alter source invocation permissions when enabled or expand workspace access.

Imports validate archive size, relative resource paths, metadata, and invocation controls. The account domain is authoritative for bundle content; private resource directories are materialized when a skill is loaded. Removing the catalog entry does not erase already materialized resource files. Registry invalidation also clears browser slash-menu catalogs. Proprietary Claude document bundles and extracted application binaries are excluded from redistribution.

## Verification scope

The user requested TypeScript compilation and builds without test suites. Provider consent requires OAuth registrations and user authorization; a green build does not establish successful provider sign-in. Earlier identity, skill invocation, and MCP lifecycle notes retain their independent scope; this decision does not supersede them.
