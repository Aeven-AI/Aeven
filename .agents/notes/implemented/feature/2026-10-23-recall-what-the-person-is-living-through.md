# Agent Note: Recall what the person is living through

Status: implemented

English | [中文](2026-10-23-recall-what-the-person-is-living-through.zh.md)

## Problem

Turn-start recall searches the turn's words, so a reply knew what the person is going through only when those words happened to match it, and a long session's later turn had no way to reach the memories about their life at all. Offering those memories on every turn instead makes each work turn pay a scan of the person's life and lets unrelated personal history compete with the task. Retrieval embeds the message once, so a message that opens on one subject and asks about another sits closest to memories of the first subject and reaches nothing about the second. And a fact the turn judgment files under the person or a project enters ranking with its conversation's reward, which is lowest exactly when the person had to correct the assistant, so a correction pushed the corrected fact below conversation traces about unrelated work.

## Decision

**A later turn offers the person's recent memories only after its judgment asks for them.** `MemoryRecallRequest.recent.sharingOnly` marks the offer as conditional. `@aeven/memory-context` offers the last `recentPersonHours` (168) of the person's memories up front on a session's first turn, and on every later turn sends `sharingOnly: true`. `MemosMemory.recallHits` then runs the first relevance judgment on the turn's retrieval candidates alone; when that judgment reports `sharing: true`, `judgeWithRecent` scans the window, and a second judgment runs with the recent memories among the candidates. An empty scan, a scan that runs out of time, and a second judgment marked degraded all leave the first judgment's result in place, so a personal turn never ends with less than the work turn would have delivered.

**Each sentence of a message retrieves beside the whole query.** At turn start, `messageSentences` splits the person's message on sentence ends followed by a space and on line breaks, keeps the distinct sentences of at least three words, and returns them only when the message holds two or more; the spellings are compared case-insensitively, and `sentenceRetrievals` (3) bounds how many are used. `MemosMemory.search` runs the conversation query and one retrieval per sentence in parallel, and `withSentenceHits` keeps the conversation query's whole ranking, then appends the top `sentenceHits` (8) of each sentence's hits that are not already ranked. The candidates the judgment reads therefore grow by a bounded amount, and a one-sentence message still costs one retrieval. Explicit model searches keep their own path.

**A filed fact ranks at least as high as a remembered fact.** `retrieval.rememberedFactTags` in the provider's config (`lightweight_memory`, `domain:person`, `domain:project`) names the trace tags that mark a stated fact, and the vendored ranker (`relevanceFor`) gives a trace carrying any of them a learned value of at least `rememberedFactValue` (0.5). The relevance prompt keeps a memory where the person corrected the assistant together with the fact the correction established whenever the request touches that subject, and drops an earlier exchange that answers the same request again, so the corrected fact is a candidate and outranks conversation traces whose reward came from work the person accepted.

**The personal-turn note names what the reply knows.** When the judgment finds the person sharing their life, `PERSONAL_NOTE` asks the reply to name the specific thing it remembers — the event, the day, the person — rather than hint at it, and to read wording that echoes an earlier conversation, such as a day or a place that weighs on them, in that light instead of correcting it as a literal mistake.

## Alternatives considered

**Offer the recent memories on a session's first turn only.** A long session usually turns personal after its first turn, so the turn where the person needed the memories most received none; the sharing flag now decides per turn instead of the turn number.

**Offer them up front on every turn.** Every work turn then pays the window scan and one longer judgment, and health, family, and money memories compete with the task's candidates on a turn that only needs the latter.

**Retrieve the message as one query.** One embedding of a message that names two subjects sits far from both, so the second question reached nothing about its own subject; per-sentence retrieval costs one embedding and one search per sentence, bounded by `sentenceRetrievals`.

**Rank a filed fact by its conversation's reward.** The reward is lowest for a conversation in which the person had to correct the assistant, which is precisely the conversation whose established facts matter most later; the tag floor separates what was stated from how the work went.

## Consequences

- A work turn pays no scan of the person's life and no second judgment; a personal turn pays one window scan, up to 24 recent memories, and one more judgment call inside the recall's existing time budget.
- The window reaches a week back, so a memory from several days ago can arrive at a turn about today; the judgment reads each candidate's age label and keeps what fits the turn.
- Session capture writes the `person:sharing` tag on a turn the judgment found personal, so a later scan reads what the person said about how they are doing ahead of other memories from the same week.
- `rememberedFactValue` now floors three tag families instead of one, so a project or person fact the judgment filed can outrank a rewarded conversation trace about the same work.
- `packages/memory/memory-memos/tests/sharing-recall.spec.ts`, `sentence-recall.spec.ts`, `query-sentences.spec.ts`, and `recall-config.spec.ts` pin the two judgments, the per-sentence merges, the splitter, and the tag floor; `packages/memory/memory-context/tests/recall.spec.ts` pins `sharingOnly` per turn, the 168-hour default, and the personal-turn note.
