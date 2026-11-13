# Speech to Text

English | [中文](speech.zh.md)

Service declarations: [source](../../packages/speech/speech-to-text/src/index.ts).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxrecordings--recordings"></a>

### `ctx.recordings` — `Recordings`

Saved recordings for every account this Host serves.

```ts cordis-catalog
/**
 * List an account's recordings, newest first.
 * @param owner - the account, or {@link LOCAL_OWNER}.
 * @returns their summaries.
 */
async list(owner: string): Promise<RecordingSummary[]>

/**
 * Read one recording.
 * @param owner - the account.
 * @param id - the recording.
 * @returns the recording, or undefined when the account has none by that id.
 */
async get(owner: string, id: RecordingId): Promise<SavedRecording | undefined>

/**
 * Save or replace a recording; it must carry at least one transcribed phrase.
 * @param owner - the account.
 * @param recording - the recording; its `changedAt` is set here.
 * @returns the stored recording.
 */
async save(owner: string, recording: Omit<SavedRecording, 'changedAt'>): Promise<SavedRecording>

/**
 * Rename a recording.
 * @param owner - the account.
 * @param id - the recording.
 * @param title - the new title.
 * @returns the renamed recording.
 */
async rename(owner: string, id: RecordingId, title: string): Promise<SavedRecording>

/**
 * Delete a recording and its audio on every device of the account.
 * @param owner - the account.
 * @param id - the recording.
 */
async remove(owner: string, id: RecordingId): Promise<void>

/**
 * Append one chunk of a recording's audio; chunk 0 starts the file over.
 * @param owner - the account.
 * @param id - the recording.
 * @param index - the chunk's position, from 0.
 * @param bytes - the chunk.
 */
async appendAudio(owner: string, id: RecordingId, index: number, bytes: Uint8Array): Promise<void>

/**
 * Publish the uploaded audio file under the recording's name.
 * @param owner - the account.
 * @param id - the recording.
 * @returns the file's size.
 */
async finishAudio(owner: string, id: RecordingId): Promise<number>

/**
 * Read part of a recording's audio.
 * @param owner - the account.
 * @param id - the recording.
 * @param offset - first byte.
 * @param length - most bytes to read.
 * @returns the bytes, empty past the end; undefined when this device does not hold the file.
 */
async readAudio(owner: string, id: RecordingId, offset: number, length: number): Promise<Uint8Array | undefined>
```

Source: [`packages/speech/recordings/src/index.ts`](../../packages/speech/recordings/src/index.ts)

<a id="ctxspeakerdiarization--speakerdiarization"></a>

### `ctx.speakerDiarization` — `SpeakerDiarization`

The diarization capability: model preparation, readiness, and segmentation.

```ts cordis-catalog
/**
 * Read the diarizer's state without waiting.
 * @returns the current state.
 */
snapshot(): DiarizationState

/**
 * Follow the state until `signal` aborts.
 * @param signal - observation lifetime.
 * @returns the current state, then every change.
 */
async *follow(signal: AbortSignal): AsyncIterable<DiarizationState>

/** Download and verify the models unless they are present; joins a running preparation. */
prepare(): void

/**
 * Split one recording by voice.
 * @param samples - 16 kHz mono samples in [-1, 1]; transferred to the worker.
 * @param signal - caller cancellation.
 * @returns stretches tiling the recording, in order.
 */
async segment(samples: Float32Array, signal: AbortSignal): Promise<SpeakerSegment[]>
```

Source: [`packages/speech/speaker-diarization/src/index.ts`](../../packages/speech/speaker-diarization/src/index.ts)

<a id="ctxspeechcontroller--speechcontroller"></a>

### `ctx.speechController` — `SpeechController`

Speech calls never activate or submit to an Agent.

