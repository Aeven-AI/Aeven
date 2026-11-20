# Agent Note: Jailed commands read the GitHub API through the egress proxy, never write it

Status: implemented

English | [中文](2026-11-20-jailed-commands-read-github-api-through-egress-proxy.zh.md)

## Problem

On Aeven Cloud a jailed command reached GitHub only through Git: the egress proxy forwards smart HTTP to `github.com` with the account's credential and asks the user before a risky push. `api.github.com` was not on the allow list, and a tunnel cannot carry a credential the jail must not hold, so `gh`, `watch-pr`, and every playbook that reads pull request state failed there.

## Decision

`egress.githubApi: { requestsPerHour }` adds a read-only GitHub API route to the proxy. `gh` speaks plain HTTP when `GH_HOST` is `github.localhost`, so the image's `gh` shim sets that host and a placeholder token, and the proxy forwards each request for `api.github.localhost` to `https://api.github.com/` with the account's `github.com` credential in place of whatever the request carried. Only REST `GET` and `HEAD`, other than on `/graphql`, and a `POST /graphql` whose document holds nothing but queries and fragments pass; every other method, a mutation, a subscription, `GET /graphql`, and a compressed or oversized GraphQL body are refused before anything reaches GitHub. Only allow-listed request headers are forwarded, so no method-override header reaches GitHub. Each account makes at most `requestsPerHour` requests per clock hour; hosted Aeven sets 1000.

## Security analysis

**Writes.** Granting the whole API would let code in a jail merge, delete, comment, or create gists with the user's token and no approval, around the push approval the proxy enforces, so the route is read only. Read-only GraphQL proxies elsewhere were bypassed by regular expressions that missed a `mutation` after a fragment, a comma, a byte order mark, a `#` comment, or an escaped `"""` in a block string. This proxy instead tokenizes the document by the GraphQL lexical grammar, refuses any character or token outside it, and classifies each definition by its first token at nesting depth zero. A differential run against `graphql-js` 16.9 over the published bypass shapes, mutations spliced into every position of valid queries, and one million random token sequences found no document the proxy accepts that parses as anything but queries and fragments, and no valid query it refuses; the 113 documents it accepts that `graphql-js` rejects are syntax errors GitHub refuses too.

**Credential.** The token travels from the provider to the proxy and on to `api.github.com` only, under the proxy's address check. Redirects are passed back rather than followed, with `api.github.com` locations rewritten onto the route, so the token never reaches another host; the forwarded response headers carry no credential.

**Reads.** The route reads what the account's token can read, which is wider than the GitHub connector's tool set: for example repository Actions variables and the user's private gists. That data reaches only the account's own conversation. Leaving it needs a write channel, and the jail's are approval-gated pushes and the allow-listed package and download hosts, which take no credential from the jail. Review text and issue bodies are untrusted input to the model, as they already are through the connector tools; `watch-pr` strips control characters from them.

**Rate limit.** A loop could spend the account's 5000 requests an hour that its connector tools share, so the per-account budget bounds it.

## Alternatives considered

**Full API with per-request approval.** The proxy can already ask in the conversation, but approving raw API calls one by one gives the user requests they cannot judge; the connector tools present writes as actions with their own approvals.

**A TLS-intercepting proxy for `api.github.com`.** `gh` would need no shim, but every jail would trust a local certificate authority whose key lives on the Host, and every tunnelled host would become interceptable.

**Pass the token into the jail.** One environment variable would make `gh` work, but any command, package script, or injected instruction in the jail could then use or exfiltrate the credential, which the Git route was built to prevent.

## Consequences

`gh` in a jail needs `--repo owner/name`, because Git remotes there point at the proxy. A refused write answers `403` with the reason, and an account without a GitHub connection answers `401`. The route depends on `gh`'s plain-HTTP handling of `github.localhost`; a `gh` release that drops it breaks the route visibly, not silently.
