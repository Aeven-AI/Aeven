---
description: "Browser half of the workspace naming surface: the dialog that creates a Workspace with no directory under a name the reader types, mounted where a Host gives Workspaces no folder."
kind: "package-reference"
---

# @aeven/client-ui-workspace-name

English | [中文](README.zh.md)

## Summary

A Host that keeps no workspace folders cannot offer the directory flows ui-workspace declares, so this package fills both with a dialog: the reader types a name, and the Workspace is created with that title and no directory. Everywhere else the directory pickers stay, and the flow is a different registration behind the same two holes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount it in place of `client-ui-directory-picker-browse` or `client-ui-directory-picker-native` on a composition whose workspaces have no folder — Aeven's hosted web, for one. Nothing else changes: the New Workspace action still opens the flow, the flows still land in `workspace.create` and the directory-change holes, and the created Workspace opens like any other.

## Understand the implementation

The plugin registers the dialog's dictionaries and both directory-flow holes through `slots.inject()`, because the ui-workspace entries may activate later or replace their declarations. The dialog collects a title only; the create call is the one ui-workspace already makes, with no directory.

## Further Exploration

- [Workspace surface](../ui-workspace/README.md)
- [Web app bundle](../../bundle/web-app/README.md)

## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Names only** — there is no folder, so a session started in such a Workspace runs where the Host runs, which is what a hosted composition intends.
- **No rename-on-create** — the dialog creates a Workspace once per submission; renaming stays ui-workspace's own control.
- **It replaces the pickers rather than coexisting** — a composition mounts one set of directory flows, so a deployment that wants both needs its own deciding surface.


### Dev Note

No invariant companion is published: the package registers a dialog and owns no runtime relationship beyond what its specs drive.
