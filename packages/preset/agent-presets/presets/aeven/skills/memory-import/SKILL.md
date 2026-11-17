---
name: memory-import
description: Import what another assistant (ChatGPT, Claude, Gemini, Grok, or any other) knows about the person into long-term memory, from a data export (.zip) or a saved conversation file. Use when the person asks to import memory, attaches such an export, or wants Æven to learn from their old chats.
---

# Import memory

The goal: read the person's history with another assistant and keep what a close friend would remember about them, in their memory, dated, and about the right person. These are guidelines that worked before, not a fixed procedure. Look at the file first and write whatever scripts it needs.

## Find the conversations

An attached file shows its read-only path; work on it with the shell, and unpack an archive into a scratch directory. Exports differ and change, so inspect before assuming. Common shapes:

- **ChatGPT:** `conversations.json` (sometimes split into `conversations-000.json` and up). Each conversation's `mapping` is a tree of messages; the conversation the person kept runs from `current_node` back through `parent`. `create_time` is epoch seconds. A `user_editable_context` message holds their custom instructions. Saved memories are not in the export.
- **Claude:** `conversations.json` with `chat_messages` (`sender` is `human` or `assistant`; text in `text` or `content` blocks), and `memories.json` with the memory Claude kept.
- **Gemini (Google Takeout):** `My Activity/Gemini Apps/MyActivity.json` (or `.html`): one entry per exchange; the conversation id is in `titleUrl`.
- **Grok:** `prod-grok-backend.json`: `conversations[].conversation` plus `responses[].response` (`sender`, `message`, `create_time` as `{"$date":{"$numberLong":"<ms>"}}`).
- **A single saved conversation** (`.md`, `.txt`, `.json`): usually labelled turns such as `You said:` / `ChatGPT said:`.

Flatten everything into one simple list (conversation id, title, date, turns) before reading, and index it so you can search and revisit. Report what you found (how many conversations, the date range) in a sentence before the long part.

## Read what the person wrote

- The person's own messages carry almost everything; assistant replies matter only to make a short answer readable. Skip code, pasted documents, and one-off task requests unless they reveal something lasting (the job they applied for, the project they build).
- A large archive is millions of words. Work through it in batches with your own scripts, by date or by theme (family, health, work, projects, money, feelings and big events), and keep going until it is covered. Say roughly how long it will take when it is large, then do it.

## More than one person

Accounts are often shared by a partner, a child, or a colleague. Tell writers apart by what they say about themselves: name, age, the people they mention ("my husband" against "my wife"), job or school, language, what they work on. Recognize the person you work for from what you already remember about them; when you know nothing yet, the person who wrote most is a reasonable start, and asking once is fine when it is unclear. Facts from someone else's conversations are facts about that person, named with their relation ("Maria, Tom's wife, is looking for a sales role"), never facts about the user.

## Write the facts

- Self-contained, one fact per line, naming whom it is about, in their words where feelings or self-judgments are concerned.
- Dated: give each fact the date of the conversation it came from, so ages, anniversaries, and "now" stay true later.
- Keep attribution and uncertainty: what someone claimed, planned, feared, or assessed is stated as such, not as verified fact.
- Lasting things: identity, family and the people in their life, important dates, health, work and career, projects, plans, money, home, preferences, habits, beliefs, significant events.
- Before saving, drop near-duplicates within the import and against what memory already holds; when a fact changed over time, keep the newest and dated earlier versions only if the change itself matters.

Write them to a `.jsonl` file, one `{"fact": "...", "about": "user", "date": "YYYY-MM-DD"}` per line (`about` is `user` for the person and the people in their life, `project` or `knowledge` otherwise), and save it with `memory_remember_bulk` and `file`. Importing the same file again skips facts already stored.

## Finish

Tell the person in a few lines what you imported: how many facts, from how many conversations and which period, and whose conversations were someone else's and saved as facts about them. Mention that they can review or remove anything in Settings → Memory.
