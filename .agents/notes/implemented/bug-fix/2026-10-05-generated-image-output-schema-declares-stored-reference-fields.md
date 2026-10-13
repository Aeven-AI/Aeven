# Agent Note: The generate_image output schema declares the stored reference fields it returns

Status: implemented

English | [中文](2026-10-05-generated-image-output-schema-declares-stored-reference-fields.zh.md)

## Problem

`generate_image` declared an output value whose `images` items named only `attachmentId`, `mediaType`, `bytes`, `width` and `height`, but it returns each stored reference exactly as `ctx.attachments.saveImage()` built it — an `ImageAttachmentRef`, which also carries `originalDimensions` whenever normalization scaled the raster down, and `name` when the store was given one. The tool runtime validates a declared output schema with `additionalProperties: false`, so a generation whose provider raster exceeded the store's normalized pixel budget failed *after* the images had been produced and stored:

```
tool "generate_image" returned invalid output: "value.images[0].originalDimensions" is not a declared property (additionalProperties: false)
```

The model saw an error, the image lane at the generating call rendered its failure state instead of the delivered image, and the stored bytes stayed in the attachment store with nothing referencing them: the generation was paid for and then discarded. A 2K generation on the shipped `aeven` route triggers it — the route's ultrawide answer carries more than the 4,194,304 pixels `DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS` allows, storage scales it down, and the downscale is exactly what adds `originalDimensions`. Any generated raster above that budget fails, a condition the size tier alone decides.

## Decision

The `images` items declare `name` and `originalDimensions` — the two optional fields an `ImageAttachmentRef` carries beyond the identity and raster fields, which is also the field set `read_image`'s `IMAGE_VALUE_SCHEMA` declares for the same value. Both stay optional: `originalDimensions` appears only when storage reduced the raster, and `name` only on a reference that carries one.

Nothing else about the tool changes: the returned value keeps every fact the store reported, and the `render` projector, its summary line, the model picker and the image lane are untouched.

## Testing

`tool-media.spec.ts` runs the tool with a store double that reports `originalDimensions`, and with a provider-stored reference that names itself, asserting both results carry those fields and no error. `loader-composition.spec.ts` boots the shipped `aeven` preset through the Loader with the real attachment store and answers the doubled gateway with a PNG above the normalized pixel budget, asserting the call succeeds, the stored raster sits inside the budget, the input dimensions are reported, and the result carries an image block the lane displays. All three cases fail on the pre-fix source — the composition case at the `isError` assertion — and pass after it. The render-text expectations those two specs carried were also stale against the summary line the preset already ships, leaving the package red at `HEAD` before this change; they now assert the shipped text.

## Alternatives considered

**Narrow the result to the declared fields in `execute`.** Mapping each reference through `imageBlockRef`, which already narrows for the image block, makes the failing case pass without touching the schema. Rejected: it changes what the tool publishes — the result stops reporting the provider's own raster size — to satisfy a declaration that was simply incomplete, and it discards a fact the store reported for the value it returns.

**Extract one shared schema fragment for stored references.** Both this tool and `read_image` would then carry the field list once, which is what `pnpm run duplication` reports today as a 95-token clone between the two. Worth doing when a third consumer needs those fields; it is broader than this defect and would change a second tool's declared output in the same change.

**Widen the schema's `additionalProperties`.** Rejected: the closed schema is what makes an undeclared field a loud failure, and loosening it would hide the next mismatch of this shape as well.

**Drop the fields at the store.** Rejected: `ImageAttachmentRef` is the attachment seam's own vocabulary, shared by readers, uploads and the request path; a storage backend is the wrong place to encode one consumer's output schema.

## Consequences

The result accepts and reports the reference the store returns, so a generated image reaches the transcript whenever the provider's raster exceeded the store's normalized budget — a condition the size tier decides, not the prompt.

The two optional fields are declared in two packages for the same value, which the duplication gate reports until a shared fragment is worth extracting.

Validation still runs after the provider call and the store write, so a future mismatch of this shape still costs the generation and leaves unreferenced bytes. Rolling that back would mean validating a value's type against its schema before the side effects, which the seam cannot do for a value the store has not produced yet.

## Related

- [Generated images at their tool calls](../feature/2026-10-02-generated-images-at-tool-calls.md) owns the image lane this failure pre-empted, and the summary line the two stale expectations were updated to assert.
- [Unified normalized attachments, request versions, and provider files](../feature/2026-08-20-unified-image-request-pipeline.md) owns the normalization policy whose pixel budget produces `originalDimensions`.
