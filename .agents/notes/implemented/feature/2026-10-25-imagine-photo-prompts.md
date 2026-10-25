# Agent Note: Imagine's photo prompts build on the attached photo

Status: implemented

English | [中文](2026-10-25-imagine-photo-prompts.zh.md)

## Problem

Two starter prompts described an image to make instead of working from the photo the person attaches. Makeup drew a woman the prompt invented, shipped without `needsPhoto`, and framed the result as "the finished look on one face", which reads as a preview of the reader's own face; sketch drew a canned flower, so a tile sitting beside the portrait flows produced a picture the reader's attachment could not influence.

## Decision

`makeup` carries `needsPhoto: true` and offers the `story` ratio alone, so the popup states `1152x2048`: its text builds a beauty-editorial infographic from the attached portrait, keeps the person's features, skin tone and bone structure recognisable without slimming or plastic retouching, and limits itself to three short labels instead of paragraphs. `hair` keeps its photo and now reads a second attachment as the cut the person wants, falling back to a written description — a soft collarbone-length cut with long face-framing layers and a slightly darker root — when there is none. `sketch` carries `needsPhoto: true`: its text treats the attached sketch as the idea rather than the artwork, forbids tracing or keeping its lines, and restyles the subject into a loose ink-and-watercolour study. The English, Chinese and Spanish dictionaries carry the matching titles, descriptions and texts, and each description now names what the person supplies.

## Alternatives considered

**Leaving makeup and sketch photo-free** keeps two tiles that ignore the attachment the neighbouring portrait flows require, and makeup would keep presenting an invented face as the reader's finished look. **Sending makeup at the default portrait ratio** gives a full-face feature plus three detail call-outs the shorter frame the popup's own example uses; `story` is the frame the prompt text states as well. **Naming the second photo only in the description** leaves the instruction out of the message the model reads, and the description is one line of popup copy.

## Consequences

Three tiles now rely on an attachment for their flow to work, so the gallery carries fewer text-only starters. The makeup prompt states its frame twice — the popup offers only `story`, and the text names 9:16 — so changing that ratio means editing the copy with it. Prompt wording steers the output only as far as the model follows it; the dictionary keys and the tile metadata are what the gates check.

## Related

The popup, its photo intake, the `needsPhoto` sentence, and the size line are owned by [Imagine's starter-prompt popup and its photo intake](../feature/2026-10-10-imagine-starter-prompt-popup.md); this note covers what the three prompts ask for.
