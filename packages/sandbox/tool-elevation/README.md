---
description: "The model-facing `elevated` tool: how one call runs a command as administrator on Windows behind two consents, and what the model reads back."
kind: "package-reference"
---

# @aeven/tool-elevation

English | [中文](README.zh.md)

## Summary

`avn-tool-elevation` registers the `elevated` tool on Windows. One call runs one command as administrator, and the human decides twice: the harness approval this tool asks through `ctx.approval` before anything spawns, and the Windows user-account-control prompt after it. A refusal at either prompt fails the call; the command is never run at the model's own privilege instead. On other hosts the tool is not registered.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose it wherever the model should be able to reach for administrator rights. It needs `ctx.tools`, `ctx.approval`, and `ctx.subprocess`.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `timeoutMs` | `600000` | Default and maximum deadline for one elevated run |
| `maxOutputChars` | `100000` | Retained tail of the captured output; earlier output is dropped with a marker |

## Understand the implementation

### The two consents

The tool first asks `ctx.approval`. The ask offers a session grant scoped `privilege:standard->administrator` with coverage `'privilege'`, so a person can let the same elevation repeat for the session; a sandbox grant never covers it. Any outcome other than `allowed-once` fails the call with `ELEVATION_DENIED` before anything spawns.

### One run

`runElevated` writes the command to a job file (`job.ps1` or `job.cmd`, UTF-8 without a byte-order mark) in a fresh temporary directory, then spawns an ordinary PowerShell through `ctx.subprocess`. That PowerShell calls `Start-Process -Verb RunAs -Wait -PassThru` and exits with the elevated process's exit code, so the code comes back like any child's. The elevated process has its own console, so it writes its combined output to a file in the same directory, which is read and then deleted with the directory. A dismissed Windows prompt makes `Start-Process` throw; the launcher reports it on stderr and the call fails with `ELEVATION_DENIED`. The deadline and the tool call's abort signal both terminate the launcher; a timeout fails with `ELEVATION_TIMEOUT`.

## Further Exploration

- [@aeven/tool-pwsh](../../shell/tool-pwsh/README.md) — the sibling tool whose sandbox escalation offers a session grant the same way.
- [Agent note](../../../.agents/notes/implemented/feature/2026-10-13-on-request-windows-elevation.md) — why elevation is a tool and not a sandbox mode.

## Model Experience

### The `elevated` tool schema

#### What the model sees

The tool entry in the generated [tool catalog](../../../docs/tool-catalog.md#aeventool-elevation): its name, its description, and four parameters. The result is JSON with `exitCode` and `output`.

##### Verbatim parameter descriptions

```markdown
shell: "powershell" for a PowerShell command, "cmd" for a Command Prompt command.
command: The exact command text to run; multiple lines run as one script.
justification: One sentence, shown to the user, explaining why this command needs administrator rights.
timeoutMs: Deadline in milliseconds, at most 600000 (the default).
```

#### Token effect

Fixed: one tool entry on Windows hosts that compose this package, independent of any call.

#### KV Cache effect

Append-only: the entry is part of the request's tool list and is stable across turns. Adding or removing the package, or changing its configured deadline, rebuilds that list.

## Known Limitations and Deferred Work

- **A timeout stops the wait, not the command** — the elevated process is not this process's child, so a command already running elevated keeps running after the deadline.
- **The job file is user-writable** — it lives in the user's temporary directory, so a compromised process running as the same user could swap it between consent and execution.
- **One command per call** — repeated administrator work costs one consent pair per call unless the reader grants the session scope the approval ask offers.
- **Not covered by automated tests** — the Windows prompt needs a human; the generated scripts were exercised by hand.
- **No invariant companion** — No runtime invariant companion is published because the relation it owns, that nothing spawns before `ctx.approval` allows the run, is settled by the Windows user-account-control prompt and can be observed only on a Windows host with a person answering it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
