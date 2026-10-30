# Agent Note: Declared bash outputs become verified produced files

Status: implemented

English | [中文](2026-10-30-bash-declared-output-files.zh.md)

## Problem

A session asked Aeven to build a PDF and a DOCX with the bundled LibreOffice. The command ran and both documents landed in the workspace, but the closing turn showed no created-files block. That block is folded from successful `write`, `edit`, and mutating `str_replace_editor` calls, so a file written by a program the agent launched leaves nothing for the Client to read. The turn's own result mentioned the documents; the product showed none of them.

## Decision

`bash` accepts an optional `output_files` list naming the files a command is expected to produce. The filesystem provider resolves each path against the call's `workdir` and stats it before the command runs. After the command finishes, each declared path is statted again, and a regular file that is new or whose version changed enters durable `producedFiles` result metadata as `{ path, created }`. A created file reports `created: true`; an overwritten one reports `created: false`. Missing paths, unchanged files, and directories are excluded rather than guessed at, so the metadata states what an observation confirmed.

The Client folds `producedFiles` into the same Turn data as mutation calls, with no extension filter: PDF, Microsoft Office, OpenDocument, iWork, CSV, and images all reach the created/edited-files block through one path. Nothing is inferred from command text, stdout, or the closing reply.

Declared outputs keep the call in the foreground: `output_files` with `run_in_background: true` is refused before a command starts, because a backgrounded job has no completion point at which the paths can be observed. A composition that uses the argument must mount a filesystem provider; without one the call fails rather than claiming outputs it could not verify.

## Alternatives considered

**Snapshot the workspace around every `bash` call.** Rejected: a full scan costs time on every command, and the declaration is the part only the caller knows.

**Parse paths out of the command.** Rejected: shell text is not a reliable statement of what a program writes, and a wrong guess would advertise a file that does not exist.

**Infer deliverables from stdout or the final reply.** Rejected: both are model output. The block would list files no observation confirmed.

## Consequences

- A command that generates documents spends one `stat` per declared path before and after it runs.
- A command the model does not declare stays invisible to the block, as before.
- The client-facing record is `tool/result.data.meta.producedFiles`, so a replay reconstructs the turn's files from the session log alone.
