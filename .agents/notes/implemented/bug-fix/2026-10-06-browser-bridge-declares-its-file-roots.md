# Agent Note: The browser bridge hands over the files the Host user has

Status: implemented

English | [中文](2026-10-06-browser-bridge-declares-its-file-roots.zh.md)

## Problem

The Chrome DevTools MCP tools refused every file path outside the OS temp directory. On 2026-10-06 a session attaching a generated image to a LinkedIn draft could not do it: `mcp__chrome_devtools__upload_file` answered `Access denied: path /Users/Mac/Downloads/meat-proxy.jpg (canonical: ...) is not within any of the configured workspace roots`, and answered the same for a path inside the workspace it was working in. `take_screenshot`'s `filePath` failed the same way, so a session could not even save a capture. The session finished the job by speaking CDP directly — `Page.setInterceptFileChooserDialog`, a synthetic click on the page's own media control, `DOM.setFileInputFiles` — machinery no session should have to hold.

The cause is a default in the server's own path guard, not in the browser. `chrome-devtools-mcp` validates every path against its MCP roots, and `McpContext.roots()` answers the roots the connecting client negotiated plus `os.tmpdir()`. `@aeven/mcp-client` constructs `new Client(..., { capabilities: {} })`, which declares no capabilities, so the server's `roots/list` request never resolves, the client roots stay undefined, and the guard falls back to the temp directory alone. The server announces that fallback on stderr at initialization; [the host console note](../architecture/2026-08-29-host-console-is-the-hosts.md) had already quoted the line while measuring something else.

## Decision

The `mcp-chrome-devtools` row in the web-app bundle passes `--workspace` naming the Host user's home directory, read from `process.env.HOME ?? process.env.USERPROFILE`. The browser bridge may hand over everything under the account that runs it — Downloads, Desktop, the workspace directory, `~/.aeven` — and nothing outside it: system paths, other accounts' homes, and mounted volumes stay refused.

Upstream deprecates `--allow-unrestricted-paths` in favour of `--workspace=/`, and that replacement does not work. The containment check accepts a path that equals the root or begins with `root + path.sep`, which for `/` builds the `//` prefix, so no real path can ever match it. Verified against the running server: `--workspace=/` reproduced the denial, while `--workspace=/Users` and `--workspace=$HOME` both answered `File uploaded from /Users/Mac/Downloads/meat-proxy.jpg.`

## Testing

`packages/bundle/web-app/tests/browser-bridge-roots.spec.ts` pins the row: the flag and its computed value, the absence of both `--allow-unrestricted-paths` and `--workspace=/`, and the expression's resolution from `HOME` and from `USERPROFILE` when `HOME` is unset. Dropping the two argument lines fails two of its three cases, so the spec fails with the defect rather than next to it.

The behavior was measured against the real server before the spec existed, by spawning `chrome-devtools-mcp` over stdio the way `@aeven/mcp-client` does — declaring no roots capability — opening a page carrying a `file` input, snapshotting it for a uid, and calling `upload_file` with `/Users/Mac/Downloads/meat-proxy.jpg`. Without the flag the call answers `Access denied: path /Users/Mac/Downloads/meat-proxy.jpg (canonical: ...) is not within any of the configured workspace roots`; with `--workspace=$HOME` it answers `File uploaded from /Users/Mac/Downloads/meat-proxy.jpg.` The `--workspace=/` run reproduced the denial against the same server version (1.10.1) and the same browser on port 9333, which is what identified the `//` prefix as the cause.

`pnpm run verify-cordis-config` passes the patched bundle config. The computed argument is an array element carrying `!!js`, which the Loader resolves in the row's own fiber — the arrangement the SDK snapshot configs already use for their own computed argument lists.

## Alternatives considered

**`--allow-unrestricted-paths`.** It restores the pre-guard behavior exactly and is the flag the server's own warning suggests, but upstream marks it deprecated, so it is a line to remove at the next upgrade rather than a decision to keep.

**`--workspace=/`.** Upstream's stated replacement, and the value a reader would reach for. It cannot match a path at all, as measured above. Taking upstream's advice here would have looked correct and changed nothing.

**Give `@aeven/mcp-client` a `roots` capability and answer `roots/list`.** This is the protocol-shaped fix, and it puts one root list in the client every MCP server would then share. It also makes each server's file access depend on an opinion the client forms about the Host's filesystem, which is a policy the client has no basis for; the row that knows it is launching a browser bridge is the row carrying the root.

**`--workspace=/Users`.** Passes, and covers a macOS deployment. It is a platform literal in a config the project builds for macOS, Linux and Windows, where the same account data lives under `/home` and `C:\Users`.

**Keep using CDP from the session.** It worked, and it costs every future session the same twenty minutes and the same hand-written interception, with the failure reading as a tool being broken rather than a server default being wrong.

## Consequences

Uploads and screenshot writes now cover the files a session actually handles, and the server's initialization warning about unnegotiated roots no longer fires. What the guard still refuses is everything outside the Host user's own account, so an upload from a mounted volume needs the row's `--workspace` extended rather than a session workaround.

The guard was never the boundary that protects the machine: the row spawns `chrome-devtools-mcp@latest` from npm as the Host user, and the filesystem policy that bounds the agent's own file and shell tools is [`@aeven/fs`](../../../../packages/fs/fs/README.md) and its sandbox, which this row does not consult. Naming the account directory keeps the upstream check meaningful — a path outside it is still refused — without pretending it is a security control.

A Host picks this up at its next boot: the row is spawned once when the bundle loads, so a running Host keeps the old arguments until it restarts.
