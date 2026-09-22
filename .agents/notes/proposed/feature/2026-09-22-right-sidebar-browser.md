---
description: "Phased plan for a right-sidebar content selection and an agent-drivable browser across Web and Electron."
kind: "feature"
status: "proposed"
---

# Right-sidebar browser, selectable and agent-drivable

## Summary

Fill `sidebar.right.body` with a per-Session choice of Browser, Terminal, or Workspace files, and ship Browser first. The browser is a real browser: it renders in the Web application and the Electron shell, accepts user input, reaches loopback development servers, and is drivable by the Session's model — the agent navigates and clicks while the user watches the same page.

Phase 0 is complete: `dev:desktop` was broken on macOS and now runs, with the renderer's CDP port reachable. Everything after it is proposed.

## What four reference implementations settle

Each was read in source or in its shipped bundle, not inferred.

| Reference | Electron rendering | Agent drives the page | Running verdict |
|---|---|---|---|
| **t3code** | `<webview>` | Yes, `executeJavaScript` | **Worked out of the box — the primary model** |
| ZCode | `<webview>`, after reverting from `WebContentsView` | Yes, CDP on guest + Playwright | Iffy in practice; useful as corroboration only |
| ChatGPT/Codex desktop | `<webview>`, `webviewTag` gated per window | Yes | Shipped bundle; confirms the pattern |
| deepseek-harness | `<webview>`; `<iframe>` on Web | **No** | Presentation-only by design |

**t3code is the implementation to follow.** It is the one that has been run here and behaved, and its Electron browser is both the simplest of the four and the best documented. ZCode and ChatGPT are corroborating evidence for the shape, not sources to copy from: ZCode's own behaviour has been unreliable in practice, and its `browserView/` tree is large enough (crash recovery, residency transitions, screenshot surface coordination, video recording) that porting from it would import complexity this feature does not need yet.

### The embedding decision is already made, against the obvious choice

An earlier draft of this plan recommended `WebContentsView` in the main process, reasoning that it keeps untrusted pages out of the privileged renderer. Every production reference rejects that design, and ZCode rejected it *after trying it*. Its `desktopWindowChrome.ts:40` and `:586` carry the verdict in the source: the built-in browser changed **back** to `<webview>` rendering, and the host `BrowserWindow` had to re-enable `webviewTag`. The commit names the reason — a "CDP-on-guest pivot".

The reason it loses is structural, not incidental. `WebContentsView` is a native overlay: it does not clip, scroll, round, or z-order with CSS, so every sidebar animation, drag, and Session switch must be mirrored by repositioning a native rect, and the agent's CDP attachment has no stable DOM identity to hang from. ChatGPT confirms the same conclusion from the other direction — it uses `WebContentsView` in exactly one place, for downloads (`new l.WebContentsView({webPreferences:{session:e,sandbox:!0,nodeIntegration:!1}})`), and never to display a page.

So: **`<webview>` in Electron**, hardened per guest.

### Enabling `webviewTag` is not a security regression when done as they do it

Aeven's shell today sets `sandbox: true`, `contextIsolation: true`, and never sets `webviewTag` (`apps/desktop/src/main.ts:103-117`), denies all window opens (`:118`), restricts navigation to the `avn-app:` scheme (`:119-127`), and rejects IPC from foreign frames (`:129`). Enabling the tag naively would weaken all of that.

t3code's version is small enough to read in full and is the one to port. `apps/desktop/src/window/DesktopWindow.ts:418` enables `webviewTag: true` on the window, and `:513-525` is the entire chokepoint:

```ts
window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
  if (typeof params.partition !== "string" ||
      !previewManager.isBrowserPartition(params.partition)) {
    event.preventDefault()
    return
  }
  webPreferences.sandbox = true
  webPreferences.nodeIntegration = false
  webPreferences.nodeIntegrationInSubFrames = false
  webPreferences.contextIsolation = false
})
```

Two properties make this the right shape:

- **Attachment is allowlisted by partition**, not merely hardened. A guest whose partition is not a recognised browser partition (`persist:t3code-preview-…`) is refused outright. Any guest a compromised renderer tries to attach outside the allowlist never exists.
- **The security-critical flags are force-set in the main process**, so a renderer cannot request a weaker guest, whatever the DOM attribute says.

