# Agent Note: Windows computer use mounts through a first-party provider and a COM handler

Status: implemented

English | [中文](2026-10-15-windows-computer-use-provider-and-com-handler.zh.md)

## Problem

Computer use was reachable on macOS only. Every row of `packages/bundle/web-app/cordis.patch.yml` that mounts it carried `disabled: !!js "process.platform !== 'darwin'"`, and the driver row's `command` defaulted to the macOS bundle path, so a Windows host loaded with the capability, the adapter, and thirteen documented Office recipes present and none of them reachable. `@aeven/computer-use-windows` already implemented the desktop contract through UI Automation and PowerShell, and the recipe book already carried `mechanism: 'com'` entries for Excel, Word, and PowerPoint — with nothing anywhere implementing a COM handler, because `@aeven/computer-use-executor` implements the filesystem mechanism and every other mechanism arrives from a consumer.

The Cua Driver, which is the other way in, does ship Windows builds, and the two platforms install it differently: macOS puts `CuaDriver.app` in `/Applications` because LaunchServices attribution is what carries the Accessibility and Screen Recording grants, while the Windows installer writes `cua-driver.exe` under `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin` behind a junction chain and appends that directory to the user `PATH`.

## Decision

The composition admits `win32` for the registry and driver rows, and the driver path is chosen per platform: `AVN_CUA_DRIVER` when set, otherwise the Windows install layout or the macOS bundle path. The Windows default is an absolute path that exists only when the driver is installed, so an uninstalled driver degrades to the provider's install-guidance tool on both platforms instead of failing the tree through a spawn of a `PATH` command that is not there. A third row mounts `@aeven/computer-use-windows-provider` on `win32` with `register: false`, mirroring how the macOS provider mounts beside the driver.

`@aeven/computer-use-windows-com` implements the COM mechanism. It attaches to the running application with `Marshal::GetActiveObject` rather than launching one, because the book's Windows operations are written against the active instance — `ActiveDocument`, `Selection`, `Presentations` — and because PowerPoint refuses to run hidden, which a `New-Object` launch would have to satisfy. Values are embedded as PowerShell single-quoted literals, the one form that performs no interpolation. The wrapper saves the document to the caller's `path` through the host's own member unless the operation is itself a save or export, so the recipe's `fileExists` expectation can pass; an unknown operation, an unknown application, and a missing parameter are each refused by name before any program runs, and a non-zero exit reports PowerShell's own message.

`@aeven/computer-use-windows-provider` assembles the adapter, recipe book, executor, session, and COM handler into one row, claims the exclusive provider slot through the seam, and registers `computer_use_run` at `platform: 'win32'`. It publishes `ctx.windowsComputerUseProvider` rather than `ctx.computerUseProvider`, because Cordis declares a service by augmenting `Context` and one property cannot carry two provider types in one program; the seam's slot, not the property name, is what keeps a host to one provider.

`@aeven/computer-use-windows` re-exports `WinCommandResult` and `WinCommandRunner` from its root, which the macOS adapter package already did for its own runner, since the provider has to supply one.

## Consequences

A Windows host now loads the capability with two ways to drive it: the driver's own MCP tools under `mcp__cua-driver-mcp__*`, and semantic batches through `computer_use_run`. macOS is unchanged except that its driver path expression now reads through the same per-platform choice.

The COM paths are **documented, not verified**. The book tags those recipes `documented` and no test here has driven a live Excel, Word, or PowerPoint on Windows; the handler's tests assert the generated program and the dispatch behaviour against a recording runner, and the package README states what a Windows host with Office still has to establish. The coverage of the batch tool itself is partial for the same reason: the macOS provider's row has the same shape and its tool is exercised the same way.

A Windows installation of the driver is not finished by installing it: its GUI tools need a logged-on interactive session, which is what the installer's `-AutoStart` scheduled task provides, and the macOS equivalent of that requirement is the TCC grant held by the app bundle.

## Alternatives considered

### Mount the macOS provider on Windows and let its Apple Events path refuse

Rejected. The Apple Events handler speaks `osascript`, which does not exist on Windows, so every semantic task would fail for a reason that names the wrong platform.

### Launch the Office application instead of attaching to it

Rejected. The book's operations address `ActiveDocument`, `Selection`, and `Presentations`, which only exist on a running instance; and PowerPoint refuses `Visible = $false`, so a launched instance would have to be shown — the opposite of what an agent driving the desktop quietly should do.

### Resolve the Windows driver command through `PATH`

Rejected. The provider treats an absolute path that does not exist as "not installed" and registers only the install-guidance tool; a `PATH` command is not pre-checked, so a missing driver would fail at spawn and take the tree with it.

### Rename the macOS provider's context property to a shared name

Rejected. It would break every consumer of `ctx.computerUseProvider` and every document naming it, in exchange for a symmetry that the seam does not need: the registration slot already makes a host single-provider.
