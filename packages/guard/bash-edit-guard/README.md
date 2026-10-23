---
description: "Guard that refuses shell commands changing existing source files in place, for users and maintainers configuring or debugging it."
kind: "package-reference"
---

# @aeven/bash-edit-guard

English | [中文](README.zh.md)

## Summary

Editing source through shell scripts skips what the `edit` and `write` tools guarantee: `edit` fails when the text to replace is absent and requires the file to have been read, and both record the change for the edited-files card and the session log. A Python `str.replace` reports success when it matched nothing. `avn-bash-edit-guard` refuses a `bash` command that names an existing file with a source extension and edits it in place (`sed -i`, `perl -i`), writes it through a scripting call (`open(…, 'w')`, `write_text`, `writeFileSync`, …), or redirects into it (`>`, `>>`, `tee`). Creating new files, writing scratch output, builds, installs, and every other program run pass. It ships enabled in the `avn` base bundle.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it beside the tool registry when agents edit source through the `bash` tool. The base bundle mounts it with its defaults; no configuration is required.

### When to choose it

Choose it when a composition exposes a shell tool to an agent that also has `edit` and `write`. A composition whose shell tool cannot reach the person's own files — a remotely sandboxed executor with its own editing tools, or a read-only shell — gains nothing from it. The guard only refuses; it never rewrites a command, so a product that wants scripted edits to succeed keeps this plugin out of the composition.

### Minimal configuration

```yaml
- name: '@aeven/bash-edit-guard'
  config:
    tools: [bash]
    # sourceExtensions: [ts, tsx, css, …]   # defaults cover common source, markup, config, and docs files
```

| Field | Default | Meaning |
|---|---|---|
| `tools` | `[bash]` | Shell tool names whose commands are checked |
| `sourceExtensions` | common source, style, markup, config, and docs extensions | Extensions, without the dot, that count as source files |

Paths resolve against the call's `workdir`, the session cwd, and every `cd` target in the command. Files under the system temporary directories are never refused.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how one command is classified; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

The plugin registers one `ctx.tools.guard` callback for the lifetime of its fiber. The registry calls it before a matching tool runs, and a returned string becomes the call's error result instead of an execution. The callback is a predicate over the command text and the files it names: an in-place edit or scripting write pattern marks the command, every path token in it is resolved against the call's bases, and the command is refused when one of those paths exists and carries a source extension. Redirect and `tee` targets are resolved the same way. Temporary-directory paths are skipped because scratch output there is not a source edit.

A path that vanishes or cannot be stat'd between the two calls counts as absent, so a race never refuses a command for a file that is gone.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, command patterns, path resolution, refusal text |
| — | No invariant companion is published because the guard owns no durable state and no second observation: it returns one string or nothing from the command text and the files it names, so a reporter would re-run the same predicate rather than compare two independent readers. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [Tool registry](../../core/tools/README.md) — the guard hook this plugin registers on.
- [Bash tool](../../shell/tool-bash/README.md) — the `bash` tool most compositions guard.
- [Turn review](../turn-review/README.md) — the sibling guard that reads a file-changing turn's final reply.
- [Guard group map](../README.md) — sibling loop-hygiene and policy plugins.
- [Base bundle patch](../../bundle/base/cordis.patch.yml) — the composition that mounts this plugin with its defaults.

-----

<a id="model-experience"></a>
## Model Experience

### Refused in-place edits

#### What the model sees

A refused call returns one tool error naming the target file relative to the call's `workdir` and telling the model which tool to use instead. `<tool>` is the name of the shell tool whose command was refused; `<path>` is the file the command would have changed.

##### Refusal text

```markdown
<tool> refused: this command would change the existing file <path> in place. Change existing files with the edit tool (or write to replace a whole file): it fails when the text to replace is absent and records the change. Keep <tool> for builds, git, installs, and running programs; creating new files and writing scratch output are not refused.
```

#### Token effect

Zero tokens on a turn that triggers no refusal: the plugin registers no prompt section, no tool definition, and no schema. A refused call adds this one result to the transcript, once per refused call, retained until compaction.

#### KV Cache effect

Append-only. The refusal arrives as a tool result after the request prefix it answers, and the plugin contributes nothing to that prefix, so a refusal never invalidates an already-reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define what the guard cannot see. They are current package constraints, not a task backlog.

- **Detection reads the command text** — a script that computes the path it writes, or a write call outside the recognised forms, passes.
- **A read inside a writing command is refused** — a scripting command that only reads an existing source file but also writes somewhere else is refused; the model reads the file with `read` instead.
- **Only the configured extensions count** — a source file whose extension is absent from `sourceExtensions` is editable through the shell.
- **No invariant companion is published** — the guard owns no durable state and no second observation: it returns one string or nothing from the command text and the files it names, so a reporter would re-run the same predicate rather than compare two independent readers.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The command patterns are regular expressions over the raw command string: in-place editors, scripting write calls, redirects, and `tee`. A newly recognised write form belongs in those expressions, and the refusal sentence is model-visible text that names the tools the composition exposes.

</details>
