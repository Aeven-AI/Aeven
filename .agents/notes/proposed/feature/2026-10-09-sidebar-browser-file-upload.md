# Agent Note: File uploads in the sidebar browser

Status: proposed

English | [中文](2026-10-09-sidebar-browser-file-upload.zh.md)

## Problem

The browser beside a session cannot answer a file chooser. `automate()` implements `snapshot`, `click`, `type`, `press`, `scroll`, navigation, and `evaluate`, and nothing that fills an `input[type=file]`; nothing in the repository intercepts a file chooser. So a click on any "Upload from computer" control opens a native macOS open dialog that no tool can complete.

What went wrong on 2026-10-09, attaching one image to a LinkedIn post:

- The model fell back to operating the desktop with computer use: copy the file into `~/Downloads` (outside the workspace, so an escalated write), click the control, screenshot the screen, convert screenshot pixels to screen points, click the file row, click Open. It needs Accessibility and Screen Recording grants, a visible desktop, and it cannot run on a GUI-less Host.
- Two dead ends first: `preview_press` Meta+V inserted nothing with the image on the clipboard, and `fetch('http://127.0.0.1:<port>/image.jpg')` from the page returned `Failed to fetch` (CSP and Chrome's private-network policy).
- Typing the caption was slow for the same reason: `type` inserts in pieces with a 45 ms pause, so 1,278 characters cost about eight seconds.
- Both failure throws said "the target is not an editable element", whatever the real cause was.

## Implemented scope

The [fast sidebar actions decision](../../implemented/feature/2026-10-09-fast-sidebar-browser-actions.md) implements atomic uploads, whole-text entry, approvals, cancellation, and local action sequences. The separate-click remembered-chooser flow below remains proposed. Validation is limited to TypeScript and builds by the user's instruction.

## Proposal

1. Add an `upload` operation (`packages/web/tool-browser/src/types.ts` — one union member — and the `automate()` switch in `apps/desktop/src/browser-automation.ts`) that resolves the `input[type=file]` — by selector, by the clicked point, or from the chooser a click just opened — and fills it with `DOM.setFileInputFiles`. Expose it as `preview_upload { selector?, x?, y?, paths: string[] }` in `packages/web/tool-browser/src/index.ts` and return file names, never paths. Unlike every other `preview_*` tool it reads the local filesystem, so it should consult `sandboxPolicy` for its paths rather than join `DEFAULT_EFFECT_TOOLS` in `packages/guard/access-policy/src/index.ts` — those entries exist precisely because they *bypass* the filesystem sandbox. Document it in `packages/web/tool-browser/README.md` (+ `.zh.md` and the i18n sidecar) and name it in the `in-app-browser` skill a new user's agent loads (`packages/preset/agent-presets/presets/aeven/skills/in-app-browser/SKILL.md`), or the agent never learns it exists. The IPC hop needs nothing: `browser-guests.ts` checks only that the operation is a string and passes it to `automate()`, so the union member and the switch case are the whole surface.
2. Intercept the chooser (`Page.setInterceptFileChooserDialog`, `Page.fileChooserOpened`) so a click on an upload control does not open a native dialog; the next `preview_upload` with no selector fills that node. Two details the current code does not have: the event only arrives after `Page.enable`, which `automate()` never calls today, so enabling it must be paired with the interception; and the `backendNodeId` the event carries can go straight to `DOM.setFileInputFiles` without a `DOM.querySelector` lookup. This is the pair Playwright's `setInputFiles` and Puppeteer's `uploadFile` use, so it is well-trodden rather than novel.
3. Insert text longer than ~200 characters, or containing a newline, with one `Input.insertText`; keep visible typing for short strings.
4. Return which failure it was: nothing matched, the element cannot take focus, or focus moved away.
5. Ask for approval before the first upload to a remote origin in a session, showing the origin and paths; exempt localhost.

## Alternatives considered

**Keep computer use as the documented fallback.** It worked once, but it needs screen-recording and accessibility grants, a visible desktop, and a file outside the workspace — a first-run experience that fails on a GUI-less Host. Rejected.

**Fill the input from a local HTTP server the page fetches.** Returned `Failed to fetch` from the page, and needs a server per upload. Rejected.

**Paste the file from the desktop clipboard.** `preview_press` Meta+V inserted nothing into a Quill editor. Rejected.

## Acceptance criteria

- `preview_upload` alone attaches a file in the pane: no computer use, no grants, no native dialog.
- Clicking an upload control does not strand the session; the next `preview_upload` fills it.
- A long caption types in one insertion and keeps its paragraph breaks.
- Coverage: the tool-name list and description in `packages/web/tool-browser/tests/tool-browser.spec.ts`, a new `apps/desktop/tests/browser-automation.spec.ts` (no spec covers `automate()` today) for node resolution, the remembered chooser node, the non-input refusal, and one-shot long text, plus a recorded-session snapshot that pins the preview tool surface — none exists yet, so per `snapshots/AGENTS.md` this change adds one.
- `pnpm run test` for both packages, `pnpm run typecheck`, `pnpm run lint`, and `pnpm run test:docs` pass.

## Risks

Intercepting the chooser affects every page, so the intercept and the operation that answers it ship together, and the first thing to prove is that the native macOS dialog really is suppressed in Electron's guest — attach the debugger to a page with an upload control, click it, and assert no dialog appears before building anything on top. `DOM.setFileInputFiles` hands a page the file's contents, which is what uploading is — hence the approval in change 5. A page with several file inputs can be filled wrongly; the proposal prefers an explicit selector and refuses ambiguity instead of guessing.
