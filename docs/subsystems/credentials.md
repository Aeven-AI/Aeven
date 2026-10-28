# User Credentials

English | [中文](credentials.zh.md)

The credential seam of [avn-credentials](../../packages/credentials/credentials) keeps secrets out of configuration: settings sections and `cordis.yml` entries carry *references* (environment-variable names), providers such as [avn-credentials-local](../../packages/credentials/credentials-local) own the values, and consumers resolve a reference once per operation — the LLM adapters resolve once per model request, so a rotated credential reaches the very next request without any restart. One seam-wide rule binds every provider: an empty stored value is absent everywhere.

Source: [`packages/credentials/credentials/src/index.ts`](../../packages/credentials/credentials/src/index.ts)

## Identity

A reference names one credential as a POSIX-style environment-variable name. The brand prevents callers from mixing credential references with other strings passed between packages or processes; construction validates the shell-identifier syntax.

```ts type-equiv
/** Nominal reference to one credential: a POSIX-style environment-variable name. */
type CredentialRef = Branded<'CredentialRef'>
```

## Resolution

`resolve(ref)` returns the value with the provider-defined source layer that supplied it, or `undefined` while unconfigured. Consumers re-resolve at each operation and never cache across operations — that per-operation read is the hot-update mechanism.

```ts type-equiv
/** One resolved credential value and the source layer that supplied it. */
interface ResolvedCredential {
  /** The non-empty secret value. */
  value: string
  /** Provider-defined source layer id (the local provider uses `env`, `session`, `file`, `project-env`, and `user-env`). */
  source: string
}
```

## Description

`describe(ref)` answers configuration surfaces without ever exposing a value: whether the reference resolves, from which layer, and whether `set` would currently succeed. The local provider reports a reference supplied by the live process environment as `writable: false` — a write would appear to succeed while resolution kept returning the shadowing value, so the seam rejects it and the UI can render the reference read-only up front.

```ts type-equiv
/**
 * Source and writability facts for one reference, safe for configuration UIs —
 * never the value. The view has no slot a value could ride in, which is what
 * lets the whole read half cross the Remote wire.
 */
interface CredentialInfo {
  /** Whether resolving the reference would currently return a value. */
  configured: boolean
  /** Source layer currently supplying the value; absent while unconfigured. */
  source?: string
  /** Whether the active provider can write this reference. */
  writable: boolean
}
```

## Change commits

`credentials/reference-updated (ref)` fires after a committed change to a provider-managed source — a `set`, an `unset`, or an external edit observed in storage. Ambient process-environment changes are not observable and never emit. Consumers do not need the event (they re-resolve per operation); it exists for configuration surfaces refreshing a "configured" badge.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxaccountintegrations--accountintegrations"></a>

### `ctx.accountIntegrations` — `AccountIntegrations`

Signed-in users manage their own integrations; each agent mounts only its owner's connectors.

