# Agent Note: Computer use mounts on Linux through the Cua Driver provider

Status: implemented

English | [中文](2026-10-15-computer-use-mounts-on-linux.zh.md)

## Problem

The Web and Electron compositions mounted computer use on macOS and Windows and nowhere else: [`packages/bundle/web-app/cordis.patch.yml`](../../../../packages/bundle/web-app/cordis.patch.yml) gated the `computer-use` service row and the `computer-use-cua-driver` row on `darwin` and `win32`, and each platform's row carried its own install layout for the driver. On Linux the packages sat installed in the desktop profile while no `cua-driver-mcp` MCP server served a Session, so a Linux Session had no `mcp__cua-driver-mcp__*` tools and no `computer_use_setup`, and installing the driver changed nothing because no row mounted it. The shipped Linux desktop adapter, [`@aeven/computer-use-linux`](../../../../packages/computer-use/computer-use-linux/README.md), is not a provider — nothing outside its own tests imports it — so it could not take the row's place.

## Decision

Both rows now mount on macOS, Windows, and Linux, and the driver row names all three install layouts: the CuaDriver application bundle on macOS, `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin\cua-driver.exe` on Windows, and `~/.local/bin/cua-driver`, the script location a user-level install writes, on Linux. `AVN_CUA_DRIVER` overrides any of them.

The absolute default is load-bearing. [`@aeven/computer-use-cua-driver-mcp`](../../../../packages/computer-use/computer-use-cua-driver-mcp/README.md) checks an absolute `command` before spawning and, when it is missing, registers only `computer_use_setup` carrying install guidance. A bare PATH name is spawned unchecked, so it would fail that entry's activation on a machine without the driver — the failure the macOS semantic-batch row already avoids by probing the driver path.

Linux mounts the driver's tool surface alone. Neither batch provider is available there: the macOS one needs Apple Events, the Windows one drives UI Automation and COM, and the Linux adapter that would back a third registers no provider, so no `computer_use_run` row is offered on Linux.

### Verification

- [`packages/bundle/web-app/tests/computer-use-rows.spec.ts`](../../../../packages/bundle/web-app/tests/computer-use-rows.spec.ts) resolves these rows the way the Loader does, per platform: the capability and its driver provider mount on `darwin`, `win32`, and `linux`; each platform's default and the `AVN_CUA_DRIVER` override resolve to the expected path; the macOS semantic batches stay off outside macOS or without a driver; and the Windows batches mount on Windows alone.
- The opt-in live check [`installed-driver.e2e.ts`](../../../../packages/computer-use/computer-use-cua-driver-mcp/tests/installed-driver.e2e.ts) passes on the Ubuntu 24.04 aarch64 guest against cua-driver 0.28.0 installed at `~/.local/bin/cua-driver`: it registers `cua-driver-mcp`, discovers the driver's tools, calls `check_permissions` with `prompt: false`, and releases the registration on dispose.

## Alternatives considered

**Mount the shipped Linux desktop adapter instead.** [`@aeven/computer-use-linux`](../../../../packages/computer-use/computer-use-linux/README.md) implements the desktop contract but registers no provider, so this route needs a new first-party package. On GNOME Wayland it also finds no window backend — no `hyprctl`, no `i3-msg`, and `wmctrl` cannot read a Wayland compositor — leaves the accessibility tree, clicks, and screenshots unimplemented, and reports blockers where the driver works.

**Default the Linux `command` to the bare `cua-driver` PATH name.** The provider spawns a PATH command without checking it, so a machine without the driver would fail the row instead of offering install guidance, which is why the macOS and Windows rows name absolute install locations.

**Leave the rows at macOS and Windows.** It left the desktop app's own Linux users without the capability even after installing the driver, with nothing visible saying a row was gated.

## Consequences

A Linux Session mounts the provider whenever a driver exists at the default or overridden path; without one, `computer_use_setup` names the missing path and the upstream guide, which is the discoverability the macOS and Windows rows already had. The Linux driver build is verified at 0.28.0, the version the provider pins in its `INSTALL_GUIDE`: the current upstream release, 0.35.4, rejects `check_permissions`'s `prompt` argument and advertises its own `browser_*` tools, so a newer driver changes the argument surface and duplicates the Playwright and Chrome DevTools MCP rows this bundle already mounts. Linux adds no batch provider, so its Sessions drive the driver's own tools only. The driver's own Linux permission requirements — input injection and an accessibility bus — are unchanged by this decision, and no other bundle inherits these rows.
