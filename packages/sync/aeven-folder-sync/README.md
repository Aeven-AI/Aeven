---
description: "The account's Aeven folder: where Aeven keeps the files it makes for the user, the same on every device through file sync."
kind: "package-reference"
---

# @aeven/aeven-folder-sync

English | [中文](README.zh.md)

## Summary

The `ctx.aevenFolder` service owns the Aeven folder: the directory where Aeven keeps the files it makes for the user, such as decks, CVs, films and their previews. The desktop app sets it to `~/Documents/Aeven` and lets every session write there without asking, through the sandbox policy's `writableRoots`.

When account sync and file sync run, each device shares its Aeven folder under one folder id derived from the account (`aevenFolderId`), so the account's devices and the encrypted file cloud copy join the same folder without coordinating. Each device also records the absolute path of its folder in the account's `aeven-folder/paths` document. `localPath(owner, path)` maps a path any device of the account wrote inside its Aeven folder to the same file here; the `/api/workspace-file` route uses it, so an image a reply on one Mac shows opens on the account's other devices. With `perAccount`, each account keeps its own folder at `<path>/<account>`, for a Host serving several accounts.

| Config | Default | Meaning |
|---|---|---|
| `path` | required | Absolute directory of the Aeven folder on this device |
| `perAccount` | `false` | Each account keeps its own folder at `<path>/<account>` |

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="model-experience"></a>
## Model Experience

### Runtime context, while `advertise` is true

#### What the model sees

One runtime context entry, `aeven-folder`, after the sandbox policy, with the folder's absolute path for the session's account in place of `<path>`. The slides and CV skills point at that folder.

##### Verbatim text for this field

```markdown
Aeven folder: "<path>". Save the files you make for the user there, one folder per piece of work, unless they name another place: every device of their account and Aeven Web receive what it holds.
```

#### Token effect

A fixed line of about 45 tokens plus the path, on every request.

#### KV Cache effect

Prefix-stable: the line is the same on every request of a session.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Paths map by folder prefix only.** A path that reaches the folder through a symbolic link or another spelling on the writing device does not map to the copy here.
- **Shared with the file sync group** — the limits of file sync are listed once in the [group README](../README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The design is in the [synced Aeven folder Agent Note](../../../.agents/notes/implemented/feature/2026-11-16-synced-aeven-folder.md).

</details>

**Runtime invariant:** No runtime invariant companion is published because the folder and its published path are written by this device alone, and file sync owns every value a listener could compare.
