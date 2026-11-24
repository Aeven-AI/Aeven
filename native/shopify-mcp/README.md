# shopify-mcp

English | [中文](README.zh.md)

Aeven's Shopify connector server. The connector spawns one stdio MCP process per connected store, so a model working in one store reads and changes it through the Shopify Admin GraphQL API without ever naming a store in a tool call.

## One process per store

The connector passes the store and a short-lived Admin API access token in the environment. The token comes from the Aeven API, which holds the store's grant and refreshes it; a refreshed token restarts the process with the new one. stdout carries the MCP stream and nothing else.

## Environment

| Variable | Meaning |
|---|---|
| `SHOPIFY_SHOP` | The store's `<store>.myshopify.com` domain; any other host is refused, so the token is never sent elsewhere |
| `SHOPIFY_ACCESS_TOKEN` | Admin API access token for that store |
| `SHOPIFY_API_VERSION` | Admin API version, such as `2026-10` |
| `SHOPIFY_MAX_RESULT_BYTES` | Largest result text one call returns, at least 1024; a longer result is cut at a character boundary and says so |
| `SHOPIFY_REQUEST_TIMEOUT_MS` | Network budget of one Admin API call |

## Tools

| Tool | `readOnlyHint` | What it does |
|---|---|---|
| `get_shop` | true | The store's name, domains, currency, plan, and timezone |
| `describe_type` | true | One Admin GraphQL type's fields, arguments, input fields, and enum values, so the model writes valid documents |
| `graphql_query` | true | Runs a query document; a document defining a mutation or subscription is refused before any request |
| `graphql_mutation` | false | Runs a document defining exactly one mutation |

The connector runs a tool marked `readOnlyHint: true` without approval and asks before every other one. The read tool's refusal is what keeps that true: the classifier in `aeven/graphql.ts` reads every top-level definition of the document — skipping strings, block strings, and comments — instead of its first word, so a mutation after a query is found. A document it cannot read is refused by both tools.

Results carry the GraphQL `data`, `errors`, and `extensions` (with Shopify's query cost). A refused token, a rate limit, an HTTP error, or a result without `data` is returned as a failed call.

## Build and test

`pnpm --dir native/shopify-mcp run build` compiles `aeven/` into `dist/main.js`, which the connector spawns; the root `build:connectors` step runs it. The suites under `tests/` run with the repository's unit tests and drive the tools through an in-memory MCP client against a fake Admin API.

## Known Limitations and Deferred Work

- The classifier is a lexer over GraphQL's top-level structure, not a full parser, to avoid a GraphQL dependency for one decision; a document it cannot classify is refused, never run.
- Bulk operations and staged uploads go through `graphql_mutation` like any other mutation; the server adds no polling or upload helpers.
