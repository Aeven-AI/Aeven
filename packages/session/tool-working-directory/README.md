---
description: "The model-facing working_directory tool over a session's logged working directory: read the effective directory or move the session into another one, with the model-facing description and failure messages."
kind: "package-reference"
---

# @aeven/tool-working-directory

English | [中文](README.zh.md)

The `working_directory` model tool over `@aeven/working-directory`.

## Summary

`avn-tool-working-directory` lets an agent move its own session into another directory. With no argument it reports the directory the session is working in; with one it resolves the path, refuses anything that is not an existing directory, and records the change so every later file, shell, and search call resolves relative paths against the new one. Work that starts in a repository and continues in a worktree, a checkout, or a subdirectory stops needing a `cd` prefix on every command. Use it wherever an agent works across directories in one session; the change lasts for the rest of the session.

## Table of Contents

- [Contract](#contract)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Contract

- `working_directory({})` reports `{ cwd, changed: false }` for the directory in force. A session with no header `cwd` and no logged change has none, and the call fails asking for an absolute path.
- `working_directory({ path })` resolves the path (absolute, or relative to the directory in force), requires an existing directory, appends `session/cwd`, and reports `{ cwd, changed: true }`.
- The tool needs an owning agent session; a caller without one is rejected, because the directory is per-session logged state.

Rendering names the consequence in one line — `Later calls resolve relative paths against it` — so the model does not have to infer what a change means for its next call.

## Dev Note

The tool is thin on purpose. Validation, normalization, and the log append all live in `@aeven/working-directory`, so the tool's spec mounts the real service and asserts what the session log and the projection received; a tool that resolved paths itself would duplicate the fold and drift from what the shell tools compute.

The spec builds its sessions through `Session.create` with a full header rather than through a store, because the header is exactly what the tests vary: a session with a `cwd`, one without, and one whose relative target composes against a logged change. `workingDirectory.of()` returning `undefined` is a real state, and both the read path and the change path have to answer it.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`working_directory` schema](../../../docs/tool-catalog.md#aeventool-working-directory): an object with one optional `path` string, whose description asks for an absolute path or one relative to the current directory, and says that omitting it reads the current directory. The description states that a change lasts for the rest of the session and that later file, shell, and search calls resolve against it, so the model does not re-resolve paths in each call.

#### Token effect

Fixed schema cost on every request where the tool is visible; the description and schema are stable for a given configuration.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool calls and results

#### What the model sees

A read returns the directory plus `changed: false`; a change returns the absolute directory plus `changed: true` and one line naming the consequence for later calls. Stable failures are `Error: working_directory requires an owning agent session`, `Error: working_directory: this session has no working directory; pass an absolute path`, and the service's `/`-matched messages naming the path and whether it does not exist or is not a directory.

#### Token effect

Small and fixed-shape: one path, one boolean, one sentence. The change itself is not re-sent; the next call that resolves a relative path carries the directory it already had.

#### KV Cache effect

Append-only; the result follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- No directory stack and no `cd -`; a model returns by naming the previous path.
- The tool does not create directories and does not check sandbox confinement; a confined composition must reject out-of-root targets where confinement is owned.
- No invariant companion is published because the only relationship it could check is the service's own fold, which the unit spec observes directly, and no independent observation can diverge.
