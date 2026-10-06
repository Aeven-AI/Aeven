# Agent Note: Memory summaries name their subject

Status: implemented

## Problem

Automatic recall injects each trace's stored summary, and the MemOS summarizer wrote that summary from one exchange with the instruction to drop the speaker and to keep "an answer that was confirmed". A user who confirmed a list about themselves ("you got all right, including ollie") was stored as "User confirmed all correct, including Ollie; keep using that name." Under the heading "About the user", next to a line about the user's son, the model attributed the nickname to the son. The wrong answer was then captured as a `person` fact ("Son: …, nickname Ollie"), so one misreading became a stored memory that later recall would present as confirmation. The correction ("no, I go by Ollie not my son") matched none of the `correctionOf` phrases, so the wrong trace was never superseded.

## Decision

The summary is fixed where MemOS writes it, because it is also what MemOS embeds for `vec_summary` retrieval and `updateTrace` does not re-embed. The [MemOS patch](../../../../patches/@memtensor__memos-local-plugin@2.0.20.patch) changes the summarizer prompt: each fact names whom it is about, a fact about the user or a person they know comes only from the user's words, and a question the assistant answered about them is summarized as the question.

One model call per captured turn writes the summary, files the domain, and detects a correction. The patch forwards the MemOS operation name to the Host bridge. `TurnJudgeContext` in `@aeven/memory-memos` scopes each turn capture with AsyncLocalStorage; when the bridge receives that capture's `capture.summarize` request that carries an `ASSISTANT` section, it appends the domain rules and prefixes the session's project and the previous captured reply. The JSON answer carries `summary` for MemOS and `domain` and `corrects` for Aeven. The separate classification call runs only when no judgment was produced: a non-host MemOS provider, a summarizer fallback, or an answer without a domain.

A judged correction supersedes the previous turn's trace, and the facts the model saved with `remember` during that turn, through the existing `superseded:` tag; the live check showed a fact remembered in the corrected turn otherwise stays current. It does not receive the `outcome:correction` tag, so automatic recall keeps it: its summary was written with the replied-to message in view and states the referent. Phrase-detected corrections keep their tag and stay out of automatic recall.

The recalled section is headed "About the user and people they mention", the `person` domain covers facts the user states about themselves or people they know, and the memory guidance tells the model that each line states whom it is about.

## Alternatives considered

**Rewrite the summary after capture.** Aeven can replace `trace.summary` through `updateTrace`, but MemOS does not recompute `vec_summary`, so retrieval would keep matching the subjectless text the model no longer sees.

**Tag each `person` line with its subject and render two groups.** The heading would stop claiming a son's name is about the user, but a subjectless line inside the right group still loses its referent, and the tag needs its own classification output and renderer path. A summary that names its subject covers both.

**Give the correction detector its own model call.** It needs the same exchange the summarizer already sends, so a separate call doubles background cost for one boolean.

**Raise the `person` line cap or require `memory_search` before attributing a name.** Both add tokens or tool calls to every turn and leave the stored summary ambiguous.

## Consequences

Captured turns that run through the Host bridge cost one model call instead of two, and the request path is unchanged. The summarizer prompt now lives partly in a dependency patch, so a MemOS upgrade must re-apply it. Only the annotated trace's summarize request carries assistant text: MemOS lightweight capture, the default, summarizes a whole turn including its tool calls as one step, and full capture gives tool sub-steps no assistant text. Detection depends on the section labels of the MemOS summarize prompt; when they change, the judgment stops matching and the fallback classification call runs instead of producing a wrong judgment. Summaries stored before this change keep their old text until superseded. `tests/turn-judge.spec.ts` covers request extension, judgment parsing, and capture filing and supersession from a judgment.
