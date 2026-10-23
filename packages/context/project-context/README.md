---
description: "Project orientation for a session that runs in the person's project folder: one durable message naming the folder, a README-derived summary, its top level, and the person's other project folders."
kind: "package-reference"
---

# @aeven/project-context

English | [中文](README.zh.md)

## Summary

A session filed in a project folder starts knowing which project it is in: before the first step whose surface lacks it, the model receives one durable message that names the working directory as the person's own project, quotes the opening prose of its README, lists its top level, and names the person's other project folders, so a question about the project is answered from its files instead of general knowledge. The message is source-attributed, logged, and injected once per session; a later step, a resumed session, and a relayed request all reuse it. It reads through the mounted `ctx.fs` provider and stays silent when the folder is absent, when it is not a directory, or when the session has no working directory.

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

Mount it in any composition whose sessions are filed in project folders and whose filesystem provider can read them. The common path needs no configuration: the `aeven` agent preset mounts the plugin with its defaults.

### When to choose it

Choose it when the product files a session in a folder the person owns — a code checkout, a documents folder, a project directory — and the model should answer from that folder rather than from what it remembers about a folder of that name. A product whose sessions have no working directory, such as a personal chat, gets nothing from it, and a composition that prefers to disclose each project explicitly omits it.

### Minimal configuration

```yaml
- name: '@aeven/project-context'
```

| Field | Default | Meaning |
|---|---|---|
| `readmeNames` | `['README.md', 'README']` | Candidate README names in the working directory; the first that exists is read |
| `maxReadmeBytes` | `65536` | Bytes read from that README before its summary is extracted |
| `maxSummaryLength` | `1200` | Code points of README prose kept in the summary; longer prose ends in `…` |
| `maxEntries` | `60` | Top-level entries listed before the rest are counted as omitted |
| `ignoredEntries` | `['node_modules', 'lib', 'dist', 'build', 'coverage']` | Top-level entry names left out of the listing, in addition to dot-entries |
| `maxRelatedProjects` | `20` | Other project folders named before the rest are counted as omitted |

Every field is validated at plugin load; an invalid value fails the mount.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the orientation is composed and when it is skipped; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

The plugin prepends an `agent/pre-step` listener that delegates first and then appends one `UserMessage` to the entering step's messages. Because the message is an ordinary session event with an explicit source, the model-visible orientation and the logged record are the same object: replay, resume, and a request re-derivation all read the text the model read.

Two checks decide whether to append. A step whose own decision already carries a message from this plugin appends nothing, and a session whose visible surface already holds one does not append a second. The surface scan reads durable events rather than process state, so a resumed session and a session whose orientation was shadowed by compaction both keep exactly one injection point.

Composition reads only what the mounted providers expose. `ctx.fs` resolves and stats the working directory, reads the first README candidate, and lists the top level; a missing provider, a missing working directory, or a working directory that does not stat as a directory yields no message. `ctx.get('workspaceRegistry')` is optional: when it is mounted, the message also names the session owner's other folder workspaces, filtered by `kind: 'folder'`, a defined path, a path other than the working directory, and the session's own owner, so another account's folders never reach this session.

The rendered text is wrapped in `<project_context>` tags, and any `</project_context` occurrence inside repository-controlled text is escaped, so a README cannot close the plugin-owned frame.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, pre-step listener, README summary extraction, orientation rendering |
| — | No runtime invariant companion is published because the plugin owns no second observation to diverge from: orientation is composed once from the filesystem and the registry, and the plugin's own surface scan is the only reader of the message it wrote. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the composition that mounts the plugin to the neighbouring request-context packages and the exhaustive configuration.

- [Agent presets](../../preset/agent-presets/README.md) — the composition that mounts this plugin by default.
- [Context group map](../README.md) — sibling request-context packages.
- [Agent instructions](../agent-instructions/README.md) — the package that states how to work in the folder rather than what it is.
- [Workspace Registry](../../workspace/workspace/README.md) — the optional registry that supplies the person's other project folders.

-----

<a id="model-experience"></a>
## Model Experience

### Project orientation

#### What the model sees

One user-role message from the `project-context` plugin, injected before the first step whose surface lacks it. `<cwd>` is the session working directory; the README summary is README prose with front matter, fenced code, headings, images, HTML, tables, and short link lines removed, joined and cut to `maxSummaryLength` code points; directories in the listing end in `/`; and each optional section appears only when it has content.

##### Orientation message

```markdown
<project_context>
This conversation runs in the person's own project folder, <cwd>. When they ask about this project — what it is, how it works, or how it is built, deployed, hosted, scaled, run or paid for — read its README, docs and the code involved before you answer, and follow references from those files into related folders. Answer from what the files say, and search the web only for facts outside the project, such as a provider's prices or limits. If the files do not settle a question, say what you could not find instead of guessing from the project's name.

README summary: <README opening prose>

Top level: <entry>, <entry>/ and <count> more

The person's other project folders, which may hold other parts of the same product, such as its server, website or components; read them the same way when a question reaches into them:
- <title>: <path>
- and <count> more
</project_context>
```

#### Token effect

One message per session, at most `maxSummaryLength` code points of README prose plus the listing and related-folder lines. It stays in the transcript and is resent with every later request of the session until compaction shadows it; a step that already carries it adds nothing.

#### KV Cache effect

Append-only. The message is appended to the entering step's messages, so it extends the request rather than replacing earlier tokens, and later steps do not change it. A session that resumes with the message still on its surface reuses the same prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the orientation is incomplete or does not appear. They are current package constraints, not a task backlog.

- **The summary is README prose only** — the plugin skips headings, fenced code, tables, images, HTML, and link-only lines such as a language switcher, so a project whose README opens with a heading and a badge list yields a shorter summary or none.
- **The listing is one level deep** — subdirectories are named, not described; a nested package, server, or website is discovered by reading it, not from the message.
- **No invariant companion is published** — the plugin owns no second observation to diverge from: orientation is composed once from the filesystem and the registry, and its own surface scan is the only reader of the message it wrote.
- **A session without a working directory gets nothing** — a personal chat, and a session whose working directory does not stat as a directory, receive no orientation.
- **Related folders require `ctx.workspaceRegistry`** — a composition without that provider names the working directory only, and a folder owned by another account is never listed.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The plugin is mounted by the `aeven` agent preset beside `agent-instructions` and `time-context`; the preset's comment records why orientation is separate from instructions. The summary extraction is a heuristic over Markdown blocks rather than a parser, so a change to what a summary should contain belongs in `readmeSummary` and changes what every mounted composition sees.

</details>
