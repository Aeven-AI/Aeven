---
description: "The Chromium the Host runs for browser surfaces: one remote debugging port, one shared profile, and the status a consumer reports."
kind: "package-reference"
---

# @aeven/browser-chromium

English | [中文](README.zh.md)

## Summary

`@aeven/browser-chromium` starts and addresses the Chromium a deployment's browser surfaces drive. It launches the configured executable on a remote debugging port with a dedicated profile and without `--enable-automation`, then reports the endpoint once that port answers. A browser already answering there is brought to its current tab instead of started again, one profile serves every session so a site signed in once stays signed in, and concurrent callers wait on the launch already in progress. When config names an MCP server, a call to one of its tools makes sure the browser answers first. `status()` samples whether a browser is running and whether one could be launched, without starting anything.

## Use this package

Mount it on a Host that serves a browser surface, such as the sidebar browser. `port` is required and must be the port chrome-devtools-mcp is given as `--browserUrl`; `executablePath` falls back to `AVN_CHROME_PATH` and then to a platform install, and a Host that finds no browser stays up with a warning. `userDataDir` defaults to `<AVN_HOME>/runtime/chrome-profile`, `mcpServerName` defaults to `chrome_devtools` (empty disables the launch-on-call), and `launchOnStart` starts the browser during plugin start.

## Model Experience

### Host browser surface

#### What the model sees

Nothing directly: this package registers no tool and no prompt text. Its facts reach the model through consumers — `preview_status` reports `browserUrl`, `running`, `launchable`, and `toolPrefix` — and the tools behind `toolPrefix` belong to the MCP server that drives the browser.

#### Token effect

None of its own; its facts cost tokens only inside a consumer's tool result.

#### KV Cache effect

None; the package contributes no request-time text.

## Known Limitations and Deferred Work

- **No invariant companion** — No runtime invariant companion is published because every fact it reports is sampled from the same debugging endpoint it launches, so a check would read the port the implementation already reads.
- **One profile is shared by every session** — a site signed in once stays signed in, so a reader who wants a signed-out browser clears the profile directory.
- **A missing browser fails the call, not the Host** — plugin load logs a warning when it finds no executable, and the tool call then fails naming the port nothing answers on.
