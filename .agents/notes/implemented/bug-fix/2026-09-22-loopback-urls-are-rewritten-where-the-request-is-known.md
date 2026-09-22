# Agent Note: Loopback URLs are rewritten where the request is known

Status: implemented

English | [中文](2026-09-22-loopback-urls-are-rewritten-where-the-request-is-known.zh.md)

## Problem

A page served over one loopback spelling addressed deployment URLs written in another: a reader on `localhost:3060` was handed `http://127.0.0.1:9000` for the API, a different origin to the browser, so the session cookie did not travel and the session the page created was one it could never read back. The client repaired this after the fact in `sameSiteOrigin`, which only helps once the page is already on the reader's spelling and only for the URLs the client reads.

`webserver/index-inject` could not do better: the hook received the injection table but not the request, so a listener could only state the deployment's configured URLs.

## Decision

The event carries the request's origin. `collectIndexInjections(origin?)` and `renderIndex(html, origin?)` thread it through, `frontend-static` reads it from the request (`Host` plus `X-Forwarded-Proto`, because a TLS-terminating proxy leaves the socket unencrypted), and `identity-user-aeven` states each configured URL under that spelling before pushing its row.

`sameHostLoopbackUrl` moves only the hostname, only when the configured URL and the request are both loopback: ports and paths stay as configured, a real deployment and a provider's own domain pass through untouched, and a value that is not a URL is handed over as stated. It rebuilds the authority inside the configured string rather than through a parsed URL, because a round trip adds a trailing slash to an origin that carries no path.

The client keeps its own copy of the four loopback spellings for emissions with no request (the worker boot payload), and each side's tests name the same four, so a change on one side is visible when the other is read.

## Alternatives considered

Deleting the client rule was rejected: the worker boot payload has no request, so nothing would rewrite those URLs at all. Sharing one predicate was rejected as well: the client cannot import a Host package, and a browser value dependency on a util package would need a declared module request plus a supplier row for one four-element set. Suppressing the problem in the client instead was rejected because it cannot cover a bookmark, a second port, or a proxy.

## Consequences

- A page reached over `localhost` is now handed `http://localhost:9000` and one reached over `127.0.0.1` is handed `http://127.0.0.1:9000`, while `https://aeven.ai` and a provider domain are untouched; the client rule stays as an idempotent fallback.
- The event signature is additive: a listener that ignores the second argument keeps working.
- Tests: six cases on the injected config (both loopback spellings, the production pass-through, an emission without an origin, an unparseable value), `requestOrigin`'s header and socket semantics, and the composed server forwarding the origin to its listeners.
- Not covered yet: a request-level pair (`curl -H 'Host: …'` twice) against a running page server. The deployment on port 9000 serves the API rather than pages, so that check needs a second `avn web` instance.
