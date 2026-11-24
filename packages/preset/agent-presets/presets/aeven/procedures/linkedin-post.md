---
name: linkedin-post
description: Draft, publish, or schedule a LinkedIn post in the in-app browser, with links, images, video, polls, documents, events, or celebrations.
summary: >-
  On linkedin.com/feed click role=button[name="Start a post"]; type the whole text into dialog[open] div[role="textbox"] with one preview_type. Never click Post or the schedule Confirm unless the user asked to publish this exact post. A URL followed by a space, line break, or more text gets a preview card after 1-2 s, and the card hides Media and +. To use own media instead: remove the card with dialog[open] button[aria-label="Dismiss"]:not([data-dialog-dismiss]) (the Dismiss WITH data-dialog-dismiss closes the composer), check the text survived, click Media, preview_upload the files, Next. Media added first means no card. One video per post, never with images. 3,000 characters max; past it Post is disabled. Close: composer Dismiss, then Discard or Save as draft. Read memory_get for the content types, editor tools, and every trap.
---

# LinkedIn post

Drive linkedin.com in the in-app browser with the `preview_*` tools (load the `in-app-browser` skill first). The user must already be signed in; a sign-in page is a `preview_handoff`.

## Ground rules

- Click Post, or Confirm in Schedule post, only when the user asked to publish this exact post. Drafting or "prepare a post" ends with the draft open in the composer and a summary to the user.
- Type the whole text, line breaks included, in one `preview_type` call. Enter in the post editor only adds a line; the Post button is the one control that publishes.
- Prefer structural selectors (`dialog[open]`, `div[role="textbox"]`, attribute presence). Labels such as `Media` and `Dismiss` follow the user's LinkedIn UI language; when one does not match, take a `preview_snapshot` and match the control by role and position.
- Read the composer back after every step; a click that reported `ok` has not necessarily changed it.

## Open the composer

1. On `https://www.linkedin.com/feed/`, click `role=button[name="Start a post"]`. The composer opens as `dialog[open]` and the address becomes `/sharing/compose`.
2. The editor is `dialog[open] div[role="textbox"]` (ProseMirror). Click it, then `preview_type` the text.
3. Author, visibility (`Post to Anyone`), comment setting, and `Add collaborators` sit above the editor; change them only when asked.

## Links and the preview card

- A URL gets a preview card only once something follows it: a space, a line break, or more text. Text that ends right after the URL shows no card until the next keystroke. The card appears 1–2 seconds later.
- While a card is shown, the toolbar hides `Media` and `Expand content types` (+): no image, video, or other content can be added until the card is removed.
- The card's ✕ and the composer's close button are both labelled `Dismiss`. Remove the card with `dialog[open] button[aria-label="Dismiss"]:not([data-dialog-dismiss])`; the button with `data-dialog-dismiss` closes the whole composer.
- After removing the card, read the editor text back; once it came back empty, so retype it if that happens.
- A removed card stays away while typing continues, even for a new URL, but it can return after opening a content panel (Celebration, Job) and pressing Back. Check for it again before finishing.

## Text with a link plus an image or video

1. Type the text with the link.
2. If a card appeared, remove it and check the text.
3. Add the media (next section).
4. Confirm: the text holds the URL, the media is attached, no card is shown.

Adding the media first and typing the link afterwards never produces a card. Removing all media later brings the card back on the next keystroke unless it was removed before.

## Images and video

1. Click `dialog[open] button[aria-label="Media"]`. LinkedIn opens a file chooser, sometimes only after an `Editor` panel's `Upload from computer` button. Use `preview_upload` with the absolute paths and the Media button (or `text=Upload from computer`) as the selector; never the native picker.
2. The chooser accepts several files; images keep the order given. The `Editor` panel shows `1 of N` and, per image, `Edit`, `Tag`, `Alternative text`, `Duplicate`, `Delete`, and `Add`. Add alternative text when the user supplies it.
3. A video gets `Play video`, `Captions`, and `Thumbnail`. One video per post, never with images: `Add` is disabled while a video is attached.
4. `Next` returns to the composer. Attached media shows `Edit` and `Close`; `Close` removes all of it at once. While media is attached, `Media` and `+` are hidden.

## Other content types

`Expand content types` (+) shows these; each replaces the composer panel and has `Back`:

| Option | Panel |
| --- | --- |
| Celebration | Select occasion: Project launch, Work anniversary, New position, New educational milestone, New certification |
| Event | Create an event: cover image (min 480 px wide, 16:9), Online / In person, format*, name* (75 chars), timezone*, start date* and time*, optional end, description, speakers |
| Job | Select company (pages the user manages) |
| Poll | Question* (140 chars), two or more options* (30 chars each), `Add option`, duration 1 day / 3 days / 1 week / 2 weeks |
| Document | Share a document: `Choose file`, then `Done`; viewers can download it as PDF |

The clock beside Post (`Scheduled`) opens Schedule post with date*, time*, and `Confirm`; scheduling publishes later and needs the same explicit request as Post.

## Limits

- 3,000 characters. Past it LinkedIn shows "You have exceeded the maximum character limit" with the overflow and disables Post; shorten the text with the user.
- The `n/120` counter tracks the opening shown before "…see more".
- The web composer needs no escaping; type the text as the user wrote it.

## Close or discard

The composer's `Dismiss` (`button[data-dialog-dismiss]`) asks "Save this post as a draft?" with `Discard` and `Save as draft`. Save as draft only when the user asked to keep it.
