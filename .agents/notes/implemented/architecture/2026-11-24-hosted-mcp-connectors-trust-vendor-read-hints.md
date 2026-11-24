# Agent Note: Hosted MCP connectors share the broker and trust their vendor's read hints

Status: implemented

English | [中文](2026-11-24-hosted-mcp-connectors-trust-vendor-read-hints.zh.md)

## Problem

Vercel, Atlassian, monday.com, and Stripe publish hosted MCP servers whose authorization servers register clients dynamically, as Notion's does ([Notion connector](2026-11-24-notion-hosted-mcp-through-the-broker.md)). Adding each as bespoke code would repeat the same registration, consent, and mounting four times. Their tool sets are large and change without notice, so a hand-written read list per vendor would go stale, and a tool missing from it would either ask needlessly or, if lists were permissive, run unreviewed. Separately, the five Microsoft connectors each need their own consent, while users of one work account expect a single sign-in.

## Decision

- **One table per side.** The Aeven API's `HOSTED_MCP` entry per provider names the registration, authorization, token, and revocation endpoints, the MCP resource, the scopes, and the token-endpoint authentication method; Vercel and Stripe accept only public clients, so their registrations carry no secret. Atlassian publishes no protected-resource metadata, so its requests name no resource. The Host's `hosted-mcp.ts` maps each provider to its MCP endpoint. Adding a vendor with dynamic registration is one entry on each side plus its Settings copy, icon, and skill.
- **Vendor read hints decide approvals.** `@aeven/mcp-client` copies a tool's MCP `annotations.readOnlyHint: true` onto its `ToolDefinition` as `readOnlyHint`, which never reaches the model. For hosted MCP connectors, account-integrations reads it from the calling agent's tool view in `tools/pre-execute`: a tool the vendor's own server marks read-only runs directly, and every other tool, including an unmarked one, asks first. Notion keeps its published read list. Claude's connectors make the same choice: a read-only connector policy runs a tool directly only when its server sets `readOnlyHint`.
- **Salesforce brings its own application.** Salesforce's hosted MCP servers support neither a shared application nor dynamic registration, so the user submits the External Client App their org's administrator created — My Domain, consumer key, and optional secret — with the consent. The Aeven API accepts only a Salesforce My Domain host, keeps the app with the grant for refresh and revocation, and assumes a 15-minute token lifetime because Salesforce reports none. Salesforce tools follow the same `readOnlyHint` rule.
- **Shopify runs Aeven's own server.** Shopify publishes no hosted admin MCP server, so `native/shopify-mcp` serves one store per stdio process over the Admin GraphQL API with four tools: three reads and `graphql_mutation`. The read tool refuses any document that defines a mutation or subscription, which a lexer over the document's top-level definitions decides, so its `readOnlyHint` holds. The deployment's Shopify app installs per store through the broker, which verifies Shopify's signature on the redirect and on every webhook, keeps an expiring offline token, and deletes a store's grants on uninstall or shop redaction.
- **Microsoft 365 beside the five.** A `microsoft-365` provider asks for the union of the five services' delegated permissions in one consent and serves the union of their tools through the same Graph bridge. Teams and SharePoint exist only for work or school accounts, so it consents at `organizations` and refuses the consumer tenant; personal accounts keep the individual connectors.

## Alternatives considered

- **Curated read lists for every vendor** — strict, but each list needs upkeep whenever the vendor adds tools, and a vendor's server already declares which of its tools only read.
- **Trusting `readOnlyHint` for every MCP server** — custom servers are not the vendor's own and may annotate carelessly, so GitHub and custom connectors keep the read-name pattern.
- **Replacing the five Microsoft connectors** — would force every existing connection to sign in again and drop personal accounts, which cannot use Teams or SharePoint.

## Consequences

- A vendor that marks a writing tool read-only lets it run without approval; the trust is limited to vendor-operated servers.
- Every new vendor-hosted connector registers at that vendor on its first consent, one registration per redirect URI.
- Shopify needs the Aeven app in the Shopify Partner dashboard, and stores outside development stores can install it only after Shopify's App Store review.
- Salesforce works only in orgs whose administrator created the app and enabled the server; Aeven cannot set that up centrally.
- Microsoft 365 often needs a tenant administrator's approval, because the Teams permissions require it.
