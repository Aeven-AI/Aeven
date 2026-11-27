# Agent Note: Web fetch on IPv4-only hosts

Status: implemented

English | [中文](2026-11-27-web-fetch-ipv6-on-ipv4-only-hosts.zh.md)

## Problem

On 2026-11-27 at 09:03 UTC the hosted Host on pink exited with status 1 and systemd restarted it. The last log entry was an unhandled `ENETUNREACH` `error` event on a `TLSSocket` from a `web_fetch` to a host that resolved to IPv6 and IPv4 addresses. pink has only a link-local IPv6 address and no IPv6 route. glibc's `AI_ADDRCONFIG` counts link-local addresses, so `getaddrinfo` still returns AAAA answers there. [`@aeven/web-fetch-http`](../../../../packages/web/web-fetch-http/README.md) pinned both families and let Undici's `autoSelectFamily` connect race them. A standalone reproduction on pink with an IPv6-first pinned set raised the same uncaught `ENETUNREACH` once in about fifteen runs; the earlier Oracle Host had the same IPv6 setup, code, Node release and unit configuration and never logged it.

## Decision

The default resolver of `resolvePublicAddresses` drops IPv6 answers when no local interface holds an IPv6 address outside loopback and link-local scope, read from `os.networkInterfaces()` on each resolution. The connection then never attempts an IPv6 destination the host cannot reach. Resolvers passed by tests are unchanged, and hosts with a routable IPv6 address keep both families and `autoSelectFamily`.

## Alternatives considered

**`dns.ADDRCONFIG` hints** were rejected: on pink (glibc 2.39) they still return AAAA answers because of the link-local address. **An IPv4 precedence rule in `/etc/gai.conf`** only reorders answers, applies to one machine, and leaves desktops on IPv4-only networks exposed. **Disabling `autoSelectFamily`** would make IPv6-first answers fail on hosts that do have IPv6.

## Consequences

On an IPv4-only host, a hostname with only AAAA answers fails resolution with `WEB_PROVIDER_ERROR` instead of a connection error. The race in Node's connection fallback remains reachable on hosts with a routable but broken IPv6 path; no reproduction exists for that case.
