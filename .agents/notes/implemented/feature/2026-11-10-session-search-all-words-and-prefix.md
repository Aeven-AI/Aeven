# Agent Note: Session search matches every word in any order, and the last word as a prefix

Status: implemented

English | [中文](2026-11-10-session-search-all-words-and-prefix.zh.md)

## Problem

`avn-session-query-sqlite` matched a query as one literal phrase: `memory sync bug` found only text with those three words adjacent and in that order. On a copy of the hosted index (426k documents) on 2026-11-10, `memory sync bug` and `session search warning` returned nothing although 836 and 308 documents held every word, and `install pnpm` found 733 documents against 3,379 holding both words. A word still being typed matched nothing until it was complete.

## Decision

A query matches every document that holds all of its tokens, in any order. The final token also matches the longer tokens it begins once it has `prefixMinChars` characters (default 3, `0` disables it), so `rele` finds `release`. Each token is quoted on its own, so query syntax stays inert data.

FTS5 finds the candidates by intersecting the token doclists (`MATCH "a" "b" "c"*`), and the instance vocabulary counts each candidate's token hits and its merged exact-phrase spans, the final token counting as a prefix in both. Ranking is phrase spans, then token hits, then shorter documents, then time, session id, and seq; highlights mark every matched token. The browser fixture in `packages/client/connection/src/client/fixture.ts` mirrors the matching and the rank keys.

On a Host that limits sessions to their owner, the session controller passes the caller as a new `owner` session filter, and the engine drops other accounts' candidates before counting hits. Before, the controller searched every account's sessions and discarded the foreign hits afterwards, calling the provider again until it had a page, so another account's matches could crowd a caller's out of the results and exhaust the controller's 100-call work budget.

The change lives in TEMP query tables and the query path: the persisted index, its schema version, and the search request and response fields are unchanged, so every client gets the new matching without a reindex.

## Alternatives considered

FTS5 `bm25()` ranks by term rarity and document length, but its statistics are per table, so a live session's score and a persisted session's score would not compare; the engine's ranking contract requires one comparable scale across both.

Counting hits for every document that holds any token before intersecting read each token's whole instance list: 70–215 ms per multi-word query on the hosted copy, against 49–93 ms when FTS5 narrows the candidates first.

A trigram tokenizer would add substring and CJK matching, but doubles the index and needs a schema bump; it is a separate decision.

## Consequences

Natural multi-word queries find results, and results update while the last word is typed. Searches cost more than the phrase lookup did: on the hosted copy, single words take 10–50 ms, multi-word queries 50–90 ms, the prefix `rel` about 130 ms, and a stop word such as `the` over a second, against 446 ms before. The FTS5 candidate step still reads the whole index; the hit counting reads only the caller's candidates once the `owner` filter applies. A query whose final token is shorter than `prefixMinChars` still matches whole tokens only, so `AI` does not find `AIM`.

## Verification

`packages/session-query/session-query-sqlite/tests/sqlite.spec.ts` pins that `alpha beta` ranks the exact phrases before `alpha middle beta`, that `beta alpha` finds all four, that `alpha bet` ranks the same as the full phrase, and that `alpha be` finds nothing; `tests/query.spec.ts` pins the quoting of each token and the prefix marker. The session-query specs pass (262), and the connection specs pass with the fixture's new matching (148). The hosted timings above were measured on a copy of pink's search index.
