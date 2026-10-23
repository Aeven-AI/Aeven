# Agent Note: Project orientation before the first step

Status: implemented

English | [中文](2026-10-23-project-orientation-before-the-first-step.zh.md)

## Problem

A session filed in a project folder starts with the model knowing the folder's path and nothing else. `agent-instructions` states how to work in a project — read its files, follow references — but not what the project is, so a question such as "how would I host this" was answered from the web instead of from the deployment files in the working directory. The person has to say which folder the session is in before the first useful answer.

## Decision

`@aeven/project-context` prepends an `agent/pre-step` listener that delegates first and then appends one `UserMessage` to the entering step's messages, so the model-visible orientation and the logged record are the same event and a replay, resume, or request re-derivation reads the text the model read. The listener appends nothing when the step's own decision already carries a message from this plugin, and nothing when the session's visible surface already holds one; the surface scan reads durable events, so a resumed session and a compacted one keep exactly one injection point.

The message names the session working directory as the person's own project and asks that questions about it be answered from the README, docs, and code before searching the web. It then carries a summary of the project README — the opening prose with front matter, fenced code, headings, images, HTML, tables, and link-only lines such as a language switcher removed, cut to `maxSummaryLength` code points — and the top-level listing, directories marked with a trailing `/`, dot entries and `ignoredEntries` left out. When `ctx.workspaceRegistry` is mounted, it also names the session owner's other folder workspaces, filtered by `kind: 'folder'`, a defined path, a path other than the working directory, and the session's own owner. Repository-controlled text is escaped so a README cannot close the `<project_context>` frame.

Reads go through the optional `ctx.fs` provider: `resolve`, `stat`, `readBytes`, and `listDir` compose the message, and a composition without that provider mounts the plugin as a no-op. A session without a working directory yields no message, and neither does one whose working directory does not stat as a directory.

## Alternatives considered

**Extend `agent-instructions` instead of adding a package.** That package states how to work in the folder, which every composition wants regardless of the project; orientation states what the project is and needs the filesystem, the README, and the workspace registry, so it owns a separate listener and a separate mount.

**Deliver the orientation as a system-prompt section.** A prompt section is recomputed for every request and needs its own model-visible-and-logged rule; a durable user message with an explicit source is logged once, reused by replay and resume, and carries the same text the model read.

**Let the model read the folder when a question needs it.** Models answering from the session's path alone described hosting and deployment from general knowledge instead of from the deployment files beside them, and only a question that named a file sent them to the folder.

## Consequences

- One message per session, appended rather than replacing earlier tokens, so the request prefix grows once and later steps reuse it; it stays in the transcript until compaction shadows it.
- The summary is README prose only, so a project whose README opens with a heading, badges, and code yields a short summary or none, and a project without a README gets the listing and the instruction alone.
- The listing is one level deep: a nested package, server, or website is named but not described.
- A composition without `ctx.fs` produces nothing, which is the mount that keeps providerless products unaffected; a session without a working directory, such as a personal chat, also receives nothing.
- Other project folders are named only when `ctx.workspaceRegistry` is mounted, and only the session owner's own folder workspaces qualify.
- `packages/context/project-context/tests` pins the attributed injection before the first step, the no-second-message rule for a surface and for a step that already carries it, the rejected and aborted pre-step paths, the README summary extraction, the top-level listing, the related-project filters, and the config defaults.
