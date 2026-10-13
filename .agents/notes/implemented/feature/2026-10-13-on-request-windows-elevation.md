# Agent Note: On-request administrator execution on Windows

Status: implemented

English | [中文](2026-10-13-on-request-windows-elevation.zh.md)

## Problem

The harness could confine a process's file effects and could let a human widen that confinement for one call, but it had no way to run a single command with the host's administrator token. Windows gives a running process no mechanism to raise its own token, so elevation is always a new process created through the user-account-control consent prompt — and every path to it goes through a human. The [sandbox decision](2026-07-06-sandbox.md) named this axis as absent: its escalation vocabulary widens file effects only, and deliberately carries no privilege dimension. The operator asked for the missing half: to run a command as administrator from Aeven when they call for it, PowerShell or Command Prompt, on a clean install with nothing hand-installed.

## Decision

Ship one package, `@aeven/tool-elevation`, that registers the model-facing `elevated` tool on Windows: `shell` (`powershell` or `cmd`), `command`, a required `justification`, and an optional `timeoutMs`.

The tool asks `ctx.approval` first. The ask's session grant is scoped `privilege:standard->administrator` with `SessionGrantCoverage` `'privilege'`, added to the host union and to the client's `ApprovalSessionCoverage` with its own consent copy. Separation from `'sandbox'` is deliberate: a grant for wider file access must never authorize an elevated run. Any outcome other than `allowed-once` fails the call with `ELEVATION_DENIED` before anything spawns.

The run writes the command to a job file (`job.ps1` or `job.cmd`, UTF-8 without a byte-order mark because `cmd.exe` reads one as part of its first command word) in a fresh temporary directory, and spawns an ordinary PowerShell through `ctx.subprocess`. That PowerShell runs `Start-Process -Verb RunAs -Wait -PassThru` and exits with the elevated process's exit code, so the code returns like any child's. The elevated process has its own console, so its combined output travels through one file in the same directory; the directory is deleted after the read. A dismissed prompt makes `Start-Process` throw, which the launcher reports on stderr and the tool surfaces as `ELEVATION_DENIED`. The deadline and the call's abort signal both terminate the launcher. Nothing is installed or pre-created, so it works on a clean install.

## Alternatives considered

### A `ctx.elevation` capability seam with a platform backend

Built first and then removed. The seam had one consumer (this tool) and one backend (Windows), which is the "public service method with one internal caller" smell `packages/AGENTS.md` names. It cost two extra packages, a generated wrapper and launcher per run, a polled and re-validated result file, and an unused elevated-session protocol. A second platform or a second consumer is the point at which a seam earns its place.

### Widen `SandboxMode` with an `administrator` value

Rejected. File effects and token privilege are orthogonal facts: a `danger-full-access` call can still run unelevated, and a `read-only` call can still need the administrator token to change a machine setting. `WIDER_MODES` checks a request against one per-call file policy, so folding privilege into it would make the ladder lie about one of the two dimensions.

### Automate the consent prompt, or remove it

Rejected. The prompt is the mechanism, not an obstacle in front of it. With `PromptOnSecureDesktop = 1` the consent happens on a desktop where synthetic input is blocked, and no code path turns the *current* process elevated — the honest ceiling is: the harness asks, a human answers at the OS, and the work runs in a separate elevated process with a channel back. Lowering `ConsentPromptBehaviorAdmin` or disabling `EnableLUA` would remove the lock rather than fit the key, and needs elevation itself.

### A standing elevated runner

Rejected for now. One accepted prompt followed by silent elevated execution is convenient and durable, which is exactly the problem: it is a key any process running as the user can turn, for as long as it exists. The approval ask's session grant already covers the legitimate repeat case — the same elevation, in the same session, with the reader's explicit consent — and expires with the session.

### Return the elevated process's output through pipes

Impossible rather than merely rejected: a process created by the consent flow is not this process's child in any way that keeps its stdout reachable, and it owns its own console. A file the elevated side writes and the provider validates is the only channel that survives both facts.

## Consequences

Bought: elevation works on a clean install — no install step, no state carried between runs — and the model reaches it as one tool call behind two consents. The file-effect axis is untouched; a command that also needs wider file access still escalates through the sandbox lane, and the two consents are separate.

Cost and limits, owned by the package README: Windows only, and the tool is not registered elsewhere; one command per call; captured output keeps a configurable tail; a timeout terminates the launcher, not a command already running elevated, and cannot close a prompt already on screen; the job file lives in a directory the same user can write, so a compromised same-user process could swap it between consent and execution.

## Testing

No test files: this change was made under the operator's explicit instruction to exclude tests. `tsc -b packages/sandbox/tool-elevation` is clean. The script the elevated side runs was executed unelevated for both shells, from a directory whose path contains a single quote: a multi-line PowerShell job returned its `exit 7` and its stdout and error stream, and a `cmd` job returned its `exit /b 3` and its output. The `Start-Process -Verb RunAs` hop itself needs a human at the prompt; the mechanism was exercised by hand before the package existed, where an elevated `net session` reported `High Mandatory Level` against the calling shell's `Medium`. No snapshot covers the tool schema or the approval copy.

## Related

The [sandbox decision](2026-07-06-sandbox.md) owns the confinement axis and the escalation choreography this one mirrors; the [cross-family file sandbox decision](2026-07-14-cross-family-fs-sandbox.md) owns the shared policy home; the [Windows ACL restricted-token decision](2026-08-08-windows-acl-restricted-token-sandbox.md) owns the opposite direction on the same platform — restricting a child rather than raising one.