```ts cordis-catalog
/**
 * Read provider choices without preparing a recognizer.
 * @returns available providers, resolved default, and recording limits.
 */
@Remote catalog(): SpeechCatalog

/**
 * Follow provider readiness independently of Session and preparation lifetimes.
 * @param signal - Client observation lifetime.
 * @returns initial and subsequent complete readiness snapshots.
 */
@Remote({ mode: 'stream' }) async *follow(signal: AbortSignal): AsyncIterable<SpeechCatalog>

/**
 * Persist the user's recognition preferences.
 * @param patch - changed preference fields.
 * @returns after preferences are saved.
 */
@Remote configure(patch: SpeechSelectionPatch): Promise<void>

/**
 * Start or join one Host-owned preparation task.
 * @param providerId - selected recognizer.
 * @param options - task-local source selection validated by the provider.
 */
@Remote prepare(providerId: SpeechProviderId, options?: SpeechPreparationOptions): void

/**
 * Explicitly cancel resource preparation.
 * @param providerId - selected recognizer.
 * @returns after the preparation task settles.
 */
@Remote cancelPreparation(providerId: SpeechProviderId): Promise<void>

/**
 * Validate and transcribe one recording through the explicit provider selection.
 * @param request - canonical WAV encoded as base64, provider id and language hint.
 * @param signal - Client cancellation or Remote contribution disposal.
 * @returns final transcript without adding a Session event.
 */
@Remote async transcribe(request: TranscriptionRequest, signal: AbortSignal): Promise<Transcript>

/**
 * Read the speaker diarizer's state; `unavailable` when this Host composes no diarizer.
 * @returns the current state.
 */
@Remote diarizationState(): DiarizationState

/**
 * Follow the speaker diarizer's state, such as model download progress.
 * @param signal - Client observation lifetime.
 * @returns the current state, then every change.
 */
@Remote({ mode: 'stream' }) async *followDiarization(signal: AbortSignal): AsyncIterable<DiarizationState>

/** Start or join the download of the speaker diarizer's models. */
@Remote prepareDiarization(): void

/**
 * Split one recording by voice.
 * @param request - canonical WAV encoded as base64.
 * @param signal - Client cancellation.
 * @returns stretches tiling the recording, each with a voice embedding when long enough.
 */
@Remote async diarize(request: DiarizationRequest, signal: AbortSignal): Promise<SpeakerSegment[]>

/**
 * List the calling account's saved recordings, newest first.
 * @returns their summaries; empty when this Host keeps no recordings.
 */
@Remote async recordingsList(): Promise<RecordingSummary[]>

/**
 * Read one saved recording.
 * @param request - the recording.
 * @returns the recording.
 */
@Remote async recordingGet(request: RecordingRef): Promise<SavedRecording>

/**
 * Save a finished recording that holds transcribed speech.
 * @param request - the recording, with the audio uploaded before it when kept.
 * @returns the stored recording.
 */
@Remote async recordingSave(request: RecordingSave): Promise<SavedRecording>

/**
 * Upload one chunk of a recording's audio; chunk 0 starts the file over.
 * @param request - the recording, the chunk's position, and its bytes as base64.
 */
@Remote async recordingAudioAppend(request: RecordingAudioAppend): Promise<void>

/**
 * Finish a recording's audio upload.
 * @param request - the recording.
 * @returns the audio file's size in bytes.
 */
@Remote async recordingAudioFinish(request: RecordingRef): Promise<number>

/**
 * Read part of a recording's audio from this device.
 * @param request - the recording, the first byte, and the most bytes wanted.
 * @returns the bytes as base64 and whether the file ends there; `here: false` when this device does not hold it.
 */
@Remote async recordingAudioRead(request: RecordingAudioRead): Promise<RecordingAudioChunk>

/**
 * Rename a saved recording.
 * @param request - the recording and its new title.
 * @returns the renamed recording.
 */
@Remote async recordingRename(request: RecordingRename): Promise<SavedRecording>

/**
 * Delete a saved recording and its audio on every device of the account.
 * @param request - the recording.
 */
@Remote async recordingDelete(request: RecordingRef): Promise<void>
```

Source: [`packages/speech/api-speech-to-text/src/index.ts`](../../packages/speech/api-speech-to-text/src/index.ts)

<a id="ctxspeechtotext--speechtotext"></a>

### `ctx.speechToText` — `SpeechToText`

Registry shared by all transcription consumers in one Host composition.

