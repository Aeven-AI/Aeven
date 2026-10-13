# Agent Note: Imagine's starter-prompt popup and its photo intake

Status: implemented

English | [中文](2026-10-10-imagine-starter-prompt-popup.zh.md)

## Problem

Imagine's start page shipped a grid of thirteen starter prompts whose cards wrote their text straight into the composer. A card carried no example image, so nothing showed what a prompt would produce; nothing let a reader choose a frame or supply the photo a retouch needs; and no surface explained a preset at all. The package README still described a removed `/i/<id>` page with its own composer and claimed Imagine generation was unavailable.

Two constraints shaped the fix. The Aeven image providers refuse an aspect-ratio field (`requestBody` in `media-aeven` accepts `size` as `WIDTHxHEIGHT` and nothing else), and a generated image is steered only by what reaches the model — so a reader's frame choice and their supplied photo both have to travel inside the message the agent later reads. And the composer's image intake was reachable only through the composer bar's own inject face, which a session-scope slot component cannot use.

## Decision

The starter prompts are catalogue data. `prompts.ts` carries each prompt's id, its shipped example (`image`, and `before` for a retouch pair), whether it edits a photo the reader supplies, its default ratio, and the ratios it offers; the title, the one-line description, the prompt text, and the popup's own copy live in the `imagine` locale dictionaries. Instagram original leads the list; Instagram improve and Aerial view follow it as the two editing cards, and those three are the prompts whose example assets ship today.

Aerial view is a second editing card whose point is prompt brevity: one ask — re-shoot the exact same place and subject as a real drone photograph from high above — and two guards, not an illustration or a map and not a miniature or tilt-shift effect, with no craft paragraph at all. Its wording names the floor or the ground rather than the ground alone, so an indoor photo transforms as well as an outdoor one, and the card's demo pair is what verifies a prompt this short still delivers.

A second prompt, Instagram original, sends no fixed text: it draws one of sixteen scenes and one of six grades from `scenes.ts` when the popup opens and composes them into the fixed craft the dictionary holds, with `Another idea` walking the pool a step at a time so consecutive picks never repeat a scene. The randomness is decided in the client rather than requested from the model, because the reader has to see and edit the message before sending it — so the preview is exactly the prompt. The catalogue types split accordingly: a fixed prompt sends the dictionary text its id names, and the varied one carries pools instead.

Clicking a card opens that prompt's popup — the shared `Modal`, headless, two columns: the example, or the before and after pair, beside the title, the description with a `See more` toggle, the ratio choice with the pixel size it states, a photo picker, the exact message with a copy control, and `Try it`. `Try it` writes the message into the composer and stages the chosen photos as that draft's images, then closes; it never sends. A prompt that edits a supplied photo keeps the button live with nothing staged: its message carries one sentence asking for the photo, so the reader either picks one in the popup or attaches it in the composer.

The frame reaches the model as a `WIDTHxHEIGHT` size line appended to the message, and `Auto` appends none. The sizes are 2K-class — 2048x2048, 1638x2048, 1152x2048, 2730x1536 — scaled up from Instagram's own export sizes. The prompt preview in the popup is composed by the same function, so what the reader reads is what the model receives.

Photos reach the draft through a new member on both input faces, `SessionInput` and `InputActions`:

```ts
addImageFiles(files: readonly File[]): string | null
```

`SessionInputShell` implements it over a new `SessionInputDeps.draftImages` dependency — `create`, `release`, and `busyNotice` — which the hub wires to the conversation service's existing `createDraftImages`, mapping `UnsupportedImageMediaTypeError` to the localized media-type refusal and a locked draft to the busy notice. Images a locked draft refuses are released immediately, so their preview URLs die with them. The hub's draft-image release is now one private helper shared by the command path, the disposer, and this intake. The member is required rather than optional because `InputActions` exists only while a session does: there is no absent case in production, and every test fake now supplies it.

A card whose asset is absent or fails to load renders title-only rather than a broken frame.

**Let the model vary the image instead of the prompt** — asking for "something original" and letting the model choose the subject would need no pools and no copy. It gives the reader nothing to read, edit, or reroll before spending a generation, and the practice guidance is that vague evaluative wording is what makes output generic.

## Alternatives considered

**Reach the conversation service from the Imagine plugin** — the popup could mint draft descriptors through `ctx.get('conversation')` and hand the ids to `inputActions.addImages`. It splits descriptor ownership: release-on-refusal and preview-URL lifetime would leave the draft's owner and be reimplemented in a presentational package.

**Make `addImageFiles` optional on the face** — the composer bar's own inject face uses `| undefined` for its capabilities, but those are genuinely absent without a session. `InputActions` is session-scoped by construction, so optionality would model nothing real and force a null branch into the popup.

**Disable `Try it` until a photo is staged, or seed the composer with a hidden option for the frame** — a disabled button needs a hint to be understood, and a hidden option never reaches the model, so it could not change the generation. The message-carried size line and photo clause keep one live button with two natural routes.

**Copy the reference product's dark popup skin** — Aeven's own modal tokens and radius keep the popup on the product's surface; only the layout was taken from the reference.

**A hover-reveal before/after comparison** — the pair is the prompt's whole promise, and a hover gesture cannot be read on touch. The two images sit side by side with their own labels.

## Consequences

The price is thirteen prompt descriptions in two languages, two example assets of about 250 KB each, and a required face member that touched thirteen spec fakes across seven client packages in one mechanical sweep. Only the retouch card ships an example image, so the other twelve render title-only until their assets land.

What it bought is a start page that shows what each prompt makes, explains it, and captures the two things the model needs — the frame and the photo — before the message is sent, without adding a generation path: the images still come from `generate_image` on an ordinary first message. The size line is honored exactly as far as the model follows the reader's text, which is the only channel the product has; nothing pins a size on the call itself.

The create prompt's pick is not reproducible, and the guide image on its card is not its output: the card shows the family, not the frame. Its pools are copy, so their quality is a writing task in two languages — sixteen scenes and six grades — and a scene that reads well in English is not guaranteed to read as well in Chinese.

Component coverage lives in `packages/client/ui-imagine/tests/prompt-dialog.client.spec.tsx` (the popup's composition, the ratio rewrite, staging, the refusal path, and the grid's card-to-popup and missing-asset behavior) and the intake in `packages/client/ui-conversation/tests/input-image-intake.client.spec.ts`. The visible assembled output is covered by the replayed web lane.