`apps/desktop/src/preview/WebviewPreferences.ts` is the matching per-element string and documents the reasoning for each flag, including two traps worth inheriting verbatim: the `webpreferences` attribute parser splits on `,` without trimming, so whitespace silently drops a key; and values are JS-boolean strings, so `contextIsolation="no"` is the truthy *string* `"no"` and leaves context isolation ENABLED. It also explains the one surprising choice — `contextIsolation=false` paired with `sandbox=true` — which t3code takes so a preload can share `globalThis` with the page for component inspection. **Aeven should not inherit that pairing**: without the component-picker requirement there is no reason to relax context isolation, so Aeven's guests keep `contextIsolation = true`. The file's own note explains why `sandbox=true` is what makes t3code's choice survivable, and Aeven having both is strictly safer.

ChatGPT's bundle independently corroborates the pattern: the host window enables the tag conditionally (`...k ? {webviewTag: true} : {}`), every guest is rewritten before attach with `contextIsolation = true`, `webSecurity = true`, `allowRunningInsecureContent = false`, `webviewTag = false`, `plugins = false` — so a guest can never nest another webview — and `will-attach-webview` is handled 10 times alongside 15 `will-navigate` and 9 `setWindowOpenHandler` registrations.

This is strictly stronger than an unreviewed `WebContentsView`, because the policy is applied in one main-process chokepoint that the renderer cannot bypass.

## Architecture

One selection surface, one capability seam, two providers.

```
     sidebar.right.body   per-Session selection: Browser | Terminal | Files
                │
      avn-browser  (Service Definition)      capability negotiation
        ├── Electron provider  <webview> + will-attach-webview hardening
        │                      CDP attached to the guest
        └── Web provider       Playwright Chromium on the Host,
                               CDP screencast -> <canvas>
                │
     agent control + Session events  ──>  the model
```

Backend detection is trivial and t3code shows the whole of it: `window.desktopBridge !== undefined` (`apps/web/src/env.ts:6`). Backend *capability* follows the ChatGPT plugin's model rather than a hardcoded branch: enumerate backends, negotiate per-backend capabilities, fail closed when a named backend is absent. Its `docs/api.json` tags every API member with the backends supporting it, which is the honest way to say that the Web and Electron providers are not equally capable.

### CDP on the guest is what unifies the two providers

ZCode's pivot is the key architectural insight and it transfers directly. Attaching CDP to the `<webview>` guest gives the Electron provider the *same* control surface the Web provider already has through Playwright. One agent-facing API then drives both:

- Electron: CDP on the guest `webContents`, with Playwright locator execution layered on top (`browserPlaywrightExecutor.ts`, `browserPlaywrightLocatorExecutor.ts`).
- Web: CDP on the Host's Playwright page.

Without this, the two providers would need separate command paths and would drift. ZCode names the same concept `iab` (in-app browser) that the ChatGPT plugin exposes as a backend family, which is a second, independent confirmation of the design.

## Localhost

Loopback is a primary target, not an edge case: the development servers at `127.0.0.1:3060` and `127.0.0.1:3090` are the pages most likely to be opened beside a Session.

- **Electron provider** reaches loopback directly; the guest is an ordinary Chromium with ordinary networking. This is the best available answer and another reason the Electron path is not a second-class one.
- **Web provider** runs Chromium on the Host, so `localhost` resolves in the *Host's* network namespace. That is the correct namespace for a Host-run development server, and a real difference from the viewer's own browser that the UI must state rather than let the user discover.
- Advertise `localhost` rather than a literal address so Chromium's dual-stack lookup reaches a server bound only to `::1` or `127.0.0.1`. t3code hit this and documents it in `browserTargetResolver.ts`.
- Loopback takes the same default policy as public targets; being local is not a reason to grant extra trust. t3code classifies hosts explicitly (`isLoopbackHost`, `isPrivateNetworkHost`) and Aeven should too.

An `<iframe>` is rejected for the Web path. The harness documents the cost it accepted — `X-Frame-Options` refusals, mixed-content blocking, invisible cross-origin navigation, unavailable history, concealed load failures — and decisively, a cross-origin frame cannot be read or driven, so the agent requirement cannot be met through it.

## Agent control