```ts cordis-catalog
/**
 * Read the caller's integrations without exposing credentials.
 * @returns the account's own skills, personal connections, and deployment sign-in availability.
 */
@Remote async list(): Promise<AccountIntegrationsView>

/**
 * Read the vendored skill catalog this deployment ships.
 * @returns the catalog listing, or undefined when the deployment mounts no catalog.
 */
@Remote // oxlint-disable-next-line typescript/require-await -- the Remote contract answers with a promise; this read has nothing to await. async catalog(): Promise<SkillCatalogView | undefined>

/**
 * Read one catalogued skill's instructions, so Settings can show a skill before it is installed.
 * @param name - catalogued skill name.
 * @returns the instruction body the skill installs with, or undefined when the deployment mounts no catalog
 * or does not catalogue that name.
 */
@Remote // oxlint-disable-next-line typescript/require-await -- the Remote contract answers with a promise; this read has nothing to await. async catalogSkillContent(name: string): Promise<string | undefined>

/**
 * Retry the analysis runtime's install after a failure, which Settings offers from the failure dialog.
 */
@Remote async retryReverseEngineering(): Promise<void>

/**
 * Install one catalogued skill into the account's library.
 * @param name - catalogued skill name.
 * @throws Error when the deployment mounts no catalog, or the name is not catalogued.
 */
@Remote async installCatalogSkill(name: string): Promise<void>

/**
 * Install or replace one personal bundle after validating every resource path.
 * @param files - uploaded SKILL.md and resources, or one ZIP/.skill file.
 */
@Remote async importSkill(files: SkillUploadFile[]): Promise<void>

/**
 * Change account invocation availability for a skill across its installed sources.
 * @param name - skill name visible in the account library.
 * @param enabled - invocation availability.
 */
@Remote async setSkillEnabled(name: string, enabled: boolean): Promise<void>

/**
 * Remove one caller-owned skill from discovery.
 * @param name - personal skill name.
 */
@Remote async removeSkill(name: string): Promise<void>

/**
 * Verify a custom remote MCP server and store its optional bearer credential privately.
 * @param request - endpoint, name, and write-only access token.
 * @returns the new connector identity.
 */
@Remote async connect(request: ConnectorCreateRequest): Promise<ConnectorId>

/**
 * Verify an IMAP or POP3 mailbox and its optional SMTP server, then store the account with its passwords kept privately.
 * @param request - server settings and write-only passwords.
 * @returns the new connector identity, or the reason and verification step that failed.
 */
@Remote async connectEmail(request: EmailConnectionRequest): Promise<EmailConnectionResult>

/**
 * Change an email account's settings, re-verifying the servers before saving; an absent password keeps the stored one.
 * @param id - caller-owned email connector.
 * @param request - server settings and optional replacement passwords.
 * @returns the connector identity, or the reason and verification step that failed.
 */
@Remote async updateEmail(id: ConnectorId, request: EmailConnectionUpdate): Promise<EmailConnectionResult>

/**
 * Start a provider consent flow bound to the authenticated caller.
 *
 * The Aeven API starts the consent and receives the provider's redirect; the next {@link list}
 * after it completes stores the connector. For `discord` this is the bot installation: the user
 * picks the server to add the Aeven application to, and one connector row is stored for that guild.
 * @param provider - registered provider to connect.
 * @returns the provider consent URL.
 */
@Remote async authorize(provider: ConnectorProvider): Promise<ConnectorAuthorization>

/**
 * Enable or disable one personal connector; disabled calls are immediately denied.
 * @param id - caller-owned connector.
 * @param enabled - availability for subsequent conversation steps.
 */
@Remote async setConnectorEnabled(id: ConnectorId, enabled: boolean): Promise<void>

/**
 * Disconnect a personal connector and delete its stored credential.
 * @param id - caller-owned connector.
 */
@Remote async disconnect(id: ConnectorId): Promise<void>

/**
 * Start linking a WhatsApp number: launch a daemon on a fresh data directory and wait for its QR code.
 * A caller's earlier unfinished attempt is cancelled; the number is saved only after the phone scans the code.
 * @returns the attempt, or the reason it could not start.
 */
@Remote async startWhatsAppPairing(): Promise<WhatsAppPairingView>

/**
 * Read a linking attempt; a terminal state is returned once and the attempt is then forgotten.
 * @param id - attempt identity from startWhatsAppPairing.
 * @returns current QR code or outcome.
 */
@Remote // oxlint-disable-next-line typescript/require-await -- the Remote contract answers with a promise; this read has nothing to await. async whatsAppPairing(id: ConnectorId): Promise<WhatsAppPairingView>

/**
 * Abandon a linking attempt and delete its data directory.
 * @param id - attempt identity from startWhatsAppPairing.
 */
@Remote async cancelWhatsAppPairing(id: ConnectorId): Promise<void>

/**
 * Start signing in a Telegram account: launch a daemon on a fresh data directory and send the login code.
 * A caller's earlier unfinished attempt is cancelled; the account is saved only after Telegram authorizes it.
 * @param phone - international number, with or without a leading `+`.
 * @returns the attempt, or the reason it could not start.
 */
@Remote async startTelegramPairing(phone: string): Promise<TelegramPairingView>

/**
 * Start signing in a Telegram account by QR code: launch a daemon on a fresh data directory and show the
 * login code the Telegram app scans. A caller's earlier unfinished attempt is cancelled; the account is saved
 * only after Telegram authorizes it.
 * @returns the attempt, `qr` with the code to scan, or the reason it could not start.
 */
@Remote async startTelegramQrPairing(): Promise<TelegramPairingView>

/**
 * Read a sign-in attempt; a terminal state is returned once and the attempt is then forgotten.
 * @param id - attempt identity from startTelegramPairing.
 * @returns current step, or outcome.
 */
@Remote async telegramPairing(id: ConnectorId): Promise<TelegramPairingView>

/**
 * Submit the code Telegram sent to the account.
 * @param id - attempt identity from startTelegramPairing.
 * @param code - digits from the Telegram message.
 * @returns the attempt after Telegram answered.
 */
@Remote async submitTelegramCode(id: ConnectorId, code: string): Promise<TelegramPairingView>

/**
 * Submit the account's 2FA password when Telegram asked for it.
 * @param id - attempt identity from startTelegramPairing.
 * @param password - the account password; it is passed straight to the daemon and never stored.
 * @returns the attempt after Telegram answered.
 */
@Remote async submitTelegramPassword(id: ConnectorId, password: string): Promise<TelegramPairingView>

/**
 * Abandon a sign-in attempt and delete its data directory.
 * @param id - attempt identity from startTelegramPairing.
 */
@Remote async cancelTelegramPairing(id: ConnectorId): Promise<void>
```

