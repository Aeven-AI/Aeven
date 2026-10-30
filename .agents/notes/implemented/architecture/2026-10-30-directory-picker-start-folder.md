# Agent Note: The native directory picker opens at the folder its caller names

Status: implemented

## Problem

`ctx.directoryPicker`'s native capability was `pick(signal)`: a chooser request
carried no starting directory. macOS and Windows answer that with the folder
their dialog used last, so the web GUI's **Link workspace** action opened the
second Workspace's chooser at the first Workspace's folder — the operator saw
their previous pick instead of the Workspace they were linking. The browse
backend started at the host home directory for the same reason: nothing in the
seam could say where to begin.

## Decision

The seam carries the starting directory, and the caller that knows it supplies it.

- `DirectoryPickerPickOptions.directory` joins the native `pick(signal, options?)`.
  Omitted, the platform decides exactly as before.
- The picking Remote (`workspace-controller` `directoryPicker/pick`) takes the
  directory as its first argument, mirrored by `uiWorkspace.pickDirectory(directory?)`.
- The workspace browser passes the row's own `path` when it is a folder
  Workspace, and nothing when the Workspace has no directory yet.
- Each backend maps it natively: an AppleScript `default location (POSIX file …)`
  on macOS, `--filename` for Zenity, the directory argument for KDialog, and
  `SHCreateItemFromParsingName` + `IFileDialog::SetFolder` in the Win32 worker.
- A directory that no longer exists leaves the platform default instead of
  failing the pick: the folder is a hint, and a stale record must not cost the
  operator the chooser.

## Alternatives considered

- **Remember the last pick in the client and reopen there.** Reproduces the
  complaint for every Workspace that has never been linked, and the memory is
  per browser rather than per device.
- **Apply the pre-selection in the browse UI only.** An in-app browser can start
  anywhere, but the native chooser is what the reporting operator uses, and the
  default folder would stay the previous Workspace's.
- **Start at the current Session's workspace.** Right for one row, wrong for
  the row being linked, and it hides the mistake rather than fixing it.

## Consequences

`pick()` now takes an options bag, so further opening hints extend the same
object without another signature change. The browse flow still starts at the
host home; giving the in-app browser the same start folder is separate work in
`ui-directory-picker-browse`.