```ts cordis-catalog
/**
 * Register one recognizer; duplicate ids fail without replacing the original.
 * @param provider - recognizer owned by the contributing fiber.
 * @returns idempotent disposer which rejects admission, cancels, and joins accepted work.
 */
register(provider: SpeechProvider): () => Promise<void>

/**
 * Read the current recognizer roster.
 * @returns available provider facts in registration order.
 */
listProviders(): readonly SpeechProviderInfo[]

/**
 * Observe complete readiness snapshots; a slow reader coalesces intermediate progress.
 * @param caller - observer lifetime, independent of any preparation task.
 * @returns an initial snapshot followed by the latest provider states.
 */
async *follow(caller: AbortSignal): AsyncIterable<SpeechSnapshot>

/**
 * Read provider readiness and current user preferences together.
 * @returns one detached complete observation.
 */
snapshot(): SpeechSnapshot

/**
 * Save changed selection fields as user preferences; the resulting language must be accepted by the selected provider.
 * @param patch - explicit provider, language, or on/off changes.
 * @returns after the settings write commits and observers see the new selection.
 */
async configure(patch: SpeechSelectionPatch): Promise<void>

/**
 * Start or join provider-owned preparation.
 * @param id - exact registered provider identity.
 * @param options - task-local source selection validated by the provider.
 */
prepare(id: SpeechProviderId, options?: SpeechPreparationOptions): void

/**
 * Explicitly cancel provider preparation without tying it to a browser connection.
 * @param id - exact registered provider identity.
 * @returns after the preparation task settles.
 */
async cancelPreparation(id: SpeechProviderId): Promise<void>

/**
 * Apply composition defaults and capture the selected provider.
 * Missing providers, unsupported languages, and voice input turned off fail explicitly.
 * @param request - complete recording and optional selection.
 * @returns provider-pinned input for transcribe().
 */
resolve(request: SpeechRequest): SpeechSpec

/**
 * Execute exactly the resolved provider; no fallback sends audio elsewhere.
 * @param spec - resolved input; a withdrawn or replaced registration is rejected.
 * @param signal - caller cancellation.
 * @returns final transcript after provider settlement.
 */
async transcribe(spec: SpeechSpec, signal: AbortSignal): Promise<Transcript>
```

Source: [`packages/speech/speech-to-text/src/index.ts`](../../packages/speech/speech-to-text/src/index.ts)

<a id="ctxtexttospeech--texttospeech"></a>

### `ctx.textToSpeech` — `TextToSpeech`

Registry shared by every synthesis consumer in one Host composition.

```ts cordis-catalog
/**
 * Register one synthesis provider; duplicate provider or voice ids fail without replacing the original.
 * @param provider - provider owned by the contributing fiber.
 * @returns idempotent disposer which rejects admission and joins accepted work.
 */
register(provider: TtsProvider): () => Promise<void>

/**
 * Read the current provider roster.
 * @returns provider facts in registration order.
 */
listProviders(): readonly TtsProvider['info'][]

/**
 * Read every voice a Surface may choose, plus the configured language mapping.
 * @returns detached voice roster and mapping.
 */
catalog(): TtsCatalog

/**
 * Apply the requested voice, the configured language mapping, or the catalogue for that language.
 * A voice id that no provider registered fails explicitly instead of falling back.
 * @param request - text plus a language or an exact voice.
 * @returns provider-pinned input for synthesize().
 */
resolve(request: TtsRequest): TtsSpec

/**
 * Execute exactly the resolved provider; no fallback speaks the text elsewhere.
 * @param spec - resolved input; a withdrawn or replaced registration is rejected.
 * @param signal - caller cancellation.
 * @returns encoded audio after provider settlement.
 */
async synthesize(spec: TtsSpec, signal: AbortSignal): Promise<Uint8Array>
```

Source: [`packages/speech/text-to-speech/src/index.ts`](../../packages/speech/text-to-speech/src/index.ts)

<a id="ctxttscontroller--ttscontroller"></a>

### `ctx.ttsController` — `TtsController`

Speech synthesis never activates or submits to an Agent.

```ts cordis-catalog
/**
 * Read the voices a Surface may choose and the configured language mapping.
 * @returns detached voice roster and mapping.
 */
@Remote catalog(): TtsCatalog

/**
 * Speak one utterance through the explicit voice resolution.
 * @param request - text plus a language or an exact voice.
 * @param signal - Client cancellation or Remote contribution disposal.
 * @returns encoded audio without adding a Session event.
 */
@Remote async synthesize(request: SpeechRequest, signal: AbortSignal): Promise<SpeechAudio>
```

Source: [`packages/speech/api-text-to-speech/src/index.ts`](../../packages/speech/api-text-to-speech/src/index.ts)
<!-- END GENERATED cordis-surface -->
