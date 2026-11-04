---
description: "Finds this device's Git executable: PATH first, except the macOS install-dialog stub, then each platform's standard install locations."
kind: "package-reference"
---

# @aeven/git-executable

English | [中文](README.zh.md)

## Summary

`findGit` returns this device's Git: the executable `PATH` resolves, unless it is the macOS `/usr/bin/git` stub that opens Apple's install dialog when the developer tools are absent, otherwise the first of the platform's standard install locations (Homebrew, the Command Line Tools, and Xcode on macOS; Git for Windows under the program directories; `/usr/bin` and `/usr/local/bin` on Linux). A desktop app's short `PATH` and a Git installed while the process runs both miss those locations, which is why [`@aeven/vcs-git`](../../vcs/vcs-git/README.md) and [`@aeven/workspace-git-sync`](../../workspace/workspace-git-sync/README.md) use it. The caller supplies the `PATH` lookup, so the package depends on nothing but Node built-ins.

## Table of Contents

- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Fixed locations** — a Git installed anywhere else is found only through `PATH`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No runtime invariant companion is published because this pure lookup owns no event stream or mutable runtime data.
