# Bug log

Internal bug log for this checkout. Entries live in this file only: not GitHub issues, not Agent Notes, and nothing here is a code change.

- One entry per bug, id `BUG-NNNN`, never reused or renumbered. `grep -n BUG-0003` finds the entry, its index row, and every later mention.
- Add a bug by appending a section with the next id and a row in the index table.
- `Status:` is `open`, `fixed`, or `wontfix`. When a bug is fixed, add the fixing commit or PR beside the status and leave the entry in place.
- `Observed` is what a user saw. `Suspects` is where to read first — a lead to check, never a diagnosis.

## Index

| Id | Status | Area | Summary |
| --- | --- | --- | --- |
| BUG-0001 | fixed | Web GUI · right sidebar terminal | Terminal text is clipped by the sidebar's width |
| BUG-0002 | fixed | Web GUI · right sidebar terminal | The pane's scrollbar is xterm's default, unrelated to the theme |
| BUG-0003 | open | Web GUI · Chat, collapsed Think row | A collapsed Think row does not make clear the turn is still running |
| BUG-0004 | fixed | Agent behaviour · waits in shell calls | Aeven reaches for sleeps too often, and times them too long |
| BUG-0005 | fixed | Web GUI · right sidebar terminal | The grid is fitted to the pane's border box, so the text overruns its right inset |
| BUG-0006 | open | Agent behaviour · reply language | A reply comes back in a language the person did not write in |
| BUG-0007 | open | Web GUI · the transport generation | The whole GUI goes disconnected and reconnects under parallel work |
| BUG-0008 | open | Chat · the assembled transcript | Reasoning and tool rows show while the turn's replies are missing |
| BUG-0009 | open | Host and desktop app · retained memory | Sessions, terminals and stream queues are held; the app's own renderer grows without bound |
| BUG-0010 | open | Desktop app · window drag | Only the controls gutter drags the window; the rest of the top bar does not |
| BUG-0011 | open | Desktop app · right-click menu | A selection in a page offers only Copy, not the full edit menu |
| BUG-0012 | open | Desktop app · skill catalog | `skills/list` fails in the desktop window |
| BUG-0013 | open | Chat · running-turn chrome | The running spinner sits low and short of the row's trailing edge |

## BUG-0001 — Terminal text is clipped by the sidebar's width

- Status: fixed — working tree, `packages/client/ui-sidebar-terminal/src/client/TerminalPane.tsx` (add the commit here)
- Confirmed: the reporter, 2026-10-09, in the running app — the pane wraps at its own column count now (56 columns measured in a live pane, and a 120-character line wrapping 56/56/8)
- Reported: 2026-10-09
- Area: Web GUI, right sidebar terminal pane (`packages/client/ui-sidebar-terminal`), at http://127.0.0.1:3080
- Build: branch `experimental/aeven-next`, with the in-flight right sidebar terminal control ([note](.agents/notes/implemented/feature/2026-10-09-chat-sidebar-terminal-control.md))

**Observed.** Output wider than the terminal pane is cut off at the pane's right edge: the tail of a long line cannot be read. Reported as "the content of the terminal in the sidebar overflows the width of the sidebar, so you cannot read the full lines".

**Steps.** Start a terminal in the right sidebar and print a line wider than the pane: `ls -l ~/Projects` or `printf 'x%.0s' {1..200}; echo`. Compare the same command in a wide terminal.

**Expected.** The emulator's column count matches the pane's usable width (the pane insets 24px per side inside a 300px column), so a line either wraps at the pane's own column count or the pane offers a way to see the rest. Today the text simply disappears past the edge. Not verified: whether any horizontal scrolling exists, and whether widening the sidebar restores the clipped text.

**Suspects.** Read these first; none is confirmed.
- `packages/client/ui-sidebar-terminal/src/client/terminal.module.css` — `.screen` sets `overflow: hidden`, so anything wider than the box is clipped without a scrollbar.
- `packages/client/ui-sidebar-terminal/src/client/TerminalPane.tsx` — the snapshot branch resizes the emulator to the Host's grid (`xterm.resize(render.frame.info.cols, render.frame.info.rows)`), not to the pane's fitted grid; `fitScreen()` (FitAddon plus `model.resize`) is what reconciles the two, and it runs only from the `ResizeObserver`, on a `visible`/`writable` change, and with the pane's own `clientWidth` non-zero.
- `packages/api/terminal-controller` — the PTY's `cols` and the `maxCols`/`maxRows` limits the pane fits against.

**Open questions.** Does the clipping show on first paint and stay, or only while output streams? Does a pane resized wider recover the full lines (the fit lands) or stay clipped (it never lands)?

**Fixed.** The screen kept the shell's grid whenever a fit had not landed: a pane without input control copied `state.info.cols`/`rows` (the controlling view's width), a snapshot frame resized the emulator to `render.frame.info.cols`, and a fit attempt that failed — a hidden pill, an environment not yet loaded, or cell metrics that arrive with the emulator's first refresh — was never retried, so a ~30-column pane drew the shell's 80 and `.screen`'s `overflow: hidden` cut the tail. Both open questions describe that state: it lasts until something else moves the box, and widening recovers only because the resize observer then runs.

The pane's grid is now the box's own. `fitScreen` measures the box, clamps to the Host's limits, resizes the emulator, and forwards the size to the Host only from the view that holds input control — so a read-only pane wraps the same output at its own width instead of borrowing another attachment's. The grid a fit last landed is the only grid a snapshot may draw, and the fit retries on box resize, on each emulator render until one lands, once deferred after open, and on every visible, writable, environment or dimension change.

**Residual.** The clipping this report named had a second cause, found on 2026-10-09 and owned by BUG-0005 below: the fit measured the pane's border box, so even a fitted pane drew about six columns more than its box holds. Changing the fit alone did not clear the report; BUG-0005's fix is what makes the text stay inside the inset.

## BUG-0002 — The pane's scrollbar is xterm's default, unrelated to the theme

- Status: fixed — working tree, `packages/client/ui-sidebar-terminal/src/client/terminal.module.css` (add the commit here)
- Confirmed: the reporter, 2026-10-09, in the running app — the bar reads as one of the sidebar's own scroll surfaces
- Reported: 2026-10-09, as "can the scrollbar be improved?"
- Area: Web GUI, right sidebar terminal pane

**Observed.** The pane scrolls through xterm's built-in scrollbar (its CSS is derived from VS Code's `scrollbar.css`). Nothing themes it: `terminal.module.css` paints only `.xterm-viewport`'s background, and `terminal-theme.ts` sets foreground, background, cursor, and selection — never xterm's `scrollbarSliderBackground`, `scrollbarSliderHoverBackground`, or `scrollbarSliderActiveBackground`, which the installed `@xterm/xterm` 6.0.0 does expose. So the slider keeps xterm's default color and width inside a 300px sidebar where every pixel of text width counts.

**Steps.** Run a command with more output than the pane is tall (for example `ls -lR ~/Projects`) and compare the bar against the sidebar's own surfaces.

