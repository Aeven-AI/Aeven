# Agent Note: Cloudflare, AWS, Supabase, Calendly, Google Cloud, Azure DevOps, Oracle Cloud, and Google Tasks, Contacts, and Meet connectors, listed by category

Status: implemented

English | [中文](2026-11-24-more-connectors-grouped-by-category.zh.md)

## Problem

Users asked for Spotify, Cloudflare, AWS, Supabase, Calendly, the other major clouds, and every Google service Æven can reach without a restricted scope. With 34 providers, the flat Connectors list no longer let a reader find a connector by what it is for.

## Decision

- **Vendor-hosted servers.** Cloudflare (`https://mcp.cloudflare.com/mcp`), AWS (`https://aws-mcp.us-east-1.api.aws/mcp`), Supabase (`https://mcp.supabase.com/mcp`, authorized at `api.supabase.com`), and Calendly (`https://mcp.calendly.com/`, authorized at `calendly.com`) register clients dynamically, so each is one `HOSTED_MCP` entry on the Aeven API and one `hosted-mcp.ts` endpoint on the Host ([hosted MCP connectors](2026-11-24-hosted-mcp-connectors-trust-vendor-read-hints.md)). AWS and Calendly accept only public clients; AWS, Supabase, and Calendly publish no revocation endpoint. Cloudflare, AWS, and Supabase request no scope parameter, which leaves the server's default grant; Calendly requests the three scopes its protected-resource metadata lists.
- **Google Cloud through Google sign-in.** BigQuery (`https://bigquery.googleapis.com/mcp`) and Compute Engine (`https://compute.googleapis.com/mcp`) are Google's own hosted MCP servers; their authorization server is `accounts.google.com`, so each is a `GOOGLE_SCOPES` entry (`bigquery`, `compute`) on the API and a hosted-MCP endpoint on the Host. Google serves one MCP server per product, so each product is its own connector.
- **Azure DevOps through the Microsoft application.** Its hosted server lives at `mcp.dev.azure.com/<organization>` and authorizes through Entra work and school accounts, so the API's Microsoft application requests `https://mcp.dev.azure.com/.default` at `organizations`. That token is not for Graph, so the API reads the account from the ID token instead of Graph's `/me`. Settings collects the organization before the consent and the Host stores the server with the row. Azure resources have no hosted MCP server and are not offered.
- **Oracle Cloud like Salesforce.** Oracle's managed MCP server runs inside each tenancy and authorizes through the tenancy's own Identity Domain, without dynamic registration, so the user brings the server URL, the Identity Domain, and its application's client id and secret. The API's bring-your-own path, until now Salesforce's alone, selects validation rules and endpoints by provider; it accepts only `identity.oraclecloud.com` hosts and requests `openid offline_access`, and the Host accepts only an HTTPS `oraclecloud.com` server URL.
- **Google beyond Gmail, Drive, and Calendar.** `google-tasks` (`tasks`), `google-contacts` (`contacts`), and `google-meet` (`meetings.space.created`, `meetings.space.readonly`) run through the same Workspace bridge with `GWS_SERVICES` set to `tasks`, `people`, and `meet`. All four scopes are sensitive, not restricted, so verification needs no CASA assessment. The bridge has no Meet tools of its own; its `workspace_raw` tool reaches the Meet API and verifies the grant with `conferenceRecords.list`. Chat and Keep need a Workspace administrator and YouTube is outside the bridge, so they are not offered.
- **Categories in the client.** `connector-categories.ts` maps every provider to one heading — Communication, Productivity, Development tools, Sales and marketing, Commerce and shopping, Financial services, the vocabulary of Claude's connector directory, with custom MCP servers last under Custom connectors because they can be anything — and the Connectors page lists each non-empty heading above its rows. The map is a `Record<ConnectorProvider, …>`, so adding a provider without a category fails the typecheck. Search narrows the rows inside each heading and hides headings left empty.

## Alternatives considered

- **Spotify** — its hosted MCP server authorizes through Spotify accounts, which registers no clients dynamically, and Spotify grants an app more than five allowlisted users only for registered organizations with at least 250,000 monthly active users, so Æven offers no Spotify connector.
- **Category on the Host's provider view** — the heading is presentation only; keeping it in the client avoids a wire field no other consumer reads.
- **One Google group** — readers look for Gmail beside the other mail connectors and Drive beside OneDrive, so Google providers sit under the headings their purpose names.
- **Full Gmail and Drive scopes** — restricted scopes need a yearly paid CASA assessment ([connector secrets](2026-10-07-connector-secrets-on-aeven-api.md)).

## Consequences

- The Host and the Aeven API ship together: a Host offering a provider the API does not know fails at sign-in.
- The four Google scopes must be added to the `aeven-connectors` consent screen and verified; until then a grant shows Google's unverified-app screen.
- Azure DevOps needs the Azure DevOps permission on the Aeven Microsoft application, and an organization whose policy blocks third-party applications refuses it. Oracle's documentation names neither the server host pattern nor required scopes, so both rules are checked at the first real tenancy.
