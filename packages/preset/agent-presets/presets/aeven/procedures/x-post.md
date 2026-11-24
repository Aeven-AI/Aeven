---
name: x-post
description: Draft, publish, or schedule a post or thread on X (Twitter) in the in-app browser, with links, images, video, GIFs, polls, or reply settings.
summary: >-
  Open the composer from x.com/home with the left Post link (a[href="/compose/post"]); the editor is the dialog's textarea "What's happening?" (older UI: [data-testid=tweetTextarea_0]). Never click Post, Post all, or the scheduler's Schedule, and never press Cmd/Ctrl+Enter, unless the user asked to publish this exact post. 280 weighted characters per post for regular accounts (a URL counts 23): split longer text into a thread with "Add another post", one part at a time; one part over 280 or one empty part disables Post all. A pasted URL gets a card at once; media replaces it, and removing the media brings it back even after "Remove card preview", so remove the card last. Up to 20 photos/videos/GIFs mixed. Escape closes the whole composer into "Save post?" (Discard/Save). Read memory_get for threads, polls, scheduling, and every trap.
---

# X post

Drive x.com in the in-app browser with the `preview_*` tools (load the `in-app-browser` skill first). The user must already be signed in; a sign-in page is a `preview_handoff`.

## Ground rules

- Click `Post`, `Post all`, or `Schedule` in the scheduler, or press Cmd/Ctrl+Enter, only when the user asked to publish this exact post or thread. Drafting ends with the draft open in the composer and a summary to the user.
- Enter in the editor adds a line; Cmd/Ctrl+Enter publishes.
- X serves two composers. The new one is a `Create post` dialog with a plain `textarea[aria-label="What's happening?"]` and no `data-testid` attributes; the older one uses Draft.js with `[data-testid=tweetTextarea_0]`, `[data-testid=tweetButton]`, and other test ids. Match controls by `aria-label` and role so both work.
- The same `aria-label` can sit on several buttons, hidden copies included (`More` appears seven times). Act on the visible one; a click on a zero-size match lands on the modal backdrop and closes the composer.
- Read the composer back after every step; a click that reported `ok` has not necessarily changed it.

## Open the composer

1. On `https://x.com/home`, click the visible `a[href="/compose/post"]` (the left navigation's `Post`, which opens a composer and publishes nothing). Loading `/compose/post` directly does not always open the dialog.
2. In a narrow pane the older UI opens a full page instead, with `Back`, `Drafts`, and `Post` in the header.
3. Click the editor, then `preview_type` the text of one post.

## Length and threads

- Regular accounts get 280 weighted characters per post. A URL counts 23 whatever its length; emoji and CJK characters count 2.
- Near the limit a counter shows the characters left. Past it the overflow turns red, the counter shows `-N` with "You have exceeded the character limit by N", `Post` is disabled, and "Upgrade to Plus to write longer posts" appears. X never splits text itself.
- For longer text, split it at sentence or paragraph ends into parts of at most 280, then build a thread:
  1. Type part 1.
  2. Click `Add another post`; a new empty part appears after the active one and takes focus. Type the next part. Repeat.
  3. With two or more parts the publish button reads `Post all` and publishes the whole thread at once.
- Only the active part shows its controls (`Remove post`, `Add media`, `Add GIF`, `Add poll`, `Add another post`). A part becomes active only through a real click on its editor; focusing it from a script does not move the controls. Media and polls go into the active part, so click the part first.
- `Add another post` inserts after the active part, not at the end; click the last part before adding one there.
- `Who can reply` exists only on the first part. The first part has no `Remove post`.
- One part over 280 or one empty part disables `Post all` for the whole thread.
- `Remove post` deletes that part at once, without confirmation. Number parts ("1/3") only once the thread is final; X does not renumber them.

## Links and the preview card

- A pasted URL shows a card at once (`From <site>`); typed text shows it after the URL is complete. The URL stays in the text either way.
- `Remove card preview` removes the card and keeps the URL; the post then goes out without a card.
- Adding any media replaces the card automatically, so own images need no card removal first.
- Removing the media brings the card back, even one removed earlier. When the post should have neither card nor media, remove the card after the last media change and check again.
- A poll also hides the card.

## Images, video, and GIFs

1. `Add media` (older UI: `Add photos or video`) opens a file chooser; use `preview_upload` with the absolute paths and that button as the selector. The input accepts JPEG, PNG, WebP, GIF, MP4, and MOV, several at once.
2. Up to 20 items per post since November 2026, photos, videos, and GIFs mixed. Four show as a 2×2 grid, five or more as a carousel.
3. Each item has `Edit`, `Remove <file name>`, and, below the media, `Tag people` and `Add description`; videos add `Upload caption file (.srt)`.
4. `Edit` opens the media editor with `Crop`, `ALT` (description, 1,000 characters), and `Content warning`, plus `Previous`/`Next` between items; `Save` returns to the composer. The first `Add description` shows an explainer with `Sure` / `No, thanks`. After saving, the strip reads "1 image description".
5. A video shows "<file>: Ready" before X accepts it, and `Post` stays disabled while it processes. Wait until `Post` is enabled again.
6. `Add GIF` opens a GIF search (`/i/foundmedia/search`) with trending categories; picking one adds it as a media item.

## Poll

- `Add poll`: choices `Choice1`–`Choice4` (25 characters each, two shown, `Add a choice` up to four), each with its own `Add media`, and a duration of days (0–7), hours (0–23), and minutes (0–59), default 1 day. `Remove poll` takes it away.
- While a poll is open, `Add media`, `Add GIF`, and `Schedule post` are disabled, and `Post` stays disabled until the choices are filled. A poll needs a post without media.

## Reply settings, disclosures, location

- `Who can reply: Everyone` opens a menu: Everyone, Accounts you follow, Accounts you follow & who they follow, Only accounts you mention, Verified accounts.
- `More` holds `Content Disclosures` (checkboxes `Paid Partnership`, `Made with AI`) and `Add location`. The older UI shows `Content disclosure` and `Tag location` directly.
- `Add emoji` and `Generate image` (Grok) sit in the toolbar too.

## Schedule

`Schedule post` opens a calendar: past days and past times are disabled, times come in 15-minute slots in the user's timezone, and `View Scheduled Posts` lists queued posts. Its `Schedule` button queues the post to publish later and needs the same explicit request as `Post`. Scheduling is disabled while a poll is open.

## Close, drafts

- `Close` (older UI: `Back`), Escape, or a click outside the dialog asks "Save post?" with `Discard` and `Save`. Save only when the user asked to keep the draft. In the older UI `Save` is `confirmationSheetConfirm` and `Discard` is `confirmationSheetCancel`.
- Close menus by clicking the editor, not with Escape: Escape closes the whole composer.
- `Drafts` with text in the editor asks "Save post?" first; it then lists `Unsent posts` and `Scheduled`.
