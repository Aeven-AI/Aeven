# Agent Note: Computer use follows the driver's own guidance

Status: implemented

English | [中文](2026-11-09-computer-use-follows-the-driver.zh.md)

## Problem

Computer use ran through Cua Driver on macOS, Windows, and Linux, but the model drove it one action at a time. The MCP client dropped the usage instructions the driver sends when it connects, so the model never learned the driver's narrow reads, `run_steps` batches, diff re-reads, or checkpoint verification; the persona told it to look at the screen before and after every action instead. All 60 driver tools, about 55k tokens of schemas, were callable, including `kill_app`, `set_config`, and trajectory replay. The driver reported usage telemetry by default. The shipped macOS application ran the driver with `--direct`, which refuses the agent cursor. Nothing kept a foreground action from taking the screen while the person was typing.

## Decision

The MCP client keeps the `instructions` from each server's `initialize` result and reports them through `mcp/servers`; `tool_search` appends them to the first `select:` result that loads that server's tools after the agent starts or compacts, so they enter the session log as part of a tool result. A `computer-use` skill in the aeven preset carries the loop, platform notes, the steps to confirm first, and notes for chat apps, spreadsheets, documents, and media players; the persona keeps one line that points to it.

The provider admits a default allowlist of driver tools, sets `DO_NOT_TRACK=1` unless `telemetry` is on, refuses a driver older than `minimumVersion` with update guidance, passes `windowChangeTimeoutMs` and `keyGapMs` to the driver runtime, and reports the failing probes of `cua-driver doctor --json` from `computer_use_setup` on Linux and Windows. The desktop runtime pins Cua Driver 0.45.2.

On macOS an `embedded` driver now runs as a `serve --embedded` daemon that the provider starts as its own child on a private socket, with the MCP child connecting through `mcp --socket`. This reverses the alternative rejected in [the embedded-driver note](2026-10-16-desktop-ships-an-embedded-cua-driver.md): the daemon draws the agent cursor, and Aeven remains the responsible process for the permission checks. Windows and Linux keep `--direct`, where the cursor already draws.

A foreground driver call waits while the person has used their mouse or keyboard within `holdForegroundWhileActiveMs`, up to `foregroundWaitMs`, and is refused only when they keep going. A background key press resets the macOS idle timer, so input during or before any driver call counts as the driver's own. The unused `computer-use-linux` adapter is removed; Linux computer use is the Cua provider alone.

## Alternatives considered

**An activity bar with a Stop button and per-app approval prompts.** The turn's Stop button already cancels driver calls, and the person asked for no added interface; the driver's own cursor shows where the model acts.

**A debug-port route for Electron applications.** On Postman, background `type_text` through accessibility was refused while a debug-port `Input.insertText` worked without changing the frontmost application. It needs a relaunch of the person's application and either `agent-browser` (about 121 MB) or an owned client, so it waits for a failing real task; the skill routes Electron text through `set_value` and a check that the application reacted.

**Replacing Cua Driver with `agent-desktop`.** Measured on all three platforms, Cua used 5 to 15 times fewer tokens per task through batches and diff re-reads and is the only one that types into a background window on Windows; `agent-desktop` has no background pixel input.

## Consequences

The first `select:` of a server costs its instruction length once, and again after compaction. A driver release can change its tool names; names missing from the allowlist are ignored, and a new tool needs an allowlist entry. On GNOME Wayland the first foreground action raises a portal dialog that the person answers once; unanswered it ends in `foreground_timeout` after 12 seconds. Windows Office COM recipes remain unverified on a real host.
