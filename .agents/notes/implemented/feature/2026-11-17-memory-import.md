# Agent Note: Import Memory by Handing the Export to Æven

Status: implemented

English | [中文](2026-11-17-memory-import.zh.md)

## Problem

People who move to Æven arrive with years of conversations in ChatGPT, Claude, Gemini, or Grok, and Æven starts out knowing nothing about them. Those assistants export in unrelated formats that change over time, and one account is often shared by several people, so a partner's or child's facts must not become the user's. An earlier hand-run import of one ChatGPT archive worked well because the agent looked at the export, wrote its own scripts, split the writers, and saved self-contained facts that named the person.

## Decision

- **Æven does the import; the product hands it the file.** Settings → Memory opens with an Import memory row. Its button picks one file (a `.zip` export or a saved conversation), uploads it through the composer's attachment route, starts a new conversation whose first message asks for the import with the file attached, and closes Settings. The browser first rebuilds an archive from its text files, so images and the HTML copy of the conversations stay on the device.
- **Guidelines, not a pipeline.** The aeven preset ships a `memory-import` skill: where each known export keeps its conversations, reading what the person wrote, telling writers apart and saving another person's facts as facts about them with their relation, dating each fact with its conversation, keeping attribution, and removing duplicates. The agent writes whatever scripts the file needs and saves through `memory_remember_bulk` with a `.jsonl` file, which already takes `about` and `date`.
- **A `.zip` is attachable.** `@aeven/document-extract-js` reads an archive as the list of its files; the model opens the files with tools at the attachment's read-only path, which every attached file already shows.

## Alternatives considered

**A fixed import pipeline on the Host** (format readers, batched extraction calls, writer grouping, a ledger, Undo). It was built first and replaced: it hard-codes four export formats that the providers change, decides every trade-off up front, and duplicates what the agent already does with a shell and the memory tools.

**A provider selector, or a paste-a-prompt flow as Claude and Gemini offer.** The agent recognizes the format from the file, and a pasted summary from the other assistant already mixes the people who share the account.

## Consequences

The import runs as an ordinary conversation, so the person sees what Æven found, can answer a question about who is who, and pays for it like any chat. Quality follows the agent and the skill rather than code; improving the import means improving the guidelines. An attachment is limited by `attachment-local`'s `maxFileBytes` (50 MiB by default), which a slimmed export of a very large account can exceed.