**Expected.** The bar reads as part of the sidebar: narrow, inset from the panel edge, rounded, drawn in a theme token that follows light and dark, quiet at rest and stronger on hover or drag — and a horizontal bar only when there is real horizontal overflow (see BUG-0001 above).

**Suspects.** The theme keys above, set where `TerminalTheme.apply()` publishes the palette (`packages/client/ui-sidebar-terminal/src/client/terminal-theme.ts`); width, inset, and radius come from CSS on `.xterm-scrollable-element > .scrollbar` and `> .scrollbar > .slider`. Decide rest-versus-hover visibility against the sidebar's existing scroll surfaces, which [web-styling.md](docs/web-styling.md) owns.

## BUG-0003 — A collapsed Think row does not make clear the turn is still running

- Status: open
- Reported: 2026-10-09
- Area: Web GUI, Chat — the collapsed Think (reasoning) row (`packages/client/ui-chat/src/client/chat/ReasoningRow.tsx`)

**Observed.** With reasoning collapsed, there is no clear way to tell that the conversation is still working. Reported as "when reasoning is collapsed there should be a better way to tell the conversation is in progress".

**Steps.** Send a prompt that produces a long reasoning trace, collapse the Think row, and watch the row while the turn continues — through a paragraph boundary, and into the tool calls that follow the reasoning.

**Expected.** The collapsed row alone says the turn is running, at a glance and without motion: legible when animations are off and when the row is not hovered.

**What signals exist today.** While `running`, the row sweeps a 300px gradient across itself (`avn-reasoning-row-sweep`, 2.6s), the "Think" title shimmers (`TextShimmer active` in `packages/client/ui-primitives/src/DisclosureRow.tsx`), the summary line follows its newest words as each fades in, and a visually hidden label carries the state for assistive technology.

**Suspects.** The three visual signals are all motion, and `@media (prefers-reduced-motion: reduce)` in `ReasoningRow.module.css` turns off the sweep and the word fade, leaving the collapsed row close to indistinguishable from a settled one. Between reasoning paragraphs and after reasoning hands off to a tool call, none of the signals describes the turn as a whole. The collapsed summary's design is owned by the [thinking tail scroll note](.agents/notes/implemented/feature/2026-08-02-web-thinking-tail-scroll.md).

**Candidate directions.** A persistent running affordance in the row that does not depend on animation (an elapsed-time counter or an animated-state glyph that also has a static form), and a settled-versus-running difference the reader can see without hovering or opening the row.

**Suggested fix.** Give the collapsed row one signal that belongs to the turn rather than to the reasoning stream, and that survives animations being off: a static glyph plus an elapsed counter, visible while the turn runs and gone when it settles, driven by the same `running` state the sweep already reads (`packages/client/ui-chat/src/client/chat/ReasoningRow.tsx`). Leave the sweep and the shimmer for readers who allow motion, and let the reduced-motion branch show the static affordance too, so the two branches differ in animation rather than in information.

## BUG-0004 — Aeven reaches for sleeps too often, and times them too long

- Status: fixed — working tree, `packages/shell/tool-bash/src/index.ts` with the recorded system prompts under `snapshots/` (add the commit here)
- Reported: 2026-10-09, as "Aeven when writing code uses sleeps, but too often and they are timed too long"
- Area: what the model is told about waiting in the calls it runs — the `tool:bash` prompt section
- Refined with the reporter: the sleeps in question are the ones in the calls it runs, bash first ("some really stall and are not necessary"); the code it writes is a separate reading, left to the open questions below

**Observed.** Sleeps appear far more often than the work needs, and each one is longer than the thing it waits for: a fixed multi-second pause stands in for a condition the call could observe. Reported as "Aeven when writing code uses sleeps, but too often and they are timed too long".

**Steps.** Watch a session that edits code and then verifies it: `sleep 20` between checks, or a foreground command whose only work is waiting.

**Expected.** A sleep is the last resort, not the default: wait on the event, the signal, the process, or the job, and return as soon as it settles. Where a sleep is genuinely about a clock — a rate limit, a debounce, a poll with no signal to await — it is the shortest that works, bounded by a deadline, and stated as the reason rather than chosen by feel.

**Suspects.** Read these first; none is confirmed.
- `packages/jobs/tool-jobs/src/index.ts` — the section tells the model not to "busy-poll or sleep on one" for a background job, and says nothing about a sleep that covers no job.
- `packages/shell/tool-bash/src/index.ts` — `bashDescription()` and the `tool:bash` section carry no bound on a sleep, so `sleep 30` in a foreground call reads like any other command.
- `packages/preset/agent-presets/presets/aeven/agent.cordis.yml` — the persona and the instruction rows state voice and workspace facts; no row states a waiting habit.
- `.agents/skills/avn-ci-test-reliability` — covers sleeps in *this* repository's specs, so it reaches aevn's own tests only, not code written in someone else's project.

**Fixed.** Nothing in the prompt told the model what a foreground wait costs, and the one sentence that mentioned sleeping covered jobs only, so a bare `sleep 30` read like ordinary work. The `tool:bash` section now states the policy: never spend a call waiting, because a foreground `sleep` burns the step and returns nothing; wait on the condition instead — collect the job with `job_output`, let the program retry for itself (`curl --retry`, `--retry-delay`), or check the condition in a bounded loop that returns the moment it holds; end the turn when nothing useful is left, since a job that settles wakes the owner; and where a clock is the real constraint, take the shortest pause that constraint allows. The 31 recorded system prompts under `snapshots/` carry the new paragraph.

**Left open.** The sibling surface: `tool:pwsh` states its own exit-code rule and no waiting policy, so a Windows session keeps the habit. The sentence has no shared owner yet — `tool-bash` and `tool-pwsh` are separate Consumers with parallel sections, and a second copy of the text is what the cross-file duplication gate exists to catch — so whoever takes it decides between a shared text owner and a justified copy. Also unaddressed: sleeps inside *written* code (a test, a script, a retry loop), which no tool boundary can see, and the multi-second stalls the reporter called out — this change is guidance only, with no call refused and no wait capped.

## BUG-0005 — The grid is fitted to the pane's border box, so the text overruns its right inset

- Status: fixed — working tree, `packages/client/ui-sidebar-terminal/src/client/terminal.module.css` (add the commit here)
- Confirmed: the reporter, 2026-10-09, in the running app — "the terminal scroll and width is fixed"
- Reported: 2026-10-09, with a screenshot of the widening `systemctl` table: "terminal has incorrect right padding.. should be 24px at least. scrollbar has the right position"
- Area: Web GUI, right sidebar terminal pane (`packages/client/ui-sidebar-terminal`), after the BUG-0001 fit change

**Observed.** Terminal output runs from the pane's 24px left inset to the panel's right edge, with the last columns cut off and the scrollbar drawn over the text. The scrollbar itself is where it belongs — at the pane's content edge — and the left inset is right.

