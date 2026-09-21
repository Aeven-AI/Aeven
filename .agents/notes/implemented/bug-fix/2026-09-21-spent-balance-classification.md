# Agent Note: A spent balance that did not read as one

Status: implemented

English | [中文](2026-09-21-spent-balance-classification.zh.md)

## Problem

An account running a session and six subagents had its turn refused, and the reader was told *"your Æven inference balance is used up; add credit or upgrade your plan to continue"* — while the balance held $1.47, the sibling sessions kept being served, and the agents went on working. Two separate defects met there, and only one of them was in the gateway.

**The client could not read its own gateway's failure.** The gateway answers an unaffordable request with `{"error":{"message":…,"type":"insufficient_inference_balance","code":"AEVEN_INFERENCE_BALANCE_EXHAUSTED"}}` and a 402. `httpErrorCode` in `@aeven/llm-deepseek` classifies a non-2xx by running `isQuotaExceededError` over the code, type, and message joined into one string — and every pattern in that recognizer is anchored on `\b`. Word boundaries do not fire inside an underscore-joined token: the character before `BALANCE` in `AEVEN_INFERENCE_BALANCE_EXHAUSTED` is `_`, which is a word character, and the same is true of `insufficient_inference_balance`. The wording the gateway chose, "balance is used up", was in no pattern either. So the one failure whose remedy the gateway had already named landed on the fallback arm as `HTTP_402` — an unknown code, which nothing downstream treats as terminal.

**The refusal said the wrong thing about the money.** `insufficient_balance` covers two different facts and the message read the same for both. It is returned when the account has no balance at all, and it is also returned when the balance exists but requests already in flight are holding all of it: a hold is the request's worst case — the prompt at the cache-miss rate plus the model's whole output allowance — and it is committed for as long as the request runs. Six sessions holding cents each can hold a small balance in full, and the seventh arrival is refused. The account still owns every micro. That is a momentary refusal with an obvious remedy, and the message described a spent account.

## Decision

`isQuotaExceededError` matches funding-exhausted wording with `(?:^|[^a-z0-9])` boundaries rather than `\b`, so an underscore-joined `code` or `type` is read like any other spelling of the same fact: `insufficient_inference_balance`, `AEVEN_INFERENCE_BALANCE_EXHAUSTED`, "your balance is used up", "credits depleted". The two patterns stay separate and named — one for the "insufficient" vocabulary, one for a balance or credit described as gone — because the code and the sentence arrive in different fields and either alone has to be enough.

The refusal carries the figures that tell the two facts apart. The two-pocket Lua script returns the account's balance, the amount its in-flight holds are holding, and what was left for the request; `ReservationService` forwards them, `QuotaService.admit` carries them into the error, and `errorForRefusal` states them: *"insufficient balance: $1.27 of your $1.45 is already held by requests in flight, leaving $0.17 free for this one."* The refusal keeps its code, its status, and its terminal meaning — the words "insufficient balance" lead it — while the numbers make it answerable. An account holding nothing keeps the wording it has always had, because there the sentence was true.

The message is only changed when something is actually held. A refusal raised outside the reservation script has no in-flight hold to name, and a zero in its place would read as "nothing is held" rather than as "nobody counted".

## Alternatives considered

**Name the in-flight commitment as a new refusal reason.** A distinct `balance_committed` reason would classify the two cases at the source rather than in the message. Rejected: the client already branches on `AEVEN_INFERENCE_BALANCE_EXHAUSTED` to render the top-up action, and a new code would silently take the handful of clients that know about it down the unknown-code path — the same failure this note is about. The remedy is identical in both cases; only the explanation differs, and the explanation is prose plus two figures.

**Report the drawable remainder as `availableBalance`.** The member already exists and the UI shows it, so filling it with what the request could actually draw on would make the refusal's arithmetic self-consistent. Rejected: the member is the account's balance everywhere else it is read. A number that means "your money" on one screen and "your money after other requests" on the next is worse than a message that says both.

**Leave the classification alone and fix only the gateway's wording.** If the message had said "insufficient balance" from the start, the `\b`-anchored pattern would have matched it. Rejected as a repair: it fixes one spelling and leaves the recognizer unable to read an underscore-joined code, which is how every compatible gateway spells a machine-readable one — the client would stay blind to the next such body.

## Consequences

A spent balance is now terminal in the harness: it maps to `QUOTA_EXCEEDED_CODE`, so a route's retry policy never retries it and the client can offer the remedy it names. [retry.spec.ts](../../../../packages/llm/llm-retry/tests/retry.spec.ts) pins the client half — a turn refused this way ends on the failure, with no retry event and no scheduled timer — and [adapter.spec.ts](../../../../packages/llm/llm-deepseek/tests/adapter.spec.ts) pins the classification, including that a 402 saying nothing about funds stays `HTTP_402` rather than becoming a licence to call every 402 a spent balance.

The server side of the same incident is pinned in `servers/node`, where the money lives: a burst of concurrent requests against a purchased balance may never be served beyond it, a refused request never reaches the provider, the hold counters never exceed the balance mid-burst, and a request refused while its siblings hold the money becomes admissible the moment one of them settles. Those are end-to-end tests over the real Redis and the real script, because the invariant is Redis's single-threaded execution of that script and a double would only be testing the double.

What the incident was **not** is an overspend. Every request served during it was funded when it was admitted, a refused request never became a provider call, and the reconcilier found no charge the wallet had not taken. The account was never out of money; it was out of *holdable* money, which is a different state and needed a different sentence.