`AGENTS.md` fixes the mechanism: **model-visible ⟺ logged.** Anything reaching a model request must be reconstructable from the Session log, and a new model-visible input requires a Session event. Agent control is therefore not a UI concern to retrofit.

1. **Session events** carry tab lifecycle, navigation, current URL and title into the Session log. Without them the model cannot know a browser exists and a replayed Session would not reproduce the request.
2. **A read tool** returns URL, title, visible text, and a screenshot from the **live page the user is watching**. `web_fetch` cannot substitute: it refetches anonymously and receives a different page — logged-out, differently personalised, or refused.
3. **Control commands** — navigate, click, type, scroll, back/forward — run over CDP against that same page, through one command executor per provider. ZCode's `browserCommandExecutor` / `browserCommandTypes` split is the shape: a typed command union, one executor per surface.
4. **Full control once confirmed.** The agent drives without per-action prompting after the user confirms the browser is under agent control; confirmation is per Session and logged like any other model-visible state.
5. **Capability negotiation is logged**, so a Session replayed on the other backend cannot silently claim a capability it lacks.

The ChatGPT plugin's `docs/visibility.md` posture (background by default, surfaced when the user wants to watch) and its turn-scoped tab lifetime (`docs/tab-cleanup-iab.md`: agent-created tabs close at end of turn unless explicitly marked) are both worth adopting.

## Phases

### Phase 0 — make `dev:desktop` work on macOS — **DONE**

`pnpm run dev:desktop` did not start on macOS. It was run, it failed twice, both failures are fixed, and the fix is verified running. Neither failure was caused by this feature and both blocked every later phase.

**Failure 1 — a dangling workspace symlink.** The build succeeded, then:

```
ENOENT: no such file or directory, stat
'node_modules/.pnpm/node_modules/@aeven/experimental-browser-devtools'
```

`packages/experimental/browser-devtools` no longer exists and nothing in the repository references it, but a symlink survived its deletion. `pnpm install` reports "Already up to date" and does not remove it, because an install does not reconcile dangling links in `.pnpm/node_modules`. Removing the link cleared the failure. `pnpm run clean` is the documented route for "safe residue from deleted packages"; whether it covers dangling links there is worth confirming separately, since it is the gap that let this reach a developer.

**Failure 2 — macOS rejects the Electron CLI flags.** With the link gone, the launch itself failed:

```
Electron: bad option: --remote-debugging-port=9222
Electron: bad option: --user-data-dir=.../electron-user-data
exited with 9
```

`apps/desktop/scripts/dev.ts` spawned the Electron binary with `--inspect`, `--remote-debugging-port`, and `--user-data-dir` on every platform. The binary inside macOS's `Electron.app` refuses them.

