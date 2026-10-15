# Agent Note: Desktop Host lifetime follows client leases

Status: implemented

English | [中文](2026-10-15-desktop-host-lifetime-follows-leases.zh.md)

## Problem

[One shared GUI Host per Aeven home](../bug-fix/2026-10-07-desktop-waits-for-booting-host.md) let a desktop-started Host outlive the shell: quitting Electron detached the child, which kept serving with no owner. On 2026-10-15 such a Host had run for over an hour with parent PID 1 while Aeven.app was closed. That Host runs the upstream Node.js executable inside the application bundle, so an update replaced the bundle beneath a running process; Windows refuses to replace a running executable at all. The next launch adopted the earlier Host, skipped the release reconciliation that only runs before a Host of its own starts, and rendered the earlier backend. The advertisement recorded neither the Host's version nor who owned it, so the shell could not tell. A Host that stays running should be visible, as an application in the menu bar is, not an invisible server on port 3080.

The fixed port had a related failure: when another program held 3080, the desktop Host failed to boot and the shell showed its startup failure window.

## Decision

The advertisement in `runtime/host.json` records `lifetime` and `avnVersion`. A desktop-started Host is `leased`; an `avn web` Host is `foreground`, belongs to its terminal, and stops only on that process's shutdown. The fields are optional on read and the record version stays 1, so earlier builds still read new records; a record without `lifetime` behaves as `leased`.

A `leased` Host stops when no lease remains. The launching shell's Node IPC channel is its lease, and quitting or crashing closes it. Any other process that renders the Host, such as a second desktop build on the same home, holds a client lease: a kernel file lock under `runtime/host-clients/`, released by process death. The Host counts client leases when its shell leaves and every two seconds while any remain. Browser tabs hold no lease: they stay open unattended and reconnect, so counting them would bring back the unowned Host. Before teardown a Host withdraws its URL from the advertisement, so a launch during teardown waits for the process to exit instead of attaching to a closing server. While its shell is connected the Host holds a client lease on the shell's behalf, so another launcher sees it in use. A Host that stops itself has no process left to kill it, so it exits after 15 seconds of teardown, the budget the shell's SIGTERM-then-SIGKILL sequence used. The `shutdown` command still stops the Host regardless of leases; updates and staged health checks use it.

Quitting while the Host reports a running agent turn and no other client lease asks for confirmation; cancelling keeps the application running and reopens its window on Windows and Linux. A packaged shell that finds a desktop-started Host serving another avn version with no client lease sends it SIGTERM, waits for the process to exit, and starts its own Host after reconciling the release. It adopts a leased or `foreground` Host of any version, and a development shell adopts any Host.

Run in the background, a General Settings row on by default, keeps the shell running with a menu bar or system tray icon after its last window closes; on macOS the Dock icon hides until a window opens. The running shell keeps its lease, so turns and automations continue until the user quits from the icon or the application menu. The choice lives in Electron's user-data directory because it describes this installation, not an account. See [the default-on decision](../feature/2026-10-15-background-mode-default-and-menu-bar-icon.md).

The webserver gains `portInUse`. With `fail`, the default, a held port rejects activation with an error naming the port. With `os-assigned`, the server listens on a port the OS picks. The desktop Host uses `os-assigned` and records `{ configured, bound }` in `runtime/desktop-port.json`; later launches request the bound port while the configured port is unchanged, so browser storage tied to the origin, including sign-in, survives a fallback. `avn web` falls back only when the invocation did not name `--port`.

## Alternatives considered

**Keep the detached Host and only add a version check.** The check fixes the stale backend after an update but still leaves an unowned process, still replaces a running executable during macOS updates, and still fails on Windows.

**Stop the Host whenever Electron quits.** That ignores another process that renders the same Host, which then loses its backend mid-turn.

**Hold leases through an authenticated HTTP connection.** A held connection releases the lease immediately on process death and needs no polling. In compositions with Aeven sign-in, the Host's API authenticates an account bearer rather than the launch token, so a non-browser holder has no credential to present. A file lock in the Aeven home relies on the same permissions that already protect `host.json`, which carries the launch token.

**Count connected browser tabs as leases.** A forgotten tab would keep the Host alive indefinitely, which is the defect being fixed.

**Fall back to a fixed list of ports.** Any listed port can be taken too; remembering the bound port is what preserves origin-scoped storage.

## Consequences

Closing Aeven with background mode off leaves nothing listening on 3080 unless another process holds a client lease or the Host belongs to an `avn web` terminal. An update stops the Host before replacing the bundle, and a later launch replaces any desktop-started Host from another release. On Windows, SIGTERM terminates that process without teardown. A shell rendering another process's Host cannot query running turns and quits without confirmation. A record whose holder crashed while its PID was reused counts as a lease until that process exits. The first fallback away from 3080 signs browser clients out once. Validation was limited to TypeScript, the repository build, and live checks on macOS at the user's request, using a development shell on a separate Aeven home while another Host held 3080: the Host fell back to an OS-assigned port and reused it on relaunch, kept serving after the shell quit while another process held a client lease, stopped about two seconds after that lease was released, and stopped within a second of a quit with no lease, removing its record and its MCP server children. Windows and Linux tray behavior, the running-work confirmation, outdated-Host replacement, crash release, and concurrent launch orders were not exercised.