Source: [`packages/host/account-integrations/src/index.ts`](../../packages/host/account-integrations/src/index.ts)

<a id="ctxauthorization--authorizationservice"></a>

### `ctx.authorization` — `AuthorizationService`

`ctx.authorization`: a registry of credential-obtaining flows, one attempt at a time per key.

```ts cordis-catalog
/**
 * Offer a way to obtain one credential. One flow per key: two plugins
 * claiming the same key would each write a record in their own format, and
 * whichever ran last would leave the other reading a payload it cannot parse.
 *
 * @param flow - the key it writes, its label, its methods, and its runner.
 * @returns Disposer that withdraws this flow.
 * @throws {AuthorizationError} code `DUPLICATE_FLOW` when the key is already claimed.
 */
registerFlow(flow: AuthorizationFlow): () => void

/**
 * Every registered flow, for a surface listing what can be authorized.
 * @returns one entry per flow, in registration order.
 */
list(): readonly AuthorizationEntry[]

/**
 * One registered flow.
 * @param key - the credential record to ask about.
 * @returns the entry, or undefined when no flow claims that key.
 */
describe(key: CredentialKey): AuthorizationEntry | undefined

/**
 * Withdraw the attempt running for a key, if any. Separate from the
 * request's own signal because a request/response transport answers a Cancel
 * button on a second call, with no handle on the first one's signal.
 * @param key - the credential record whose attempt should stop.
 */
cancel(key: CredentialKey): void

/**
 * Run one attempt to authorize a key, and report how it ended.
 *
 * One attempt per key at a time. A second caller is refused rather than
 * joined: the two would be prompting different humans through the same flow,
 * and the second would answer questions the first was asked.
 *
 * @param request - the key, the method, the surface, and the cancel signal.
 * @returns `authorized` once the flow's record is committed during this
 *   attempt and observed, or `cancelled` when the human declined or the
 *   caller withdrew.
 * @throws {AuthorizationError} code `NO_FLOW` when nothing claims the key,
 *   `UNKNOWN_METHOD` when the named method is not one the flow offers,
 *   `ALREADY_IN_FLIGHT` when an attempt is already running for the key, or
 *   `NOT_COMMITTED` when the flow resolved without committing a record
 *   during the attempt.
 */
async begin(request: AuthorizationRequest): Promise<AuthorizationOutcome>
```

Source: [`packages/credentials/authorization/src/index.ts`](../../packages/credentials/authorization/src/index.ts)

<a id="ctxcredentials--credentialprovider-abstract-seam"></a>

### `ctx.credentials` — `CredentialProvider` (abstract seam)

Abstract credential service over two key spaces that answer two questions.

A CredentialRef answers "what is behind this environment-variable name", layered over the process environment, the provider-managed store, and `.env` files. One seam-wide rule binds that half: an empty stored value is absent everywhere — `resolve` skips it, `describe` reports it unconfigured — so a blank never masquerades as a configured secret.

A CredentialKey answers "what credential does this plugin hold for this id". Nothing can layer here — an authorization grant has no environment to be read from — so presence of the record is the whole fact, and modifyRecord is the only write path because a correct write depends on the current value (a token refresh is read-decide-replace under one lock).

