# Agent Note: Reverse-engineering setup installs in the background

Status: implemented

English | [中文](2026-10-19-reverse-engineering-first-request.zh.md)

## Problem

First-request setup for the installed `reverse-engineering` account skill ran inside the `agent/pre-step` listener of `@aeven/account-integrations`, awaited before `next()`. Every model request of every agent whose account enabled the skill therefore waited for a complete private toolchain install — a 570 MB Ghidra archive and a 200 MB JDK, `npm install rea-agents`, extraction, and a doctor run — under a 900 s budget. Any failure threw out of the listener, so the whole turn ended as `turn/end {reason: {kind: error}}`, and because the failed attempt deleted its staging directory the next turn downloaded everything again.

It failed on every run that reached it. The readiness gate treated a non-zero `rea doctor` exit as a setup failure, but the doctor exits non-zero for informational checks this integration never satisfies: optional engines (Hopper, IDA, jadx, Kuna), REA's own installed skill copy, and MCP registrations for other clients. A healthy Ghidra therefore could not pass, and the thrown reason was empty — `reverse-engineering setup failed (/path/to/node): ` — because the message carried only the child's stderr while the doctor's JSON report, which names the failing checks, is written to stdout.

One session in `$AVN_HOME/sessions` records the cost: its turn 11 completed normally, and turns 12 and 13 each ran about 130 s and ended with that empty error, re-downloading the archives. Every message in the conversation hung for two minutes and then failed.

## Decision

`agent/pre-step` starts the work and does not await it. `ReverseEngineeringRuntime.start(agent)` begins the shared install in the background, logs a failure through `ctx.logger('account-integrations')`, and records when it failed. A later request starts another attempt only after `reverseEngineering.retryDelayMs` (default 600 000 ms; zero retries on every request). No request fails because setup failed: the `mcp__rea__*` tools are connected for that agent once the install completes, and the skill's shell routes answer until then.

The shared install no longer inherits the first caller's request signal. `prepare` runs `install()` under the runtime's lifecycle and `timeoutMs` only, and a caller's `signal` ends that caller's wait without cancelling work shared with other agents.

The readiness gate parses the doctor's JSON report and requires the requested provider inspection, `ghidra`, to be `available` with no failing provider check. The process exit status is ignored, because informational checks always set it and they are not this deployment's readiness. A setup failure now carries the child's stdout and stderr, and a doctor that prints no parseable report is quoted in the error instead of leaving an empty reason.

## Enabling the skill installs the engine

Enabling the skill is the commit point for its cost. `setSkillEnabled` and `importSkill` call `ReverseEngineeringRuntime.warm()`, which starts the one installation every agent shares, while `agent/pre-step` keeps mounting it per agent. The first request after activation therefore has `mcp__rea__*` instead of starting the download it then waits behind.

Setup consults the host before it downloads anything. A `rea doctor --provider ghidra` run whose environment carries no `GHIDRA_INSTALL_DIR` or `JAVA_HOME` either certifies an engine the machine already has — the paths arrive in the report's `registrationEnvironment`, and one verified here costs twelve seconds — or the runtime fetches the Ghidra and JDK archives into `runtimes/reverse-engineering/archives/<sha256>`, where a later attempt reuses them instead of downloading 770 MB again.

Ghidra's release archive carries a native decompiler under `os/linux_x86_64` only, which is why the doctor's `native_decompiler` check failed on every macOS attempt. Setup now builds the one the decompiler's own Makefile describes, `make ghidra_opt ARCH_TYPE="-arch arm64" OSDIR=mac_arm_64`, measured at 20 seconds on an Apple Silicon host, and probes for `make` and `bison` before the download rather than after it.

## Alternatives considered

**Keep awaiting the install and only fix the doctor gate.** Rejected because the first request would still wait minutes for a download it may never use, and a genuine failure would still fail the turn.

**Ship the analysis toolchain with the app.** Rejected: the deployment does not ship REA or Ghidra, and the install is per-account and private to `$AVN_HOME`.

**Retry on every request after a failure.** Rejected because each retry repeats the full download the failed attempt deleted, which is what turned one broken setup into a two-minute cost per message.

**Ship Ghidra and the JDK inside the desktop app.** Rejected: the app is already large and this skill is optional, so 770 MB of analysis engine must never become every user's download.

## Consequences

- Enabling the skill installs behind the settings page, so the first request after it already has the tools. A machine whose Ghidra and JDK certify downloads only the REA package.
- A setup failure is visible only in the Host log, not in the conversation, so the transcript does not tell a person that the tools are unavailable or why.
- On darwin/arm64 the release archive ships no decompiler, so setup builds one from the sources the archive carries and therefore needs the Xcode command line tools; without them it fails with that reason rather than after the download.
- Enabling the skill downloads about 770 MB where no certifying engine exists, and nothing at all where Ghidra is already installed. Disabling it does not cancel a download already running.
