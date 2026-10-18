# Agent Note: The Imagine gallery is a template wall, and its popup shows rather than tells

Status: implemented

English | [中文](2026-10-18-imagine-gallery-templates-and-preview-popup.zh.md)

## Problem

This note supersedes the popup presentation of [Imagine's starter-prompt popup and its photo intake](2026-10-10-imagine-starter-prompt-popup.md): its message preview, its copy and reroll controls, and its side-by-side pair. The catalogue rationale that note holds for the scene pools and the retouch prompts still stands.

The starter-prompt popup read like a form. Its example image sat in a 44% column above a white footer strip, so the picture never reached the card's bottom edge; its copy mixed 12px labels with 13px controls and 16px headings; and it devoted a third of the column to the exact message the composer would receive, with a copy control over it. The gallery behind it packed seven cards into a row of 130px tags, and only five of its entries shipped an example image, so most cards were grey rectangles with a title.

## Decision

The popup is a preview. The example fills the card's full height on the left — its own proportions cannot size the card, because the image is out of flow and the column beside it decides — and the right column carries the title, the description, the aspect-ratio choice as one full-width row of filled capsules, the photo picker, and `Try it`. One type scale runs through it: 14px body, 18px title, weight 500 for emphasis. The message is no longer drawn, so the reroll and copy controls that edited it went with it; `Try it` writes the draft into the composer, which is the surface that shows and edits it. Instagram improve and Aerial view pin the original they start from as a small inset over the result, captioned in white; every other card shows its single guide image. Below 1024px the columns turn into rows, and at 640px every inset drops from 24px to 16px.

The gallery shows four cards to a row at most (three below 768px, two below 480px), so each example is wide enough to read. Every still-bearing catalogue entry now ships a 4:5 example generated on Seedream 5 Flash; the catalogue grew to 28 entries across photographic restyling (’80s flashback, Caricature, Sketch, Stickers, Photo booth, Y2K digicam, Anime), retouching (Makeup guide, Hairstyle changer, Enhance photos, Nighttime flash — the last restoring an old photograph rather than sharpening a new one), and the four video starters whose text asks for a moving shot instead of a still.

Each video starter ships no example still. The card it becomes plays the clip its own prompt produced — muted, looping, no controls — and its popup plays the same clip at the stage's full height on a dark bed, so the frame never flashes white while the first frame decodes. Nothing in the catalogue generates a video: the clip is an asset, and the text the reader takes still says what to shoot — one camera move, one action, four seconds, silent.

Sketch is the one card whose picture starts as a drawing rather than a description: its tile opens a drawing sheet — canvas, inks, undo, clear — and `Done` attaches the PNG to the composer through the conversation input's `addImageFiles`, the same intake the photo picker uses.

## Alternatives considered

**Keep the message preview and the reroll beside it.** Rejected: the popup duplicated the composer, and a reader who wanted to read or change the message could do it there, at the width the conversation gives it.

**Show the retouch as a side-by-side pair.** Rejected: at the card's height two portrait halves are narrow crops of the same face, so the change is invisible. The inset shows the result whole and the original beside it as a smaller picture.

**Size the card to a fixed 700px.** Rejected: with the message gone, a short column left a third of the card empty. The stage keeps a 460px working height and grows with the column.

## Consequences

`apps/web/public/imagine-prompts/` grows to 26 stills and four clips (5.6–16 MB each), and the catalogue's copy doubles in two dictionaries. The composer, not the popup, is where a draft is read; a reader who opens a card to see the exact wording now has to take it first.
