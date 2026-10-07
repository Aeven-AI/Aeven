# Agent Note: Every connector and identity secret lives on the Aeven API

Status: implemented

English | [中文](2026-10-07-connector-secrets-on-aeven-api.zh.md)

## Problem

The Host is not always a server Aeven operates. The Desktop application runs the `@aeven/web-app` bundle on the reader's own machine, and anything that process reads can be extracted from it. Three kinds of deployment secrets were read by the Host:

- `identity-user-aeven` verified access bearers and refresh cookies with HS256 against the Aeven API's own `JWT_SECRET` and `REFRESH_SECRET`. The API signs `{ userId }`, so holding either secret lets anyone mint a token for any user, including that user's wallet on `/v1`.
- `account-integrations` spent OAuth codes and refreshed grants with the Google and GitHub client secrets, and installed Discord with the Discord client secret.
- The Discord connector process received the shared bot token, which controls the bot in every guild every user installed it into.

A packaged Desktop build loads no `.env`, so these flows worked only from a repository checkout; making them work in a shipped build would have meant shipping the secrets.

## Decision

The Aeven API (`servers/node`) holds every one of these secrets, and the Host reaches them only through calls authenticated with the signed-in user's own Aeven access token (`AEVEN_TOKEN`, the credential `llm-aeven` already presents).

- **Identity.** The API signs access and refresh tokens with ES256 from `JWT_PRIVATE_KEY`, distinguishes them with a `typ` claim, pins `algorithms: ['ES256']` on verification, and serves the public key at `/.well-known/jwks.json`. `identity-user-aeven` fetches that key set at load and verifies locally, so the identity seam stays synchronous; a token naming an unknown `kid` starts a rate-limited refetch. The express-session cookie, which reused `JWT_SECRET`, now has its own `SESSION_SECRET`.
- **OAuth connectors (Google, GitHub).** The API's `/connectors` routes start the consent (state and PKCE verifier stay in `ConnectorConsent`), receive the provider redirect at `<web domain>/connectors/oauth/callback`, spend the code with the client secret, and store the grant encrypted in `ConnectorGrant`. The Host polls the consent from `list()`, which Settings calls when the window regains focus, then fetches an access token, verifies API access, and writes its row with the granted scopes. Before each step it asks the API for a current access token; the refresh token never leaves the API. Google connectors use a Google Cloud project separate from sign-in, so restricted-scope verification cannot affect signing in.
- **Discord.** The install consent goes through the same routes; the API confirms the bot joined and returns the guild. The connector process gets `DISCORD_API_BASE` pointing at the API's Discord proxy and `DISCORD_AUTHORIZATION: Bearer <owner session>`. The proxy forwards as the bot only when the path names the caller's guild, or a channel or invite Discord reports belongs to it. The bot leaves a guild only when no Aeven user still has it installed there.
- **Telegram.** The application identifiers are served to signed-in Hosts and cached in the Host's credential provider, so linked accounts start at boot. Every MTProto client must present them, so they cannot be kept from a client running on the user's machine; they identify the application and grant no account.

## Rejected alternatives

- **Embedding the secrets in the Desktop build** — extractable from any installed copy.
- **Verifying tokens by calling the API per request** — the identity seam resolves synchronously, and a public key gives the same guarantee with no request.
- **Running Discord tools on the API** — moves the MCP surface into another codebase; the proxy keeps the tool surface in `native/discord-mcp` and moves only the credential.
- **Running Telegram sessions on the API** — the API would hold full access to every user's Telegram account.

## Consequences

- A conversation step that runs while the owner has no live session on the Host leaves Google, GitHub, and Discord tools out of that step, and a Discord process restarts when the owner's session rotates.
- Switching to ES256 signs every user out once.
- Microsoft Graph connectors share one API-owned Entra application; work tenants may require administrator approval.
- Connector rows written before this change hold no `grant` and must reconnect.
