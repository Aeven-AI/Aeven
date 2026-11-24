# Agent Note: Spotify, Cloudflare, AWS, and Google Tasks, Contacts, and Meet connectors, listed by category

Status: implemented

English | [中文](2026-11-24-more-connectors-grouped-by-category.zh.md)

## Problem

Users asked for Spotify, Cloudflare, AWS, and every Google service Æven can reach without a restricted scope. With 29 providers, the flat Connectors list no longer let a reader find a connector by what it is for.

## Decision

- **Vendor-hosted servers.** Cloudflare (`https://mcp.cloudflare.com/mcp`) and AWS (`https://aws-mcp.us-east-1.api.aws/mcp`) register clients dynamically, so each is one `HOSTED_MCP` entry on the Aeven API and one `hosted-mcp.ts` endpoint on the Host ([hosted MCP connectors](2026-11-24-hosted-mcp-connectors-trust-vendor-read-hints.md)). AWS accepts only public clients and publishes no revocation endpoint. Both request no scope parameter, which leaves the server's default grant.
- **Spotify through a deployment app.** Spotify's hosted MCP server (`mcp-gateway-external-pilot.spotify.net`) authorizes through `accounts.spotify.com`, which registers no clients dynamically, so the API's `connectors.spotify` holds the Æven app's client credentials and requests the eight scopes the server's protected-resource metadata lists. Its tools follow the vendor `readOnlyHint` rule like the other hosted servers.
- **Google beyond Gmail, Drive, and Calendar.** `google-tasks` (`tasks`), `google-contacts` (`contacts`), and `google-meet` (`meetings.space.created`, `meetings.space.readonly`) run through the same Workspace bridge with `GWS_SERVICES` set to `tasks`, `people`, and `meet`. All four scopes are sensitive, not restricted, so verification needs no CASA assessment. The bridge has no Meet tools of its own; its `workspace_raw` tool reaches the Meet API and verifies the grant with `conferenceRecords.list`. Chat and Keep need a Workspace administrator and YouTube is outside the bridge, so they are not offered.
- **Categories in the client.** `connector-categories.ts` maps every provider to one heading — Communication, Productivity, Development tools, Sales and marketing, Commerce and shopping, Financial services, or Media and entertainment, the vocabulary of Claude's connector directory — and the Connectors page lists each non-empty heading above its rows. The map is a `Record<ConnectorProvider, …>`, so adding a provider without a category fails the typecheck. Search narrows the rows inside each heading and hides headings left empty.

## Alternatives considered

- **Category on the Host's provider view** — the heading is presentation only; keeping it in the client avoids a wire field no other consumer reads.
- **One Google group** — readers look for Gmail beside the other mail connectors and Drive beside OneDrive, so Google providers sit under the headings their purpose names.
- **Full Gmail and Drive scopes** — restricted scopes need a yearly paid CASA assessment ([connector secrets](2026-10-07-connector-secrets-on-aeven-api.md)).

## Consequences

- The Host and the Aeven API ship together: a Host offering a provider the API does not know fails at sign-in.
- The four Google scopes must be added to the `aeven-connectors` consent screen and verified; until then a grant shows Google's unverified-app screen.
- Spotify connects only for accounts allowlisted in the app's development mode until Spotify grants extended quota, and its pilot server may accept only allowlisted clients.
