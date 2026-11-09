# Computer use on Linux

- On X11 most actions work in the background. On Wayland, element actions and `set_value` work in the background, while raw keys and pointer input need `delivery_mode: "foreground"`; a background refusal is final for that step.
- An empty tree (`degraded: true`) means desktop accessibility is off or a helper is missing; call `computer_use_setup`.
- A capture can wait on a system dialog asking to share the screen: ask the person to answer it, then read again once.
- On GNOME Wayland the first foreground action raises a system dialog asking the person to allow remote interaction; the system remembers their answer afterwards. Before the first foreground step, tell them to approve it. A `foreground_timeout` ("the target application may be wedged") usually means the dialog went unanswered: ask them to look for it and approve it, then retry once.
- `surface_identity_unproven` means no trusted window picture: work from the tree, or, when the person agrees to full-screen control, use `get_desktop_state` and the desktop target.
- Do not focus windows with `wmctrl` or `xdotool`; use the driver's tools with an explicit `window_id`.
