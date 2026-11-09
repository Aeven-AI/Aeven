# Computer use on macOS

- Name an app by its name or bundle id (`com.apple.TextEdit`); `launch_app` opens it without bringing it forward.
- Use `invoke_menu` with the menu path for menu-bar commands.
- An Open or Save panel belongs to a separate process: `window_owner_pid_mismatch` names its `owner_pid`; target that pid.
- Text input into Catalyst apps can fail without an error, as in Electron apps (see the skill's Electron section): read the field back, and use the foreground fallback when it did not take.
- In the desktop app the permissions belong to Aeven; with a separate Cua Driver install they belong to CuaDriver.
