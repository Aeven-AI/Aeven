# Computer use on Windows

- Packaged apps launch by app id: `launch_app` with `aumid`, such as `Microsoft.WindowsCalculator_8wekyb3d8bbwe!App`, `Microsoft.WindowsNotepad_8wekyb3d8bbwe!App`, `Microsoft.Paint_8wekyb3d8bbwe!App`, `Microsoft.WindowsTerminal_8wekyb3d8bbwe!App`, or Settings `windows.immersivecontrolpanel_cw5n1h2txyewy!Microsoft.Windows.ImmersiveControlPanel`. `Get-StartApps` in PowerShell lists the others.
- A packaged app's window belongs to `ApplicationFrameHost`; use the `window_id` from `list_windows` rather than the app's own pid. When a fresh launch shows no window yet, list the windows again.
- Prefer element tokens: a pixel click on a packaged app can report `route: "synthetic_events"` and change nothing.
- Windows blocks input into an app running as administrator from a normal app; ask the person to do that step.
- Chrome and Edge pages take the driver's browser tools; Firefox pages do not.
- LibreOffice ignores keys sent in the background: use the foreground fallback, or write the file and open it.
- Empty trees and blank screenshots mean the driver cannot see the desktop; call `computer_use_setup`.
