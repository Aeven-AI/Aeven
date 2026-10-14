# 文档提取

[English](document.md) | 中文

服务声明见 [源代码](../../packages/document/document-extract/src/index.ts)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdocumentextract--documentextract"></a>

### `ctx.documentExtract` — `DocumentExtract`

Registry shared by every document consumer in one Host composition.

```ts cordis-catalog
/**
 * Register one extractor; duplicate ids fail without replacing the original.
 * @param provider - extractor owned by the contributing fiber.
 * @returns idempotent disposer removing the provider.
 */
register(provider: DocumentExtractProvider): () => void

/**
 * Union of the formats every registered provider reads.
 * @returns one detached value.
 */
accepted(): DocumentFormats

/**
 * Report whether a provider reads this document's format.
 * @param name - display name.
 * @param mediaType - browser-declared media type, possibly empty.
 * @returns whether {@link extract} can be attempted.
 */
accepts(name: string, mediaType: string): boolean

/**
 * Extract text through providers in priority order until one returns text.
 * @param input - document bytes, display name, and declared media type.
 * @param signal - caller cancellation.
 * @returns text cut to the configured budget, with the producing provider.
 * @throws DocumentExtractError when no provider claims the format or every claimant fails.
 */
async extract( input: { readonly data: Uint8Array; readonly name: string; readonly mediaType: string }, signal: AbortSignal, ): Promise<DocumentExtractResult>
```

Source: [`packages/document/document-extract/src/index.ts`](../../packages/document/document-extract/src/index.ts)
<!-- END GENERATED cordis-surface -->