**Steps.** Print a line wider than the pane in a right sidebar terminal — the `systemctl --state=running` table in the report, or `printf 'x%.0s' {1..200}; echo` — and compare the two insets.

**Expected.** Both sides carry the pane's own 24px inset: the emulator's grid fits the area it actually draws in, the scrollbar takes its track to the right of the last column, and nothing is clipped.

**Fixed.** `.screen` insets 24px per side, and the vendored `ui-auth-aeven` sheet applies `*, *::after, *::before { box-sizing: border-box }` app-wide, so `getComputedStyle(screen).width` — the reading `FitAddon.proposeDimensions()` fits against — reported the 300px border box instead of the 252px the emulator draws in. Measured in a browser with that rule in force: 300px border-box against 252px content-box, with the rendered width identical either way. The fit asked for floor((300 − 14) / cell) columns, 36 rather than 30 — 281px of text in a 252px area — and `overflow: hidden` clips at the padding edge, so the surplus reached the panel's edge instead of stopping at the inset. `.screen` now states `box-sizing: content-box`, which makes that reading the drawing area, and the comment there names the trap.

## BUG-0006 — A reply comes back in a language the person did not write in

- Status: open
- Reported: 2026-10-09, as "What is with the chinese?" and then "Pff That should never happen."
- Area: which language the model answers in — the one persona sentence that states the rule, and the absence of any check on the reply before it is sent
- Session: Web GUI at http://127.0.0.1:3080, an English-only conversation doing shell and filesystem work in the home directory

**Observed.** Every message the person sent was English, and the reply that answered "for comfy ui did you also delete the models???" arrived as Chinese prose from its first word to its last — not a quoted phrase, not a file name, the whole answer. The person asked what the Chinese was about, then said it should never happen. Nothing in the conversation had asked for another language, and the session had been English throughout.

