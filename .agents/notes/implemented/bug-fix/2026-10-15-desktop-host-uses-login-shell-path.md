# Agent Note: Desktop Host uses the login shell's PATH

Status: implemented

English | [中文](2026-10-15-desktop-host-uses-login-shell-path.zh.md)

## Problem

A desktop Host started by Aeven.app from the Finder or Dock ran with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, the minimal PATH macOS gives GUI applications. The `chrome-devtools-mcp` and Playwright MCP servers start through `npm exec`, so neither came up and the model had no browser tools for the Host's Chrome on port 9333; MCP servers the bundled Node.js starts by absolute path were unaffected. Shell commands also lacked Homebrew and other user-installed tools. A Host started from a terminal inherited the full PATH, so the failure appeared only after a GUI launch. On 2026-10-15 a session worked around the missing tools with a hand-written CDP script and saved that workaround to memory as a learned procedure.

## Decision

Before it starts or adopts a Host, the Electron shell runs the user's login shell once (`$SHELL -ilc`, falling back to `/bin/zsh` on macOS and `/bin/sh` elsewhere) and reads its PATH between markers, so output from startup files cannot corrupt the value. The login shell's entries go first, inherited entries it lacks follow, and duplicates are dropped; the result replaces `process.env.PATH`, which the Host and its children inherit. The query is limited to ten seconds. When it fails, the inherited PATH stays and the shell logs a warning. Windows applications inherit the user's PATH, so the query does not run there.

## Alternatives considered

**Prefix fixed directories such as `/opt/homebrew/bin`.** That misses version managers, pnpm, and every other location a user's shell configures.

**Bundle `chrome-devtools-mcp` and Playwright and start them with the bundled Node.js.** This would also work without a user-installed Node.js, but it does not repair shell commands, and it changes the seed and the MCP configuration; it remains a separate improvement.

**A maintained shell-environment package.** It would copy the whole environment rather than PATH alone and add a packaged dependency to the shell for about twenty lines of code.

## Consequences

A GUI launch finds the same tools as a terminal launch, so the browser MCP servers start when Node.js is installed. Startup waits for the login shell once, about 300 ms on the reporting machine. A shell whose startup files wait for input reaches the ten-second limit and falls back to the inherited PATH. Validation was limited to TypeScript, the repository build, and running the query from the minimal macOS GUI PATH at the user's request.
