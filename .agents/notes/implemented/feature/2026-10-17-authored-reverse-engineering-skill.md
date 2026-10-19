# Agent Note: The reverse-engineering skill is written here and installs from Settings

Status: implemented

English | [中文](2026-10-17-authored-reverse-engineering-skill.zh.md)

## Problem

Aeven had no skill for reading software whose source the person does not have. Asked how a shipped app implements a feature, which toolchain and dependencies a binary carries, or what two builds differ in, a session improvised the routing every time: identify the format, take the cheapest inventory, then slice only the code that answers. That work is the same on every target, and getting it wrong is expensive — a full disassembly dumped into context answers nothing a targeted `rg` over one function would not.

The catalog offered a third-party instruction file for the same work. It reaches an account only after someone finds it in Settings, its commands address another harness's surfaces, and redistributing its text carries a copyright notice that a model-visible file then owes its reader.

## Decision

`packages/skill/skill-catalog/authored/reverse-engineering/SKILL.md` is the skill, and it ships through the catalog: Settings lists it under the `reverse-engineering` category, installs it into the signed-in account's library, and removes it again. [The catalog-source note](../process/2026-10-17-skill-catalog-extra-sources.md) owns how an authored directory becomes an installable bundle.

The skill supplies instructions whose routes name a `rea` tool first and the shell command available when a provider engine is missing. [First-request setup](../bug-fix/2026-10-19-reverse-engineering-first-request.md) owns the private installation and agent-scoped MCP connection; every `mcp__rea__*` tool waits behind `tool_search`.

The body routes by artifact — native binaries, Go, Rust, .NET, Electron and JavaScript trees, APKs, firmware, Hermes and bytenode, WASM and EVM bytecode, SQLite, packet and web captures, core dumps, browser pages — with one route only the server answers: pseudocode, callers and callees for a single function. The rules that make an answer checkable sit beside the routes: evidence marked seen or inferred and cited by file offset, symbol, or the tool's evidence id; a copy to work on; probes batched into one shell call; code read one function at a time; and each result's stated limitations read rather than assumed away. Where static reading cannot answer, the skill sends the session to runtime observation, and to computer use for a screen or a native dialog.

A second authored entry, `leanrea`, ships beside it: the shell-only fast path for a session where nothing is mounted, with the same rules and no server in the loop. The two are separate catalog entries because they answer the same question with different instruments; installing one does not install the other.

The file is written in this repository against Aeven's own surfaces; the one outside name it carries is the tool server it drives.

## Alternatives considered

**Vendor the third-party skill file under an Aeven name.** MIT permits the copy and requires carrying its copyright notice, which the model-visible file would then owe its reader; its commands also assume a harness Aeven does not run. Writing the body here costs the work of authoring it and leaves one owner for the routing table.

**Reimplement the decompiler bridges here.** Hopper, Ghidra, IDA, JEB and Kuna share no API, so a native analysis layer means five adapters and an evidence ledger to maintain against five vendors' releases. The server is MIT and maintained upstream, so this repository takes it as a dependency rather than building a worse copy.

**Mount the server as the only path.** A session that never reads a binary would still wait on a child process, and every format a shell command answers would pay a round trip through an analysis server. Mounting it beside the skill keeps the cheap path free and the expensive one invisible until `tool_search` asks for it.

**Ship it as a preset skill.** The `aeven` composition mounts `presets/aeven/skills/` into every session, so a preset skill is always on and Settings cannot turn it off. A person deciding whether a session carries reverse-engineering instructions is the choice this skill has to preserve.

**Split the routing table into one reference file per format.** Per-format guides would keep each file shorter and let a session read only its own format. The catalogue of routes is what a session needs before it knows the format, so splitting spends a second call to discover which file to read, and a skill nobody opens twice saves nothing.

## Consequences

The skill costs nothing until someone installs it and loads it: the catalog offers it to every account, and one install brings its description and instructions into the sessions of that account alone.

An enabled account starts installing the native analysis runtime on its first request and connects a REA child process for each requesting agent once setup completes. The install runs in the background, so a request never waits for it and a setup failure never fails one.

Its commands are this repository's to keep current. Tool flags move — a `jadx` mode, an `otool` option, a `tshark` field name — and nothing upstream tells us when, so a stale row is corrected here and the sync carries the correction to Settings.

## Deferred

Nothing compares the authored directory with the bundle it produces. Editing `SKILL.md` without re-running `scripts/sync-skill-catalog.ts` leaves Settings serving the previous text, and no gate notices, because every existing catalog check reads the bundle as the authority. A comparison needs the same `zip` toolchain the sync uses, which no current gate depends on.