**Steps.** Run a session in which the person writes only English, over several turns, while the files and recalled context available to the session include Chinese text (this repository's `.zh.md` siblings, its Chinese-first client key dictionaries, memory lines about the bilingual docs). Ask a short follow-up after a multi-step tool turn and watch the language of the reply's own prose.

**Expected.** The reply's own prose stays in the language the person writes in — every reply, every turn, without being asked and without being reminded. Quoted text, paths, identifiers, and command output keep the language they came in. If a reply does slip, the person is told and the next reply is back in their language, and they never have to read an answer in a language they did not write in.

**Suspects.** Read these first; none is confirmed.
- `packages/preset/agent-presets/presets/aeven/agent.cordis.yml:34` — the only statement of the rule in the repository, one sentence among many in the persona: "Reply in the language the person writes in." It says nothing about which language wins when the session's context is mixed, and nothing about a reply that has already gone out in another language.
- Nothing enforces or watches it. `grep -rn "Reply in the language" packages` finds that single line; no snapshot under `snapshots/` carries the persona text, and the plugins in `packages/guard/` (access-policy, repeat-tool-reminder, timeout-policy) all check tool calls, none checks the reply that reaches the person.
- The model itself: the session ran on this checkout's DeepSeek provider, whose output prior is not English-weighted the way the prompt's single sentence is. Unconfirmed, and no bug is claimed on the provider.
- The context around the turn: recalled memory and repository files put Chinese in front of the model every turn (the bilingual documentation convention, `.zh.md` files, `packages/client/locale`'s Chinese key-set source of truth). Whether that biases the reply language has not been tested.

**Open questions.** Does the slip follow a turn that read Chinese text, or a long turn, or neither — is it reachable in a session whose context holds no Chinese at all? Does a rule stated once in the persona hold better when restated with the request, and where would that belong without adding a per-step prompt cost? Is checking an outgoing reply worth a pass of its own, and would it sit beside the existing guard plugins or somewhere else?

**Suggested fix.** Make the rule do what one sentence cannot, in the place it is already stated: the persona line (`packages/preset/agent-presets/presets/aeven/agent.cordis.yml:34`) should name what wins when the session's context is mixed — the reply's own prose follows the person, while quoted text, remembered content and file content keep the language they came in — and say that a reply which slips is corrected in the next turn. If a slip survives that, catching it belongs where the reply is produced rather than in the tool-call guards: a check on the outgoing text against the language the person's recent turns used, as a plugin beside `packages/guard/`, with the correction or the apology reaching the person. Build the second part only if the restated rule still slips.

## BUG-0007 — The whole GUI goes disconnected and reconnects under parallel work

- Status: open
- Reported: 2026-10-09, as "Under heavy work, there are disconnects?", refined with the reporter: the GUI itself goes disconnected and reconnects, and what was running was parallel subagents or workflows
- Area: the Web GUI's transport generation — the host's WebSocket stream mux (`packages/api/gateway`) and the browser's reconnect loop (`packages/client/connection`)

**Observed.** While several subagents or workflows run at once, the whole GUI loses the host and reconnects — not one pane, every stream it holds at the same moment. Reported as "Under heavy work, there are disconnects?"; the reporter's refinement is that the app itself goes disconnected and reconnects, under parallel subagents or workflows.

**Steps.** From one session with the GUI open, start several background subagents or workflows and watch the connection state while their streams and large tool results arrive. The loss belongs to the busy period, not to an idle host: it has not been seen while nothing ran.

**Expected.** Heavy work costs latency, not the connection. A host or a browser busy for seconds delays frames; it must not terminate a transport that is healthy and in use, and losing it must not depend on the person noticing a disconnected state and reconnecting by hand — with the work still running when they do.

**Suspects.** Read these first; none is confirmed. Everything a browser holds rides one socket — unary RPC posts to `/api` (`packages/client/connection/src/client/rpc.ts:43`) while every logical stream and the connection generation multiplex over one WebSocket at `/api/remote.mux` (`packages/api/gateway/src/stream-protocol.ts:6`) — which is why the loss is the whole GUI rather than one pane.
- **The heartbeat is also the pong deadline.** `packages/api/gateway/src/stream-server.ts:26,103-118` pings every `heartbeatIntervalMs` — default 2000, `packages/api/gateway/src/index.ts:127` — and calls `socket.terminate()` after `MAX_MISSED_HEARTBEATS = 2` ticks without a `pong`; the counter resets only on `pong` (`:77`). Any ~4-6 second window in which the host cannot read its sockets, or the client cannot answer, kills a connection that is carrying live streams — and the gateway README admits it: "a deployment whose event loop or network can stall longer than this interval must raise it" (`packages/api/gateway/README.md:78`). Parallel orchestration, session-log writes, compaction and frame serialization share that loop.
- **One stream's trouble can close the whole connection.** `packages/api/gateway/src/stream-server.ts:197-205` fails the physical generation — `socket.close(1011, 'Remote stream failure could not be delivered')` — when a terminal frame cannot be written or encoded, so one agent's stream failing takes every other pane with it.
- **No HTTP timeouts are configured on the GUI server.** `packages/host/webserver/src/index.ts:245-259` sets none, so Node's defaults stand (keep-alive 5s, headers 60s, request 300s). A browser reuse of a keep-alive connection the server is closing at that moment fails the `fetch`, and `rpc.ts:43-53` turns that into an untyped `Error` with **no retry and no generation invalidation** — a lost unary request that only a full reconnect clears.
- **Work multiplies without a global ceiling.** A workflow run starts up to `min(16, parallelism - 2)` concurrent agents *per run* (`packages/workflow/workflow-worker-thread/src/index.ts:151-153`) with no global cap, jobs allow 10 per owner (`packages/jobs/jobs-local/src/index.ts:33`), and the gateway keeps no cap on concurrent logical streams — `this.streams` is an unbounded map (`stream-server.ts:129`).
- **Load can amplify itself.** The LLM retry policy allows 5 attempts, 500ms to 10s, including the `TRANSPORT` class (`packages/llm/llm/src/retry-policy.ts:14-24`), and each attempt re-sends the whole request (`packages/llm/llm-retry/src/index.ts:223`) — so a saturated provider or host inflates traffic exactly when the loop is least able to serve it. On the way in, a request body is buffered whole in memory with a 300 MiB cap (`packages/client/connection/src/http-bridge.ts:12,47-66`).
- **One slow consumer head-of-line-blocks every stream on the socket.** All frames of all streams go through one `writes` promise chain per socket, each pump awaiting each send (`packages/api/gateway/src/stream-server.ts:130,194,210-229`), and the client's inbox is an uncapped deque (`packages/api/gateway/src/client/stream-client.ts:276-301`).
- **The state the person sees lags the retries.** `disconnected` is emitted only at the final backoff tier (`packages/client/connection/src/client/connection.ts:27-32,198-204`), so earlier failures publish `connecting` for 15-20s — a disconnected indicator may mean the ladder had already run out, and it is rendered with a click-to-reconnect action (`packages/client/ui-primitives/src/ConnectionIndicator.tsx:64-90`).
- **Memory in the host is unmeasured for this report.** The reporter asked for a leak check in the same breath. Two samples of the running host 5 minutes apart read RSS 1.72 GB then 1.68 GB with 600 → 564 open descriptors and 45 → 40 sockets — flat in that window, which rules out nothing about a slower climb, a per-period retention, or fragmentation. No leak is claimed yet.

**Open questions.** Which mechanism fires — the host's close code and its own log tell heartbeat `terminate()` from `1011` from an ordinary network close — and is the host's event loop measurably stalled at that moment or merely busy? Did the GUI come back on its own, or only after the click-to-reconnect action (the ladder's final tier parks)? How many concurrent streams and how many workflow runs were live: does the loss track stream count, total frame rate, or one long host-side stall? Does a scripted burst of workflow runs reproduce it, and does raising `heartbeatIntervalMs` alone (2s → 30s) stop it — the cheapest experiment, since the README already says a stalling deployment must raise it? What was the host's RSS at the moment of loss, on the same host that reads 1.7 GB now?

**Suggested fix.** The cheapest experiment first, and it needs no code: raise `heartbeatIntervalMs` from its 2000 ms default (`packages/api/gateway/src/index.ts:127`) to something a busy host cannot collide with — 30 s — restart, and repeat the parallel-subagent burst that produced the loss. If the disconnects stop, the heartbeat is the cause and the real fix is to make the deadline generous and to stop treating every missed pong as a dead peer (bound termination to sockets that are also write-idle, or escalate before terminating). If they persist, the next two suspects are wrong regardless of the heartbeat: the untyped, unretried `fetch` failure on the RPC path (`packages/client/connection/src/client/rpc.ts:43-53`), and workflow concurrency that multiplies without a global ceiling (`packages/workflow/workflow-worker-thread/src/index.ts:151-153`).

## BUG-0008 — Reasoning and tool rows show while the turn's replies are missing

- Status: open
- Reported: 2026-10-09, with a screenshot of the Chat pane: "Weird state of the conversation add this to the bugs"
- Area: the Chat transcript assembled from the session log (conversation nodes) plus the turn-in-progress row — Web GUI and the desktop window alike
- Build: the desktop app window in the screenshot (menu bar reads "Æven Dev"), one session, its right sidebar listing Files, Browser, Terminal and Device Emulator

**Observed.** The transcript between the person's own messages holds only reasoning rows and tool-call rows: "Continue with that", then Think → Tool call (`mail_search`) → Think → Tool call (`mail_read`) → Think → Tool call (`mail_read`), then "You can do that!", then a turn marker reading "Ævening for 12s", then "Wat are you doing???", then "Ævening…" again with a working spinner. No assistant prose appears anywhere in the visible window, although three tool calls completed inside it; the header reads "5 agents"; and the composer holds a queued message ("Find and track open Dutch public-sector / vital-sector contract assignment…") under the hint "Cmd/Ctrl+Enter steers all queued messages".

**Steps.** Not established. The state was reached in a session that had several subagents running while turns streamed reasoning and tool calls. Reading the matching `session.jsonl.zstd` under `~/.aeven/sessions/<working-directory>/<session-id>/` would separate a transcript that lost rows from a turn that produced none — the session could not be identified from the screenshot, and a scan of the 80 most recently written logs under `~/.aeven/sessions` found no copy of the quoted messages.

**Expected.** Each turn's rows appear in order and complete: the person's message, the assistant's prose, its reasoning and tool calls where they happened, one turn-in-progress row per running turn and none left over; a tool call that completed is never the last visible thing its turn left behind, and subagent work named in the header is traceable in the transcript.

**Suspects.** Read these first; none is confirmed.
- **A window replaced after a transport loss.** The client rebuilds its transcript from a baseline when the journal stream resumes (`docs/subsystems/web-client.md`); rows the baseline does not carry can be missing for a turn that was streaming when the connection dropped — BUG-0007 above is that same connection, reported by the same person on the same day.
- **The turn-in-progress row.** Two of them surround one person's message, one carrying an elapsed counter; the row belongs to the client's turn state rather than to the log, so a duplicated or re-created row points at turn state that survived a reconnect or a remount while its turn did not.
- **Prose rows for a turn whose deltas were split.** Assistant text reaches the Chat through packed runs and scalar events with `chunkrow/*` branches; a turn whose deltas arrived on two generations can lose the text row while keeping the reasoning and tool rows the same turn produced.
- **Subagent work that left no card.** "5 agents" is the header's count; whether their runs left visible tool cards at all is unverified from one screenshot.
- **A queue that never ran.** The queued message is consistent with a turn parked in the state BUG-0007 describes, where the reconnect ladder had run out.

**Open questions.** Which session is it — the log is the first thing to read, since it says whether those turns contain assistant text at all. Did a disconnect happen in the same window, and did the person reload or reconnect between the rows that are present? Does the doubled turn-in-progress row reproduce with a single healthy turn, or only across a resync? Is the missing prose reproducible by reconnecting deliberately mid-turn?

**Suggested fix.** Identify the session before changing anything, because the fix differs by what the log holds. Read its `session.jsonl.zstd` under `~/.aeven/sessions/<working-directory>/<session-id>/`: if the log carries the assistant text rows for those turns, the client dropped them while rebuilding its window, and the fix lives in the window replacement — make the baseline and the live tail overlap by sequence instead of assuming the baseline is complete — which is also the property BUG-0007's reconnection has to preserve. If the log holds no such rows, the turn genuinely ended without a reply and the bug is in the turn lifecycle: a turn that finishes leaves prose or an explicit failure. Either way the doubled in-progress row is client state to fix on its own: one row per turn, keyed to the turn it belongs to.

## BUG-0009 — Sessions, terminals and stream queues are held after the work ends

- Status: open
- Reported: 2026-10-09, asked for alongside the disconnect report: "Can you also check for mem leaks?"
- Area: what a long-lived host process keeps — the session controller's Agent handles, terminal reclamation, and the per-connection stream queues
- Measured on: the running host at http://127.0.0.1:3080 (PID 63830, up 5h06m at the first sample)

**Observed.** The reporter asked whether the host leaks. It held RSS 1.72 GB with 600 open descriptors and 45 sockets, and read 1.68 GB / 564 / 40 five minutes later — flat across that window, so this is a steady footprint and a question about what is retained, not an observed climb. This checkout's data directory is 8.3 GB, of which a 339 MB session-query index and a 114 MB memory store are the agent's own.

**The reporter's own surface is the desktop app, not the host.** The Electron window (`apps/desktop/.desktop-build/development/Aeven Dev.app`, main process 88422, up 1:56) adopts this host at `http://127.0.0.1:3080` rather than serving its own. Sampled alongside the host at 18:50: 2,560,320 KB across 9 processes — main process 219 MB and flat, renderer processes 2,341,040 KB of it, with one renderer (88430) the single largest consumer in the machine at 1.5 GB and moving by hundreds of MB between minutes (other renderers rose and fell, 44757/44758 exited). Nothing in that sketch is a leak verdict; it says the app's own renderer, not the host, holds the biggest working set, and that the client's retention — the transcript, the uncapped stream inbox (`packages/api/gateway/src/client/stream-client.ts:276-301`), and the client store caches — belongs in this check.

**Expected.** Process memory follows live work: a Session the GUI opened and closed, a terminal nobody watches, and a browser that stopped reading all give their memory back without waiting for a restart, and no per-connection queue grows without a bound.

**Suspects.** From a read-only scan, each verified by reading the code and each ranked; the size of each in the running host has not been measured.
- **An Agent handle per opened Session is never released.** `packages/api/session-controller/src/agent.ts:168` holds `handles: Map<SessionId, AgentHandle>`, filled at `:570`; the only removal is `release()` at `:587`, whose single caller is the move command (`packages/api/session-controller/src/commands.ts:470`). There is no idle TTL, so the Agent fiber, its session entry, the event log and the frozen snapshot stay resident for the process lifetime.
- **Terminal reclamation can never fire.** `packages/api/terminal-controller/src/terminal.ts:57` hands the retention monitor an inspector that always answers `UNKNOWN_ACTIVITY`, while `packages/api/terminal-controller/src/retention.ts:135-139` closes only once the activity reads `idle` continuously for `unattendedTimeoutMs` (default 7,200,000 ms, `src/index.ts:97`). Every browser terminal — headless screen plus scrollback — therefore lives until an explicit close, and owner disposal waits on the Agent of the previous item.
- **An unbounded queue per browser.** `packages/api/gateway/src/index.ts:923` accumulates forwarded event frames (pushed at `:472`) and drains them only as fast as the socket writes (`packages/api/gateway/src/stream-server.ts:193-194`); the client is dropped when the socket close is detected at `:590`, which the heartbeat delays by at least two intervals.
- **An unbounded control-stream queue.** `packages/api/session-controller/src/control.ts:149` buffers queue splices, projection changes and job events for every open control stream (the stream each GUI tab holds), at `:153-159`; cleanup runs on abort (`:65-68`), so a slow reader grows it in the meantime.
- **A per-follow event buffer.** `packages/api/session-controller/src/history.ts:117` fills from the `session/event` listener (`:131-135`) and drains at iteration speed; its finally cleanup (`:192-197`) is reachable, so it is bounded only by the consumer.
- **A wide object kept where metadata was expected.** `packages/session/session-persistence/src/coordinator.ts:1186-1194` assigns `source.inspection` — which carries the whole `events` array (`:1174`) — into a field typed `SessionStorageMetadata` (`:283`), where TypeScript's excess-property check does not apply; it is dropped only by `disposeSession` (`:1402`) or `delete` (`:777`), so a state created by a read that never disposes stays.
- **A per-owner id set.** `packages/api/terminal-controller/src/index.ts:381` keeps one id per closed terminal, cleared only at owner disposal — the same unreachable condition as the Agent handles.

**Checked and clean.** `job-controller` unsubscribes observations in a `finally`; the gateway's client-side pending maps delete on settle or abort; `session-projection` and `session-projection-cache` use WeakMap cells and retire their dirty set; `subagent` continuation listeners are child-scoped and removed on disposal; workflow workers terminate on settle; `llm-retry`'s active promises remove themselves; the `llm-pi-ai` and `subscription-auth` maps are catalog-sized rather than per-request.

**Later samples bound the client's growth to what is open.** Reading every window's heap and DOM size once a minute (through the app's main-process inspector, read-only) shows the footprint coming back down without a restart: the app window's JS heap fell from 437 MB to about 125 MB and its DOM from 17,401 nodes to between 7,700 and 11,300, the renderer working set from 3,436 MB to 918-1,129 MB, and the process count from 7 to 5, while the host stayed between 1.3 and 1.6 GB. Which of those numbers followed from closing DevTools, from closing a session or pane, and from ordinary collection was not separated — but the shape is what the retention list predicts: released when the session scope is pruned, not on a cap or an idle path. So the client's problem is the ceiling one long-lived session can reach, not a climb that never returns.

**Not covered.** `packages/core/agent-loop/src/index.ts` (`liveAgents`/`startupTasks`), `packages/compaction/**`, `packages/context/**`, the subscription-auth token caches, and the session-query index's own row retention.

**Sampled over 30 minutes, the host is not the leaker.** Across 18:37-19:07 its RSS ran 1.75 GB down to 1.57 GB, between 1.37 GB and 1.83 GB, with the mean of the second half (1.61 GB) below the first (1.73 GB); descriptors fell 540 to 472 and sockets 40 to 27. The desktop app sampled across 18:49-19:19 did the opposite: 2.42 GB to 3.37 GB across its processes, between 2.32 GB and 3.97 GB, with the mean of the second half 3.39 GB against 2.86 GB for the first — and essentially all of it in the renderer processes (2.21 GB to 3.17 GB, half-means 2.66 GB to 3.18 GB) while the main process sat between 194 MB and 231 MB and ended lower than it started. Its process count moved between 7 and 12 as windows came and went, and the following half hour opened with a sample of 4.7 GB across 16 processes. The growth the reporter pays for is therefore the client's own renderer, not the host — the retention list above is a separate and slower question.

**Naming the holder needs renderer introspection, which is not currently open.** The running app exposes only the main-process inspector on `127.0.0.1:9229`; the dev launcher's renderer debugging port (`apps/desktop/scripts/dev.ts:94-116`) is not listening in this run, and the adopted host has no inspector at all. Relaunching through the launcher prints `inspectors main=…, renderer=…, host=…`, after which a renderer heap snapshot (or the cheap `Runtime.getHeapUsage` / `Memory.getDOMCounters` counters) names what grows: JS heap, DOM rows, or listeners. Also worth ruling out before that: development opens DevTools detached (`apps/desktop/src/main.ts:508`), which holds memory in its own window, and `AVN_DESKTOP_OPEN_DEVTOOLS=0` removes it from the accounting.

**Attributed from inside the app, read-only.** The app's network service holds its connections to `127.0.0.1:3080`, which confirms the desktop window and the sampled host are the same conversation. Reading Electron's own metrics through the app's main-process inspector at 19:30 (`app.getAppMetrics()` plus a per-window `performance.memory` and DOM count, nothing mutated) separates the footprint: the main process holds 193 MB with an 11 MB JS heap; the renderer working sets total 3,436 MB, of which the largest single JS heap is the **detached DevTools window at 879 MB** — dev-only, `apps/desktop/src/main.ts:508` opens it and `AVN_DESKTOP_OPEN_DEVTOOLS=0` removes it — while the **app window holds 437 MB of JS heap over 17,401 DOM nodes** with 6 images and no canvas. So about a quarter of the app's footprint is JS heap, the rest renderer memory the JS counters do not describe, and the biggest JS heap in the process tree is not the session at all. A poller records per-window heap, DOM nodes and renderer working set every minute to say which of the three grows.

**Client-side holders, ranked.** A read-only scan of the browser half found the growth axis: a session's transcript is retained whole, and nothing trims it on a cap or an idle path — it is released only when the session scope is pruned. Each line is code-read, in descending order of how much it can hold.
- **The client's session event window never loses an entry.** `packages/api/session-controller/src/client/contract/events.ts:192-199` turns every live event into a new concatenated leaf, and `:66-76` caches a materialized copy per snapshot; `loadOlder()` prepends pages (`src/client/sessions/session.ts:454-470`) and only grows it. Release is `replaceWindow` (open, resync, gap repair) or session disposal. The repository's own benchmark puts the size on record: a production session's tail page held 416,756 logical events, and the client's scalar path sampled a **612 MB heap peak against 199 MB** for packed input (`.agents/notes/implemented/architecture/2026-08-15-packed-session-history-transport.md:27,37`).
- **The assembler keeps one entry per event and one set per context.** `packages/client/ui-conversation/src/client/conversation/assembler.ts:159-168` fills `inputs`, `contextsBySeq`, `contexts`, `contextsByTarget` and `dependents` on append (`:230,:531-533`) and clears them only in `replaceWindow` (`:195-203`).
- **Chat node indexes are never pruned.** `packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts:68-74` creates a keyed snapshot plus its sources and process-sources per node (`:82,:89`), and no delete exists in the class; `SkillNameProjector` (`:518-520`) and `LegacySliceBuilder` (`:751-754`) hold node-keyed maps alongside, with `apply.ts:145-146` minting a record per rendered node.
- **The transcript is not virtualized.** `packages/client/ui-chat/src/client/chat/ChatView.tsx:183-193` maps the whole `order` into mounted seats, and no `content-visibility` fallback exists in the chat styles — so every node in the window carries a DOM subtree, highlighted code, and any images, which is the largest raw-memory item in practice. The measured window bears this out: the app window held 17,401 DOM nodes for one conversation.
- **Location data stores keep a store per turn and per step.** `packages/client/ui-conversation/src/client/conversation/location-index.ts:183-184,:218-223`; `replaceData` walks the union of old and new keys without ever dropping a store, and `MutableLocationDataStore.sources` (`:52,:61-68`) is never pruned.
- **The stream inbox has no cap.** `packages/api/gateway/src/client/stream-client.ts:275-302` buffers whatever the socket delivers while a consumer awaits, clearing only on failure or carrier loss (the per-stream map itself does delete in its `finally`).
- **Manager and pane state clears only when a session is removed.** `packages/api/session-controller/src/client/sessions/manager.ts:98-144` (`queues`, `projectionStores`, `addresses`, `catalogs`, `jobsBySession`, `entryCache`, `prevRunning`) is deleted at `:763-765,:960` only for removed sessions, and `chatScrollPositions` (`packages/client/ui-chat/src/client/apply.ts:79`) drops only the newly activated session's entry.
- **One cleared cache no one calls.** `packages/client/hypermarkdown/src/engine/mermaid/cache.ts:17` retains rendered SVGs per chart and exports `clear()` (`:162`) with no caller in `src/`.

**Clean in the client.** Attachments and images revoke on the right paths (`packages/client/ui-attachment/src/client/ComposerAttachments.tsx:39-63`, `historical-images.ts:171-202`; only Chromium's own decoded-image cache sits behind the `<img>` elements), and every observer, socket and store instance checked is released — `ui-renderer` uses WeakMap caches and does release per-session store instances (`packages/client/ui-renderer/src/client/registry.ts:551-559`).

**Two owners, one report.** The host list above and the client list here are different subsystems with different fixes; the measured growth so far belongs to the client, and it is a retention *policy* question — window trimming, transcript virtualization, or both — rather than a single missing `delete`.

**Open questions.** Which of the host retention paths above actually accounts for its 1.8 GB — a heap snapshot of the host would name it, though the host carries no inspector today and a relaunch is what opens one; a restart with the same sessions reopened would show the floor instead. Does the app's renderer keep climbing over hours or plateau once the transcript stops changing — the sampler running past this entry's first window answers that. Does its footprint fall when the GUI closes a session or a pane, and does closing DevTools change the picture? Is 1.8 GB expected for the number of sessions this host has served, and does the 339 MB session-query index sit in its page cache?

**Suggested fix.** Take the client half first, because that is the measured growth. Cheapest step with the most effect: virtualize the transcript (`packages/client/ui-chat/src/client/chat/ChatView.tsx:183-193`) — `content-visibility: auto` with a containment box on mounted rows, or a windowed list — which bounds DOM, layout and decoded-image cost without touching history semantics. Then bound what is retained: trim the client's event window to the pages a reader can still scroll back to plus the live tail, and drop the assembler's per-event and per-node indexes for everything trimmed (`packages/api/session-controller/src/client/contract/events.ts:192-199`, `packages/client/ui-conversation/src/client/conversation/assembler.ts:159-168`, `chat-snapshot-builder.ts:68-74`). The host's list is slower and separate: give the session controller's Agent handles an idle TTL or a release when a session's last tab closes (`packages/api/session-controller/src/agent.ts:168,587`), and either wire the terminal activity inspector to real activity or drop the unattended close that can never fire (`packages/api/terminal-controller/src/terminal.ts:57`). None of this is model-visible, so no session-log change is needed; both halves want an Agent Note, and anything the person sees wants a snapshot update.

## BUG-0010 — Only part of the top bar drags the desktop window

- Status: open — logged on request, no fix attempted
- Reported: 2026-10-09, as "i can use the whole top bar to drag and drop. Which i cannot do in the electron app of aeven. If I click above search etc the app is not dragable. Check how t3code does it and see where the differences are"
- Area: the desktop shell's frameless window drag region — `packages/client/ui-layout/src/client/AppFrame.module.css` for the strip, `apps/desktop/src/main.ts` for the window options; the reference the reporter points at is `resources/t3code` (`apps/web/src/index.css` and its components)
- Build: the development desktop app (`Aeven Dev.app`) on macOS, `titleBarStyle: 'hiddenInset'`

**Observed.** The window drags only from the narrow band beside the traffic lights. Clicking and dragging anywhere else on the top bar — above the search field, over the header's empty space, over the tab strip — does nothing.

**Steps.** In the desktop app, press and drag on the top bar at several places: the controls gutter, the empty band beside the lights, just above the search field, the header's blank area, and the right-hand control cluster. Compare with t3code, where the same drag works across the whole bar while its buttons, fields and links still take their clicks.

**Expected.** The whole top bar drags the window, with every interactive control in it — and the window controls of the host platform — staying clickable instead of dragging.

**Suspects and the difference.** Read these first; none is confirmed.
- **Aeven's entire drag surface is one pseudo-element.** `packages/client/ui-layout/src/client/AppFrame.module.css:359-371` — `.frame::before` under `html[data-avn-desktop]`, with `-webkit-app-region: drag`, `width: calc(var(--dsw-aeven-window-controls-gutter) + 20px)`, `height: calc(8px + var(--dsw-aeven-control-size))` and `z-index: 60`. Its own comment states the reason it stops there: the band "covers only the gutter the window controls sit in … and no further", because "a band across the full width takes those clicks even with `pointer-events: none`, since a drag rectangle is applied by the window rather than by hit testing".
- **t3code states the same drag on a container and then opts the children back out.** `resources/t3code/apps/web/src/index.css:1670` `.drag-region { -webkit-app-region: drag; }`, then `:1673-1681` `@layer base { .drag-region > * { -webkit-app-region: initial; } }` with the note that "Electron 44 inherits app-region. Reset children to the initial value so they do not add drag rectangles over fixed controls. Explicit `none` is treated as `no-drag` and breaks titlebar dragging; `initial` emits no rectangle. The base layer lets explicit drag/no-drag utilities take precedence." After it, `:1684-1690` declares `no-drag` on `button, input, textarea, select, a` inside the region.
- **t3code also marks individual controls.** Components carry `[-webkit-app-region:no-drag]` where inheritance would otherwise swallow a click — the panel-layout controls (`resources/t3code/apps/web/src/components/chat/PanelLayoutControls.tsx:37,44,65,115`), the sidebar's title-bar control (`components/ui/sidebar.tsx:331`), dialogs and menus (`components/ui/dialog.tsx:79`, `components/ui/menu.tsx:55`) — and overlays the right-hand cluster with a fixed `pointer-events-none … w-28 … [-webkit-app-region:no-drag]` band (`components/RightPanelTabs.tsx:1402`, `components/ChatView.tsx:9745`), which is the control-cluster problem Aeven solves by shrinking the strip instead.
- **Aeven declares `app-region` exactly once in the whole tree.** A repository-wide search for `app-region`/`appRegion` finds only `AppFrame.module.css:359`: nothing resets the inherited value on descendants and no control anywhere declares `no-drag`, which is what makes a full-width band unsafe today.
- **The window options differ too.** Aeven passes `titleBarStyle: 'hiddenInset'` with a fixed `trafficLightPosition` (`apps/desktop/src/main.ts:155-156`), while t3code derives its title-bar geometry from `env(titlebar-area-*)` and a `.wco` variant for the overlay case (`resources/t3code/apps/web/src/index.css`).

**Suggested fix.** Replace the fixed strip with a full-width drag region on the top bar and take t3code's two-part pattern: reset descendants with `-webkit-app-region: initial`, then declare `no-drag` on everything in the row that takes a click — the search field, the pill/tab controls, the right-hand cluster, and the platform window controls' gutter. Keep the two cautions the reference spells out: use `initial` rather than `none` on descendants, and keep the right-hand cluster explicitly no-drag. The change is CSS plus, at most, a class on the header container; no loop or service is involved, so it is a Web-client change with a visual check rather than a snapshot change.

**Open questions.** Which Electron version this app bundles — t3code's note is version-specific ("Electron 44 inherits app-region") — and whether the same reset behaves identically here; whether anything layered over the top bar (banners, dialogs, the update pill) needs its own `no-drag`; and whether the traffic-light gutter should keep its fixed width or move to the `titlebar-area-*` environment values the way t3code does.

## BUG-0011 — A right-click on a selection offers only Copy

- Status: open — logged on request, no fix attempted
- Reported: 2026-10-09, with a screenshot of t3code's menu: "right click while have text selected in t3 code open a menu with copy select all and a bunch of others. in Aeven there is only copy?"
- Area: the desktop shell's right-click menu — `apps/desktop/src/context-menu.ts`; the reference the reporter points at is `resources/t3code/apps/desktop/src/window/DesktopWindow.ts`
- Surface: the desktop app on macOS

**Observed.** With text selected in a page that is not an editable field, Aeven's right-click menu offers Copy and nothing else. t3code's menu in the same situation offers Cut, Copy, Paste, Select All, then macOS's own Summarize, Show Writing Tools and Services rows, as the screenshot shows.

**Steps.** Select a passage in a conversation, right-click it in the desktop app, and compare the menu with the same gesture in t3code.

**Expected.** The full edit menu on any selection — cut, copy, paste and select all with their availability — plus the platform's own rows and whatever the app adds for links, images and spelling. A selection in read-only prose is still a selection a person may cut, paste over or extend, and the menu should say so.

**Suspects and the difference.** Read these first; none is confirmed.
- **Aeven branches on editability and drops the rest.** `apps/desktop/src/context-menu.ts:38-43` adds undo/redo and cut/copy/paste/selectAll only when `params.isEditable`; `:44-46` — `else if (params.selectionText.trim() !== '')` — pushes `[{ role: 'copy' }]` and nothing else. That single branch is the reported menu: a selection in read-only prose is not editable, so it reaches the Copy-only arm.
- **t3code pushes the same four roles unconditionally**, gated only by availability: `resources/t3code/apps/desktop/src/window/DesktopWindow.ts:576-581` (`cut`, `copy`, `paste`, `selectAll`, each `enabled: params.editFlags.can…`) after its spelling, link and image groups — so a plain text selection still gets the whole edit menu.
- **t3code focuses the target first.** `:541-544` calls `contents.focus()` before building the template, with the comment that "native editing roles act on the focused contents, which may still be the host renderer when the user right-clicks inside a browser guest". Aeven never focuses the contents (`context-menu.ts:52-58`).
- **The platform rows follow from the roles.** Writing Tools and Services are macOS's additions to a native edit menu, so their absence in Aeven is a consequence of the roles being absent, not of missing app code.
- **Smaller differences in the same two functions.** t3code caps spelling suggestions at five and adds a disabled "No suggestions" row when there are none (`:548-562`), and pops through its own native bridge (`electronMenu.popupTemplate`, `:583`); Aeven lists every suggestion and omits the empty case (`context-menu.ts:27-32`).

**Suggested fix.** Make the edit group unconditional the way the reference does: keep cut/copy/paste/selectAll at all times, enabled from `params.editFlags`, and leave the editable-only groups — undo/redo, spelling — as they are. Add `contents.focus()` before building the template so the roles act on the page under the pointer instead of whatever held focus. Link copy, image copy and the misspelling suggestions stay as they are; the change is one function, and `contextMenuTemplate` is exported, so a spec pinning its current shape is the place to start.

**Open questions.** Whether Aeven wants t3code's app-specific rows (its thread actions and external-link menu) or only what the platform provides; whether to cap the dictionary suggestions; and whether the guest/webview pages the shell hosts need the same treatment, which is what t3code's focus comment is about.

## BUG-0012 — `skills/list` fails in the desktop window

- Status: open
- Reported: 2026-10-09, as "there is also an error in the list call", naming `avn-app://app/api/skills/list`
- Area: the Session-addressed skill catalog — `packages/api/session-controller/src/skill-catalog.ts` on the Host, and its one browser caller, the `/` source in `packages/client/ui-skill/src/client/index.ts`
- Surface: the development desktop app (`Aeven Dev.app`), signed in, after the desktop stream transport began presenting the reader's bearer

**Observed.** The reporter saw the `skills/list` call fail in the desktop window. The failing response itself was not captured.

**What was checked.** In the same window, a well-formed call (`POST /api/skills/list`, `{ args: { request: { sessionId } } }`, through the page's authenticated transport) answers `ok` with 17 or 28 skills for every Session the reader owns. It answers `session/not-found` for three Session ids the window still remembers in `localStorage` (`avn.conversation.<id>`, `avn.sessions.current`): `session-e5a3d33e…` is a log from 2026-09-30 under `~/.aeven/sessions/_no-cwd/` whose header records no `owner`, so per-account isolation hides it from every signed-in caller (`IdentityUsers.mayAccess` refuses state without an owner); `session-555b2e37…` and `session-9968b200…` no longer exist on disk. A `GET` to the route answers 404, because unary RPC routes accept only `POST`. Across a full reload and a minute of watching the network, the app made no failing `skills/list` call of its own.

**Expected.** The `/` menu lists the skills of the open Session, and a window that still remembers a Session the reader can no longer reach drops that id rather than issuing catalog, history and job calls for it.

**Suspects.** Read these first; none is confirmed.
- **A remembered Session the reader cannot reach.** `fetchCatalog` (`packages/client/ui-skill/src/client/index.ts:96-119`) runs on scope birth through `warm()` for any Session the window opens, and the window restores Sessions from `localStorage`. An ownerless legacy Session or a deleted one answers `session/not-found`, which `fetchCatalog` turns into `skills/list failed: session/not-found: …`.
- **The pre-fix window.** Before the desktop stream transport presented the bearer, every Session read on the desktop ran as nobody and answered `session/not-found`; a `skills/list` failure seen in that window would be the same cause, already fixed.
- **Legacy ownerless Sessions.** 281 logs under `~/.aeven/sessions` record no `owner`. They are unreachable for every signed-in caller and nothing offers to adopt them.

**Open questions.** Which Session was open when the call failed, and what did the response carry — a `session/not-found`, a `gateway/internal`, or a transport failure? Did it happen before or after the desktop restart that carried the stream-transport fix?

**Suggested fix.** Capture the failing response first: the code and message in the `server-response` envelope name the branch. If it is `session/not-found` for a remembered id, the client should forget Session ids the Host refuses (the current-session pointer and the per-session view keys) instead of re-issuing reads for them. The ownerless legacy logs need a decision of their own: adopt them for the single local account, or leave them unreachable on purpose.

## BUG-0013 — The running spinner sits low and short of the row's trailing edge

- Status: open — logged on request, no fix attempted
- Reported: 2026-10-09, with a screenshot of a running turn: "the spinner is a bit low and not exactly at the right side. see attachment"
- Area: the running-turn chrome in Chat — the "Ævening for {duration}" row and the spinner beside it
- Surface: the desktop window, a turn 57 s into its run

**Observed.** The row reads "Ævening for 57s", and the spinner sits below it and toward the left rather than on the row's own line at its trailing edge — the attachment shows the mark low and under the label instead of beside it.

**Steps.** Send a prompt and watch the running row as the elapsed counter grows; compare the mark's position with the same row once the turn settles.

**Expected.** One line per running turn: the label and the spinner on the same baseline, the mark vertically centred in the row and placed where the design puts it, so the running state reads as a row rather than a label with a mark under it.

**Suspects.** Read these first; none is confirmed.
- `packages/client/ui-chat/src/client/chat/TurnProcessNodeView.tsx:41-44` builds the elapsed clock from the turn's `start` — first check whether the spinner is a sibling in the same flex row as the label or a descendant that can wrap onto its own line.
- `packages/client/ui-chat/src/client/chat/MessageItem.tsx:169-173` holds the pending-send elapsed state; the running chrome around it may position the mark by its own margin instead of inheriting the row's alignment.
- The shared `Spinner` primitive (`packages/client/ui-primitives`) and the row's CSS module: a baseline or line-height mismatch is the usual reason a mark sits low in a flex row, and the row's `align-items` decides whether it centres at all.
- The copy for the row is `message.turnProcess.deepDivingFor` (`packages/client/ui-chat/src/client/locale.ts:222`), so the label and the mark are two elements in one node — the placement is CSS, not copy.

**Suggested fix.** Settle which element is off first: measure the row's box against the mark's on the running turn (`getBoundingClientRect` on both, plus the row's computed `align-items` and the mark's margins). If the mark is a flex sibling, `align-items: center` on the row and no vertical margin on the mark is the whole change; if it is a descendant that wraps, the row needs to stop wrapping (or the mark needs to sit in a trailing slot). Either way it is a CSS-only fix in the chat row, with the running state checked at both sidebar widths.

**Open questions.** Is the mark the row's spinner or the composer's pending indicator showing through? Does it sit low in the light theme too, and at a wide sidebar? A measurement of both boxes on the live page answers alignment versus placement in one pass.
