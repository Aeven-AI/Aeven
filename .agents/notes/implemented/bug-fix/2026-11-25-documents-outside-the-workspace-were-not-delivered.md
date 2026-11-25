# Agent Note: documents made outside the workspace were not delivered

Status: implemented

English | [中文](2026-11-25-documents-outside-the-workspace-were-not-delivered.zh.md)

## Problem

On 2026-11-25 a desktop conversation running in `~/Documents/Aeven/chats` asked for a tax-objection attachment. The model wrote `toelichting.html` with `write` in `~/Documents/Aeven/bezwaar-ib-2023-ondernemerschap/`, a project folder beside the workspace, then ran `cd <folder> && Chrome --print-to-pdf="$PWD/toelichting.pdf" …` and `textutil -convert docx …` without `output_files`. The 2026-11-19 detection lists only the workspace root, so neither file was recorded: the created-files block showed the HTML, the inline-code path in the reply stayed inert because mentions resolve only produced files, and the reply's `[…](file:///…/toelichting.pdf)` links rendered as text because `file:` was not an allowed protocol. Only a later `cp` of both files into the workspace produced rows. Earlier in the same conversation four headless-Chrome prints failed inside the workspace sandbox: Chrome's own sandbox cannot start there, and its default profile and `mktemp -d` folders are outside what the sandbox lets it write, so it printed crashpad errors and wrote nothing. The model concluded a PDF was impossible and delivered DOCX instead.

## Decision

- `tool-bash` watches the folders a command works in, in `detect-outputs.ts`: its `workdir`, each `cd` target, and the folder of each path the command names with a watched extension, with `~`, `$HOME`, and `$PWD` expanded. Those folders are listed one level deep, before and after the command, for the extensions the command names plus `detectDocumentExtensions` (PDF, office, iWork, ePub by default), so an exporter that writes `deck.pptx` beside `deck.html` without naming it is recorded. The workspace keeps its recursive listing for named extensions only. Folders outside the workspace count unless `shareOutputFiles` is on; temporary folders and folders below a hidden one never count, which keeps `qlmanage -t -o /tmp` previews and `.chrome-profile` out.
- Detection wraps the normal foreground path instead of replacing it, so a command naming `.pdf` still detaches to a background job after `detachAfterMs`; a detached command records nothing.
- `MarkdownText` allows `file:` links through link safety and hands a `file://` URL's path to the `fileLinks` resolver, so it opens the way a bare path does; without a resolver or a match it renders as text, never as a `file:` anchor.
- The `aeven` preset ships a `documents` skill: deliver the format the person names (PDF when none), never the HTML, and print with `--headless=new --no-sandbox` and a `--user-data-dir` in a hidden folder beside the document, the flags the conversation's one successful print used. Word comes from `textutil`, `soffice`, or `pandoc` only when asked, and Pages from Pages through `osascript` with sandbox escalation only when asked.

## Alternatives considered

- **List every folder the model touched in the Turn.** Rejected: a `read` of a folder full of old PDFs is not a sign the command will change them, and the command text already names where it works.
- **Watch unnamed images and media in the command's folders.** Rejected: page previews and thumbnails a model renders to inspect its PDF are images, the reason the 2026-11-19 detection required naming.
- **Hard-code `--no-sandbox` into the sandbox profile or a wrapper.** Rejected: the command is model-authored; guidance where documents are made reaches every route, and the cv and slides exporters already pass the flag themselves.

## Consequences

A command that writes a document into a folder it neither starts in, changes into, nor names is still undetected; `output_files` remains the declared route. Each foreground command without `output_files` now lists its starting folder once before and once after it runs.
