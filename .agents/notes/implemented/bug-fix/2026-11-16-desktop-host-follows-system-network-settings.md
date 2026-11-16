# Agent Note: the desktop Host follows the system proxy and certificate store

Status: implemented

English | [中文](2026-11-16-desktop-host-follows-system-network-settings.zh.md)

## Problem

On a business network, a desktop user could neither chat nor sign in, while the hosted web version worked from the same machine. The API's access log showed token refreshes from the desktop renderer, which reach Aeven through Electron's session, and no request at all from the Host: no inference, no connector calls, no sign-in verification. The renderer's requests go through Chromium, which follows the system proxy settings, PAC scripts, WPAD, and the operating system's certificate store. The Host runs under the bundled upstream Node.js, whose `fetch` connects directly and trusts only Node's bundled roots. A network that requires a proxy, or inspects HTTPS by re-signing certificates with a root its administrators installed in the system store, therefore lets the renderer through and stops every Host request.

## Decision

- `DesktopHostProcess` starts the Host with `NODE_USE_SYSTEM_CA=1`, so TLS trusts the operating system's certificate store in addition to Node's bundled roots. Node.js children the Host starts inherit the variable.
- Desktop Host protocol version 7 adds one question and one answer on Node IPC. The Host sends `{ type: 'resolveProxy', id, url }` for an `http:` or `https:` URL; the shell answers `{ type: 'proxy', id, routes }`. `apps/desktop/src/system-proxy.ts` turns `session.defaultSession.resolveProxy(url)`, the session that sign-in and every renderer request use, into ordered routes: `PROXY`, `HTTPS`, and `SOCKS5` entries become `http:`, `https:`, and `socks5:` proxy URLs (a `SOCKS5` entry without a port gets 1080), `DIRECT` becomes `null` and ends the list, and `SOCKS`/`SOCKS4` (SOCKS version 4), QUIC, and entries with credentials or a path are dropped. A failed resolution answers `[null]`.
- `apps/desktop-host/src/system-proxy.ts` installs a global undici dispatcher before the first plugin mounts. Each non-loopback request waits for its routes and goes to one direct agent or a proxy agent per proxy URL. For a `socks5:` route undici's `ProxyAgent` uses its SOCKS5 agent, which sends the destination hostname for the proxy to resolve, as Chromium's SOCKS5 does; undici marks that agent experimental and prints one `ExperimentalWarning` on first use. Loopback destinations connect directly without asking. While the shell's IPC channel is closed, as when the Host keeps serving after the shell quit, every request connects directly.
- Fallback follows Chromium's. A request that fails to connect (`ECONNREFUSED`, `ETIMEDOUT`, `EHOSTUNREACH`, `EHOSTDOWN`, `ENETUNREACH`, `ENETDOWN`, `ENOTFOUND`, `EAI_AGAIN`, `UND_ERR_CONNECT_TIMEOUT`) before undici's `onRequestStart` moves to its next route with its body unread. The proxy it could not reach moves behind the other routes for five minutes, Chromium's own bad-proxy delay, and reaching it again clears the mark. A proxy that answers, even with a refusal or a reset, keeps the request.

## Alternatives considered

**Resolve the system proxy once when the shell starts the Host and pass it as `HTTPS_PROXY`.** Rejected: the environment is fixed for the Host's lifetime. A laptop that leaves the office would keep sending every request to a proxy it can no longer reach, which breaks a user who works today. A PAC script can also choose a different proxy per destination, which one variable cannot express.

**Read macOS proxy settings with `scutil --proxy` in the Host.** Rejected: it would leave PAC and WPAD evaluation to the Host and need a separate reader on Windows and Linux. Chromium already evaluates all of them, caches PAC results, and re-reads settings when the network changes.

**Send the Host's Aeven API requests through Electron's network stack.** Rejected for this change: it would also cover proxy authentication (NTLM, Kerberos), but it needs a second streaming transport from the Host into the shell for inference and uploads, and it would cover only Aeven's own endpoints, not connectors, web search, or MCP servers.

**Take only the first usable PAC entry.** Rejected after end-to-end testing: a company PAC usually ends in `PROXY corp:8080; DIRECT`, and away from the office the proxy cannot be reached. Chromium then connects directly; without fallback the Host would fail where it worked before this change.

## Consequences

- A network that requires a proxy, chosen by fixed settings, PAC, or WPAD, or that inspects HTTPS with a root installed in the system store, no longer separates the Host from the renderer.
- Each non-loopback Host request adds one IPC round trip to the shell before it connects.
- Not covered: a proxy that requires authentication, a SOCKS version 4 proxy (the Host moves to the next route, and connects directly when none is left), callers that pass their own dispatcher (the web-fetch tool's pinned direct transport), and Node.js children, which receive no proxy environment. A firewall or endpoint agent that blocks the bundled `node` executable itself is outside this change.
- `apps/desktop/tests/system-proxy.spec.ts`, `apps/desktop/tests/host-process.spec.ts`, and `apps/desktop-host/tests/system-proxy.spec.ts` cover PAC parsing, the IPC exchange, routing per request, fallback with a request body, the bad-proxy delay, SOCKS5 tunnels through an RFC 1928 test server, and Node's built-in `fetch` through the global dispatcher.
