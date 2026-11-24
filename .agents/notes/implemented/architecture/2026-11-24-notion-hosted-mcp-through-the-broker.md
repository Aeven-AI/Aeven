# Agent Note: Notion mounts its hosted MCP server through the connector broker

Status: implemented

English | [中文](2026-11-24-notion-hosted-mcp-through-the-broker.zh.md)

## Problem

Notion is the first connector whose provider publishes no ordinary OAuth application to register. Its hosted MCP server at `https://mcp.notion.com/mcp` accepts only tokens from its own authorization server, which registers clients dynamically (RFC 7591) and requires the MCP resource on the authorization and token requests (RFC 8707). Notion's classic public integration works with the REST API and the open-source local MCP server instead, whose tools mirror raw API calls rather than the Markdown page tools of the hosted server.

## Decision

The connector uses the hosted server, and the Aeven API stays the only holder of its credentials, as for Google, Microsoft, and GitHub ([connector secrets](2026-10-07-connector-secrets-on-aeven-api.md)).

- **Registration.** On the first Notion consent the API registers itself at Notion's registration endpoint as a confidential client (`client_secret_post`) with its connector callback as the only redirect URI, and stores the result in `connector_clients`, the secret encrypted. The row is keyed by provider and redirect URI, so development and production register separately and a changed callback registers again. Concurrent first consents share one registration; a registration Notion later refuses with `invalid_client` is deleted, so the next consent registers again and existing grants ask to reconnect.
- **Grant.** Consent, code exchange, refresh, and revocation run through the existing broker routes with the stored registration's credentials and `resource=https://mcp.notion.com/mcp`. The Host treats Notion as one more brokered provider: it fetches short-lived access tokens with `broker.token()` and mounts the hosted server over Streamable HTTP.
- **Approvals.** Notion's tool names (`notion-search`, `notion-create-pages`) do not match the shared read-name pattern, so `notion.ts` lists the read tools from Notion's published reference. Every other tool, including one Notion adds later, asks first.

## Alternatives considered

- **Classic Notion public integration with the local server** — needs a Notion developer application and its secret, runs a stdio process per conversation, and exposes API-shaped tools instead of Notion's maintained hosted ones.
- **Client ID metadata documents** — Notion supports a URL as `client_id`, which would remove the stored registration, but the document must be served from a public origin, so a development API could not sign in without depending on production.
- **Registering on the Host** — the Host would hold the client secret and refresh tokens, which the connector secrets decision keeps on the API.
- **Reusing the MCP SDK's `auth()` helper on the API** — it would duplicate the broker's existing state, PKCE, exchange, and refresh handling; registration and the resource parameter were the only missing pieces.

## Consequences

- The deployment configures no Notion credential; `connectors.notion` in the API configuration only names the client on Notion's consent screen.
- A Notion grant reaches only the pages the user shared on Notion's consent screen.
- A Notion connection row is named after the provider, as GitHub's is; the workspace name is not recorded.
