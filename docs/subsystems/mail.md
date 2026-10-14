# Mail

English | [中文](mail.zh.md)

Service declarations: [source](../../packages/mail/mail/src/index.ts).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmail--mailservice"></a>

### `ctx.mail` — `MailService`

The mail service, registered as `ctx.mail`. Messages and errors returned to callers never contain passwords; error text is fixed per failure category.

```ts cordis-catalog
/**
 * Register an account source. Throws {@link MailError} `MAIL_DUPLICATE_SOURCE` for a taken id.
 * @param source - the source; its `id` is the registry key.
 * @returns the disposer that unregisters the source; also disposed with the calling fiber.
 */
registerSource(source: MailAccountSource): () => void

/**
 * List the owner's usable accounts without network access.
 * @param owner - the conversation owner.
 * @returns one view per account.
 */
async accounts(owner: string): Promise<MailAccountView[]>

/**
 * List one account's folders; a POP3 account has `INBOX` only.
 * @param owner - the conversation owner.
 * @param account - account address.
 * @param signal - cancellation.
 * @returns folder paths with special-use attributes.
 */
async folders(owner: string, account: string, signal?: AbortSignal): Promise<MailFolderView[]>

/**
 * Search envelopes in one account, or in every account when `request.account` is omitted.
 * @param owner - the conversation owner.
 * @param request - filters and result cap.
 * @param signal - cancellation.
 * @returns newest-first envelopes, a truncation flag, and per-account failures of a multi-account search.
 */
async search(owner: string, request: MailSearchRequest, signal?: AbortSignal): Promise<MailSearchResult>

/**
 * Read one message's headers, bounded text body, and attachment list. Reading does not mark the message read.
 * @param owner - the conversation owner.
 * @param ref - the message.
 * @param signal - cancellation.
 * @returns the message.
 */
async read(owner: string, ref: MailMessageRef, signal?: AbortSignal): Promise<MailMessage>

/**
 * Read one attachment's bytes.
 * @param owner - the conversation owner.
 * @param ref - the message.
 * @param index - attachment index from {@link MailService.read}.
 * @param signal - cancellation.
 * @returns the attachment.
 */
async attachment(owner: string, ref: MailMessageRef, index: number, signal?: AbortSignal): Promise<MailAttachment>

/**
 * Change message state.
 * @param owner - the conversation owner.
 * @param request - the change.
 * @param signal - cancellation.
 * @returns the number of addressed messages.
 */
async update(owner: string, request: MailUpdateRequest, signal?: AbortSignal): Promise<number>

/**
 * Send a message over SMTP, or append it to Drafts. The sender must be the account address or an alias.
 * @param owner - the conversation owner.
 * @param request - the message.
 * @param signal - cancellation.
 * @returns the Message-ID and recipient outcome.
 */
async send(owner: string, request: MailSendRequest, signal?: AbortSignal): Promise<MailSendResult>

/**
 * Verify new account settings before they are saved: connect, authenticate, and list folders on the receive
 * server, then connect and authenticate on the send server. Throws {@link MailError} whose `step` names the failure.
 * @param settings - the account settings.
 * @param secret - the passwords.
 */
async probe(settings: MailAccountSettings, secret: MailSecret): Promise<void>
```

Source: [`packages/mail/mail/src/index.ts`](../../packages/mail/mail/src/index.ts)
<!-- END GENERATED cordis-surface -->
