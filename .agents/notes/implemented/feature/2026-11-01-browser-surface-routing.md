# Agent Note: Browser surface routing

Status: implemented

English | [中文](2026-11-01-browser-surface-routing.zh.md)

## Problem

Every model-facing instruction pointed development work at the sidebar browser. The first-step browser context said a `localhost` page is verified "in the browser the user can see — this pane", the in-app browser skill said to prefer the pane over external Chrome/CDP, the `web_fetch` escalation kept the task in the pane, and `preview_navigate` advertised itself for "a local dev server URL". `preview_status` compounded it: whenever any page was open beside the session, `nextStep` told the model to drive that page, with no distinction between a site the user asked to see and an application under development. The result was the pane used as a development browser — rebuilt pages reloaded into the pane the user was reading, and Chrome DevTools, the surface that exists for development, was named only when nothing was open.

## Decision

The two visible browsers split by the task, and every instruction that routes browser work states the split:

- A request to open, visit, or read a website belongs to the sidebar browser: `preview_navigate` opens the pane and the `preview_*` tools drive it until the task ends.
- Development and debugging belong to the Chrome DevTools browser (`mcp__chrome_devtools__*`): a `localhost` or `127.0.0.1` page, and any task that changes the code behind a page. The pane serves such a page only when Chrome DevTools is unavailable, and never as a way to check the model's own work.
- `nextStep` names the split in the same sentence as the surface: `nextStepFor` reports the pane for a site visit and Chrome DevTools for development, in both the page-open and page-openable branches, and names the registered `toolPrefix` when the composition mounts one.
- The split is enforced where the navigation happens, not only stated. `preview_navigate` refuses an address served from this machine — `localhost`, its subdomains, `[::1]`, `0.0.0.0`, and any loopback IPv4 address — whenever the Host's Chrome DevTools tools are registered and the newest message from the person does not name that address, failing with `BROWSER_DEVELOPMENT_TARGET` and naming the `new_page` call to make instead. Naming the address, its host, or its port in their own request keeps it in the pane, so a person asking to see their local page is served exactly as before. A deployment with no Chrome DevTools tools keeps the pane as its only visible browser, so the refusal never fires there.
- The skill's catalog description carries the same split, so a session that never opens a page still reads the rule when the catalog lists `in-app-browser`.

## Alternatives considered

- **Keeping the pane as the only browser and improving its DevTools access.** The pane is a `webview` guest; its own DevTools open on a window the model cannot read, and a reload displaces the page the user chose to watch.
- **Routing on the page's address alone** — treat every `localhost` page as development. It is close, but a user who asks to look at their own running site would be pulled out of the pane they are watching, so the request's intent stays the primary signal and the address decides the ambiguous case.
- **Leaving `nextStep` as it was and stating the split only in the skill.** The skill is loaded on request; the first-step context and the tool descriptions are not, and they were the instructions that won.
- **Enforcing the split in prose alone.** Prompt text is advice: a model that reads it and still navigates the pane has done nothing the harness can refuse, and the page the user was watching is already displaced. The refusal costs one round trip only in the case the instructions failed to prevent.

## Consequences

The pane stops being the default for page checks, so a development task opens the visible Chrome on the Host's debugging port. A composition that mounts no Chrome DevTools server has no development browser: the instructions name the tools by prefix so `tool_search` can find them, and a model that cannot register them reports that rather than silently developing in the pane's browser. A refused navigation costs one tool result in the transcript, and only when the person's request did not name the page, so nothing a person asks for is withheld from the pane. The first-step context grows by one sentence per turn while a page is open.
