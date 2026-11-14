---
description: "The Chromium the Host runs for browser surfaces: one remote debugging port, one shared profile, and the status a consumer reports."
kind: "package-reference"
---

# @aeven/browser-chromium

English | [中文](README.zh.md)

## Summary

`@aeven/browser-chromium` starts and addresses the Chromium a deployment's browser surfaces drive. It launches the configured executable on a remote debugging port with a dedicated profile and without `--enable-automation`, then reports the endpoint once that port answers. A browser already answering there is brought to its current tab instead of started again, one profile serves every session so a site signed in once stays signed in, and concurrent callers wait on the launch already in progress. When config names an MCP server, a call to one of its tools makes sure the browser answers first. `status()` samples whether a browser is running and whether one could be launched, without starting anything.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount it on a Host that serves a browser surface, such as the sidebar browser. `port` is required and must be the port chrome-devtools-mcp is given as `--browserUrl`; `executablePath` falls back to `AVN_CHROME_PATH` and then to a platform install, and a Host that finds no browser stays up with a warning. `userDataDir` defaults to `<AVN_HOME>/runtime/chrome-profile`, `mcpServerName` defaults to `chrome_devtools` (empty disables the launch-on-call), and `launchOnStart` starts the browser during plugin start. The driving tools act with the profile's signed-in sites, so a send-like call on a website asks the person first: a `click` on a button or menu item whose label is a publishing verb (Send, Post, Create, Submit, Reply, Comment, Share, Connect, and their Dutch, Spanish, German, French, and Chinese forms), a `click` on an element it has not seen in a snapshot, `click_at`, `press_key` or `type_text` with Enter and no Shift, `type_text` with a line break, and an `evaluate_script` that sends a POST, PUT, PATCH, or DELETE request, or that clicks, dispatches events, or submits while its source names a publishing verb; a script that only reads runs without asking. Typing, filling, reading, and navigating run without asking, and pages served from this machine never ask. The approval offers "Allow for this session" per site, and that grant also covers the sidebar `preview_*` tools on the same site. The publishing-verb rule is exported (`isSendControl`, `isSendKey`, `isSendScript`, `pageSite`, `sendApproval`) so every browser surface classifies sends the same way.

## Model Experience

### Host browser surface

#### What the model sees

No prompt text, and no tool of its own. Its facts reach the model through consumers — `preview_status` reports `browserUrl`, `running`, `launchable`, and `toolPrefix` — and the tools behind `toolPrefix` belong to the MCP server that drives the browser. A send-like call the person rejects returns the tool runtime's rejection as that call's error result.

#### Token effect

None of its own; its facts cost tokens only inside a consumer's tool result.

#### KV Cache effect

None; the package contributes no request-time text.

## Known Limitations and Deferred Work

- **No invariant companion** — No runtime invariant companion is published because every fact it reports is sampled from the same debugging endpoint it launches, so a check would read the port the implementation already reads.
- **One profile is shared by every session** — a site signed in once stays signed in, so a reader who wants a signed-out browser clears the profile directory.
- **The send gate reads labels, not intent** — a publishing control with an unlisted label, such as an icon-only button with no accessible name, runs without asking, and a non-publishing button labelled with a listed verb asks. It learns targets and page addresses from the tool results it observes, so after a Host restart a click asks until the model takes a snapshot again.
- **A missing browser fails the call, not the Host** — plugin load logs a warning when it finds no executable, and the tool call then fails naming the port nothing answers on.

### Dev Note

None.