deepseek-harness had already solved this, and its solution ported directly. `apps/desktop/scripts/development-app.ts` (new, ported with Aeven's own environment names) prepares a disposable bundle: `ditto` the installed `Electron.app` into the development directory, rewrite `Info.plist` with a `CFBundleIdentifier` derived from a hash of the workspace root so parallel checkouts do not collide in Launch Services, write a launcher shell script that exports the environment and execs Electron with the flags, ad-hoc codesign, and register with `lsregister`. A content stamp rebuilds the bundle only when its inputs change. `dev.ts` now branches on `process.platform === 'darwin'` and launches that executable with no command-line arguments; other platforms keep the existing direct spawn.

The flags reach Electron through the bundle's launcher instead of the command line, which is the whole trick: Launch Services starts a bundle without the environment or arguments a shell launch provides, so both are baked in as literals.

**Verified running.** `Aeven Dev.app` launches from `.desktop-build/development/`, and the full debug surface answers:

- renderer CDP on 9222 — `Aeven/0.1.2-alpha.5 Chrome/152.0.7977.78 Electron/44.3.0`, with a `webSocketDebuggerUrl`
- main-process inspector on 9229 (node v24.20.0), Host inspector on 9230 (node v22.22.0)
- the `avn-app` scheme registered as standard/secure/fetch/streaming across the network service and both renderers
- the renderer sandbox active (`--enable-sandbox`)

That live CDP endpoint is what Phase 3 attaches to, so the Electron path is now testable with the same tooling used against Chrome rather than being theoretical.

### Phase 1 — selection

Fill `sidebar.right.body` with a per-Session selection of Browser, Terminal, Workspace files as guide cards (icon, title, description), following the harness's Start-page pattern. Terminal and Workspace files present as unavailable. Selection persists per Session alongside the existing `shown` state.

Ships alone: a working chooser, no browser yet.

### Phase 2 — Electron provider

The load-bearing phase, first because it is the one with a real browser engine.

- Enable `webviewTag` on the shell window behind an explicit flag, as ChatGPT does.
- Implement the `will-attach-webview` hardening chokepoint: force `contextIsolation`, `webSecurity`, `allowRunningInsecureContent = false`, `webviewTag = false`, `plugins = false`, popup policy, and a storage `partition` on every guest.
- Extend `will-navigate` and `setWindowOpenHandler` to cover guests without loosening the host window's own rules.
- Toolbar: Back, Forward, Reload, address bar, and open-in-system-browser.
- User input works; loopback works.

### Phase 3 — agent control on Electron

Attach CDP to the guest. Typed command union and executor: navigate, click, type, scroll, back/forward, read. Session events for tab lifecycle and navigation. The read tool. Confirmation gate for agent control.

At the end of this phase the screenshot scenario works end to end in Electron: the user opens a site, the agent navigates it, and the chat reasons about what is on screen.

### Phase 4 — Web provider

`avn-browser` Service Definition formalised across both providers. Playwright Chromium on the Host, CDP screencast to a `<canvas>`, input forwarding, same toolbar, same command executor behind the same seam. Capability negotiation decides which provider answers and records the difference.

### Phase 5 — the agent cursor

`packages/experimental/browser-overlay` already exists and is complete: spring motion, click ripples, typing carets, scroll nudges. One defect blocks it — `lib/index.js` is ESM, and `Page.addScriptToEvaluateOnNewDocument` runs classic scripts, so the `export` is a syntax error and nothing installs. An IIFE build output fixes it; direct evaluation of the same bundle was confirmed working, so the bundle is sound. This is what makes agent actions legible rather than a page mysteriously moving.

### Phase 6 — Terminal and Workspace files

The other two selections, against the seam Phase 1 establishes.

## Testing

`dev:desktop` must work throughout, which Phase 0 establishes. `package.json:23` runs `apps/desktop/scripts/dev.ts`, which already exposes `AVN_DESKTOP_RENDERER_DEBUG_PORT` (9222), `AVN_DESKTOP_MAIN_INSPECT_PORT` (9229), and `AVN_DESKTOP_HOST_INSPECT_PORT` (9230); `start` is `dev --skip-build` for a faster loop. Port 9222 means the Electron renderer is drivable over CDP with the same tooling used against Chrome — the Electron test hook already exists.

Existing specs in `apps/desktop/tests/` (`host-protocol`, `single-instance`, `attached-host`) set the pattern. The guest hardening rule is mechanically checkable and must be: a test that asserts a guest cannot attach with weakened `webPreferences` is the acceptance test for Phase 2, and per `AGENTS.md` each changed acceptance path proves it rejects an invalid case.

The harness's `ui-sidebar-browser` has directly reusable test structure (`electron-lifecycle`, `electron-frame`, `browser-navigation`, `url`, `store`, `apply.host`), and ZCode's `browserView/` suite covers crash recovery and residency transitions worth mirroring.

## Out of scope

Dockkit splitting, multi-tab, tab restore across restarts, recording, device emulation. The references have all of these; none is needed for "open a page, have the agent drive it, ask about it".

## Risks

- **Enabling `webviewTag` widens the shell's attack surface.** Mitigated by the main-process `will-attach-webview` chokepoint, which the renderer cannot bypass, and by a test that asserts guests are rewritten. This is the design every reference converged on.
- **Playwright becomes a runtime dependency** of a shipped package (~300MB with Chromium). Accepted.
- **A persistent `partition` holds real cookies.** Where it lives, and whether it is per Workspace as the harness does it, is a deliberate decision.
- **Agent control is real control.** Once confirmed, the agent acts as the user on live sites. The confirmation gate and the Session log are the safeguards.
- **The two providers will diverge in capability.** Negotiation makes divergence explicit; silent substitution is the failure mode the ChatGPT plugin's own documentation warns against.
- **Web-path input latency** over screencast is worse than a native guest. The Electron provider is the answer where it matters, which is a further reason to ship it first.