```ts cordis-catalog
/**
 * Resolve one reference to its current value. Resolution is per call:
 * consumers re-resolve at each operation and must not cache across
 * operations — that per-operation read is what makes a changed credential
 * reach the next operation without a restart.
 *
 * A session credential ({@link setSession}) belongs to one signed-in user and
 * resolves only for that user; a call that names no user never sees one.
 * @param ref - the reference to resolve.
 * @param user - the signed-in user the value is presented for, when there is one.
 * @returns the value and its source, or `undefined` while unconfigured.
 */
abstract resolve(ref: CredentialRef, user?: string): Promise<ResolvedCredential | undefined>

/**
 * Describe one reference for configuration surfaces without exposing the
 * value.
 * @param ref - the reference to describe.
 * @param user - the signed-in user asking, whose session credential counts; absent counts none.
 * @returns configured state, supplying source, and writability.
 */
abstract describe(ref: CredentialRef, user?: string): Promise<CredentialInfo>

/**
 * Durably store one value in the provider-managed writable source. Rejects
 * while a read-only source shadows the reference — the write would appear
 * to succeed while resolution keeps returning the shadowing value — and
 * rejects an empty value (use {@link unset}).
 * @param ref - the reference to store.
 * @param value - the non-empty secret value.
 */
abstract set(ref: CredentialRef, value: string): Promise<void>

/**
 * Remove one reference from the provider-managed writable source; removing
 * an absent reference is a no-op. Rejects while a read-only source shadows
 * the reference, like {@link set}.
 * @param ref - the reference to remove.
 */
abstract unset(ref: CredentialRef): Promise<void>

/**
 * Publish a credential that belongs to one signed-in user's live session
 * rather than to this machine, for as long as the process runs.
 *
 * Keyed by user: one Host serves several signed-in clients at once, and a
 * value published for one user never resolves for another or for a call
 * that names no user.
 *
 * Optional, because it is a capability only a provider with an in-memory
 * layer can offer; a provider that implements it makes the value resolve
 * above its durable sources so a stored entry cannot shadow a live session.
 * A caller that needs it must handle absence, which is what makes the
 * capability additive rather than a widening of every provider's contract.
 * @param ref - the reference the value answers.
 * @param user - the signed-in user whose session the value belongs to.
 * @param value - the credential, or `undefined` to withdraw it.
 */
setSession?(ref: CredentialRef, user: string, value: string | undefined): void

/**
 * Read one stored record. The value is returned as its owner wrote it; a
 * {@link GrantRecord} payload is not interpreted on the way out.
 * @param key - the record to read.
 * @returns the record, or `undefined` while none is stored.
 */
abstract readRecord(key: CredentialKey): Promise<CredentialRecord | undefined>

/**
 * Describe one record for configuration surfaces without exposing its value.
 * @param key - the record to describe.
 * @returns presence, discriminant, and writability.
 */
abstract describeRecord(key: CredentialKey): Promise<CredentialRecordInfo>

/**
 * Enumerate every stored record's address and tag. Unlike the reference
 * half, which has no enumeration because configuration surfaces learn which
 * references exist from settings schemas, records have no such discovery
 * path: a surface that cannot list them cannot show what a user is
 * authorized for, nor find an orphan left by an uninstalled plugin.
 * @returns every stored record, values excluded.
 */
abstract listRecords(): Promise<readonly CredentialRecordEntry[]>

/**
 * Serialized read-modify-write over one record — the only write path.
 * `mutate` sees the record as it stands at the moment the write is
 * exclusive, and returning `undefined` leaves the entry untouched. Exclusion
 * holds across processes where the backing store supports it, which is what
 * makes a token refresh safe: two processes rotating one refresh token
 * concurrently would otherwise lose whichever wrote first.
 * @param key - the record to modify.
 * @param mutate - receives the current record and returns its replacement, or `undefined` to leave it.
 * @returns the record after the write, or the current one when `mutate` declined.
 */
abstract modifyRecord( key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>, ): Promise<CredentialRecord | undefined>

/**
 * Remove one record; removing an absent record is a no-op.
 * @param key - the record to remove.
 */
abstract deleteRecord(key: CredentialKey): Promise<void>
```

Source: [`packages/credentials/credentials/src/index.ts`](../../packages/credentials/credentials/src/index.ts)

<a id="ctxcredentialscontroller--credentialscontroller"></a>

### `ctx.credentialsController` — `CredentialsController`

Host service backing the generated `ctx.remote.credentials` namespace. It carries every wire obligation the credential seam itself does not: the batch fan-out bound, the field-by-field view projection, the reference-grammar guard, and the refusal mapping. Secret values cross in one direction only — no method here returns one.

```ts cordis-catalog
/**
 * Describe several references for one configuration surface. Batched because
 * a settings page describes every reference its rows name at once, and one
 * round trip keeps those rows from settling separately.
 * @param refs - reference names, at most {@link MAX_DESCRIBE_REFS}; a name outside the grammar
 *   rejects the whole call as `gateway/bad-request`.
 * @returns one view per requested name, keyed by that name.
 * @throws RemoteError when the request is invalid or no credential provider is mounted.
 */
@Remote async describe(refs: string[]): Promise<Record<string, CredentialInfo>>

/**
 * Store one value from a configuration surface. The value crosses the wire in
 * this direction only: no read path returns it.
 * @param ref - reference name to store under.
 * @param value - the non-empty secret value.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote async set(ref: string, value: string): Promise<void>

/**
 * Remove one reference from a configuration surface.
 * @param ref - reference name to remove.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote async unset(ref: string): Promise<void>
```

