---
description: "Desktop update popup: the Electron shell's release-stream state, its download progress, and the restart question the reader answers before Aeven replaces itself."
kind: "package-reference"
---

# @aeven/client-ui-update

English | [中文](README.zh.md)

## Summary

This package renders the Desktop update popup: one `shell.overlay` entry that mirrors the Electron shell's release stream — a check in progress, a release downloading, a release ready to install, an install under way, or a failure — and asks the reader before Aeven restarts to install. The shell owns the stream: it checks the GitHub release feed, downloads the signed release while the reader keeps working, and performs the swap, while this package publishes the shell's states and sends back the reader's three answers (check again, restart and install, dismiss). The same client served over HTTP has no preload carrier, so it registers nothing and shows nothing.

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

Mount this plugin in a client the Electron shell renders. The application menu's **Check for Updates…** opens the popup and starts a check; a release that downloads in the background opens it once, when the download finishes. While a check or download runs the popup shows the shared loading mark with the release it is working on, and once the release is on disk it asks **Restart and install** or **Later**. Nothing installs on quit: quitting without that answer leaves the running release in place.

Only a packaged, signed application can install a release; an unsigned build or an unpackaged development run reports the newest release or the failure and offers no restart.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package contributes one entry to `shell.overlay` (`UpdatePopup`). The Electron preload exposes `window.avnDesktop.update` (`get`, `check`, `install`, `onChange`) and the application-menu subscription; the plugin subscribes to the shell's published states in `apply` and writes them into one entry-declared store, which the renderer binds as the component's `useUpdate` hook. `update-carrier.ts` mirrors the shell's state union, and `update-store.ts` holds the two facts the popup renders: the last published state and whether the reader has it open. A failed `get` or `check` keeps the popup on the state it already showed, because the shell's own states arrive on their own channel. The shell's signalling and the restart decision are owned by [Desktop updates](../../../.agents/notes/implemented/feature/2026-10-16-desktop-automatic-updates.md).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@aeven/desktop`](../../../apps/desktop/README.md) — the Electron shell that owns the release stream, the download, and the install.
- [ui-settings-general](../ui-settings-general/README.md) — the other Desktop-only surface, which also reads a preload carrier.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders the shell's release state for a human and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The popup shows what the shell reports and nothing more** — download size, transfer speed, and the remaining time are not in the shell's state, so the popup cannot show them.
- **A release that installs while the reader is away reports nothing on return** — the install relaunches the application, and the new process starts with an empty stream; the popup has no history to show.
- **Only one release surface exists** — a release found by an automatic check opens the popup when it finishes downloading. There is no separate indication in the application chrome while the download runs.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The preload contract is `apps/desktop/src/ipc.ts` (`AvnDesktopUpdateApi`); `update-carrier.ts` restates it structurally because the shell is an application, not a package the client can import. Keep the two in step when a phase or field changes.

</details>

**Runtime invariant:** No companion is published. The package projects the shell's published states onto one overlay entry and owns no cross-plugin mutable state; its single slot registration proves disposal through the HMR-safety spec.
