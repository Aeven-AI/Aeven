# Agent Note: First-turn memory recall and the chat that waited for the Session list

Status: implemented

English | [中文](2026-11-17-first-turn-recall-and-chat-before-list.zh.md)

## Problem

Session logs and the MemOS `api_logs` audit rows of a Desktop home showed the first turn after a Host start waiting 5.6 s and 7.3 s before its model request, each ending with the notice that recall did not finish within 5000 ms, so the reply ran without recalled memory. On Desktop the account's MemOS core, the local embedding model, the trace vector index, and the person-memory listing all load inside that first recall: against a copy of the same 1 GB database a fresh process spent 0.4 s opening the core, 2.6 s on its first retrieval against 40 ms for later ones, and 0.7 s on the listing, and inside the Host the model load alone took 1.5–4.8 s. The hosted composition already ran embeddings in a worker thread that loads the model at start; Desktop used the in-process provider. Separately, the window's own load timings showed the open chat drawn at 1.24 s: the gate waited 153 ms for Aeven's `/get-profile` before booting, the Session list was requested at 704 ms, and the restored chat's history, a 4 ms read, was requested only after the 1.76 MB list had arrived and been applied.

## Decision

- **Desktop and Web run embeddings in the worker** (`avn-bundle-web-app`): `memory-memos` sets `embeddingExecution: worker`, so the model loads when the provider starts and neither the load nor an embedding batch occupies the Host's event loop. One account owns such a Host, so `embeddingQueuePerAccount` equals `embeddingQueueTotal`; the in-process provider had no queue limit to reach.
- **An account's memory loads at sign-in** (`avn-memory-memos`): with `warmOnSignIn`, the provider answers `credentials/session-updated` by opening the account's core and calling `MemosMemory.prime`, which runs the retrieval an explicit memory search runs with a fixed query, discards its hits, and lists the person memories. It loads only an account whose database exists, once per run, and calls no model. The field defaults to `false`; the hosted patch restates its `memory-memos` config without it, because a Host serving many accounts would hold every signed-in account's vector index in memory.
- **The gate restores from the kept profile** (`avn-client-ui-auth-aeven`): when the browser holds the kept profile with a chosen name and an unexpired bearer for the same account, `restoreSession` adopts the profile at once and reads `/get-profile` beside the boot. The answer replaces the kept profile; a refusal ends the session through `leaveForSignIn`. A pending language pick, a Host refusal, or a missing or expired bearer keeps the waiting path.
- **The restored selection opens beside the list pull** (`avn-api-session-controller`): the persisted selection cell keeps the selected Session's display title, and while the first list baseline is pending the projection publishes that selection as `current` with a row built from the kept title. Its window therefore opens when the connection is established instead of after the list. A blank Session keeps no title and waits for the list, which carries its `blank` bit; a selection the baseline does not list is masked as before.

## Alternatives considered

**Requesting the Session list when the plugin mounts.** With the gate no longer waiting, the list starts about 200 ms after the first mount-time reads. An earlier pull would still be in flight when the event connection is established, so either a Session added in between is missed until the next pull, or a second pull runs at every start: about 300 ms of Host work and a second 1.76 MB parse for rows that no longer delay the chat. Not taken.

**Shortening or skipping the relevance judgment.** On a warm Host a turn's recall is 0.35–0.9 s of retrieval and one 1.0–1.6 s judgment on the session's route. The judgment decides which candidates reach the model, so removing it trades recall precision for time. Not changed.

**Opening every account database found at Host start.** The account directory name is a hash of the account id, so the Host cannot name an owner from the directory, and a home can hold databases of accounts nobody is signed in to. Sign-in names the account that is about to chat.

## Consequences

The first turn after a start recalls against a loaded core, model, and index, like any later turn. Each Host start adds one `memos_search` audit row per signed-in account. In the dev Desktop window the open chat's text was drawn at 680 ms instead of 1,236 ms, its history requested at 626 ms instead of 1,192 ms, and the Session list requested at 361 ms instead of 704 ms. A profile changed on another device reaches a restored page when the background read answers rather than before boot. A restored selection whose Session was removed elsewhere shows its failed window until the list baseline arrives and masks it. Turns that start 10 minutes or more after the previous one still showed 5–8 s before their request in the logs; that delay is not explained by these loads and remains open.