Source: [`packages/api/settings-controller/src/credentials.ts`](../../packages/api/settings-controller/src/credentials.ts)

<a id="authorization-events"></a>

### `authorization/*` events

<a id="authorizationsettled--emit"></a>

#### `authorization/settled` — emit

One authorization attempt has finished and released its key. Fires for every terminal outcome, failures included, so a surface watching a key it did not start (a second browser tab) learns the attempt is over.

```ts cordis-catalog
/**
 * One authorization attempt has finished and released its key. Fires for
 * every terminal outcome, failures included, so a surface watching a key it
 * did not start (a second browser tab) learns the attempt is over.
 * @mode emit
 * @param key - the credential record the finished attempt was authorizing.
 * @param settlement - how it ended, including the `failed` case its caller sees as a thrown error.
 */
'authorization/settled'(key: CredentialKey, settlement: AuthorizationSettlement): void
```

Source: [`packages/credentials/authorization/src/index.ts`](../../packages/credentials/authorization/src/index.ts)

<a id="credentials-events"></a>

### `credentials/*` events

<a id="credentialsrecord-updated--emit"></a>

#### `credentials/record-updated` — emit

Committed change to a stored credential record: a `modifyRecord` that wrote, a `deleteRecord` that removed, or an external edit observed in storage. Separate from `credentials/reference-updated` because the two key grammars are disjoint — a listener that received both on one event could not tell which space a subject belongs to. Listener failures are contained on the same terms as `credentials/reference-updated`.

```ts cordis-catalog
/**
 * Committed change to a stored credential record: a `modifyRecord` that
 * wrote, a `deleteRecord` that removed, or an external edit observed in
 * storage. Separate from `credentials/reference-updated` because the two key
 * grammars are disjoint — a listener that received both on one event could
 * not tell which space a subject belongs to. Listener failures are
 * contained on the same terms as `credentials/reference-updated`.
 * @param key - the record whose stored value changed.
 * @mode emit
 */
'credentials/record-updated'(key: CredentialKey): void
```

Source: [`packages/credentials/credentials/src/types.ts`](../../packages/credentials/credentials/src/types.ts)

<a id="credentialsreference-updated--emit"></a>

#### `credentials/reference-updated` — emit

Committed change to a provider-managed credential source: a `set`, an `unset`, or an external edit observed in storage. Ambient process-environment changes are not observable and never emit. Listener failures are contained and logged — a sync throw and an async rejection alike — without changing the committed operation's outcome, except `INVARIANT`-coded failures, which rethrow after every listener ran; that rethrow reaches the emitter only from synchronous listeners, so invariant checks on this event must not be async functions.

```ts cordis-catalog
/**
 * Committed change to a provider-managed credential source: a `set`, an
 * `unset`, or an external edit observed in storage. Ambient
 * process-environment changes are not observable and never emit. Listener
 * failures are contained and logged — a sync throw and an async rejection
 * alike — without changing the committed operation's outcome, except
 * `INVARIANT`-coded failures, which rethrow after every listener ran;
 * that rethrow reaches the emitter only from synchronous listeners, so
 * invariant checks on this event must not be async functions.
 * @param ref - the reference whose stored value changed.
 * @mode emit
 */
'credentials/reference-updated'(ref: CredentialRef): void
```

Source: [`packages/credentials/credentials/src/types.ts`](../../packages/credentials/credentials/src/types.ts)

<a id="credentialssession-updated--emit"></a>

#### `credentials/session-updated` — emit

A signed-in user's session credential appeared or changed, so work that acts for that user on this Host, such as account sync, can start. Withdrawing a value does not emit.

```ts cordis-catalog
/**
 * A signed-in user's session credential appeared or changed, so work that acts for that user on this Host,
 * such as account sync, can start. Withdrawing a value does not emit.
 * @param ref - the reference the value answers.
 * @param user - the signed-in user.
 * @mode emit
 */
'credentials/session-updated'(ref: CredentialRef, user: string): void
```

Source: [`packages/credentials/credentials/src/types.ts`](../../packages/credentials/credentials/src/types.ts)
<!-- END GENERATED cordis-surface -->
