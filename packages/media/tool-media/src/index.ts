/**
 * Model-facing `generate_image` and `generate_video` tools over the
 * generated-media seam. The tools own the model-visible surface — argument
 * names, defaulting, which models may be chosen, and how a result reaches the
 * transcript — while `ctx.media` owns which provider serves the call and
 * `ctx.attachments` owns durable storage.
 *
 * For images, the configured `choices`, plus the models the `listedProviders`
 * list at call time, are the whole set of selectable models: the picker,
 * `/image-model`, and a model named in a call are all limited to them. For
 * video, `video.choices` plays the same part for its picker and `/video-model`.
 *
 * Generated images become durable image attachments, and a finished clip a
 * durable file attachment, rather than files or URLs, because a settled tool
 * result's attachment blocks are what the conversation card renders; nothing
 * here registers a presentation.
 * @module @aeven/tool-media
 */

import { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@aeven/commands'
import type {} from '@aeven/commands'
import type {} from '@aeven/fs'
import type {} from '@aeven/settings'
import type { AskUserQuestionRequest } from '@aeven/user-questions'
import type {} from '@aeven/user-questions'
import z from '@deepseek-ai/schemastery'
import type { ImageAttachmentRef, ImageMediaType } from '@aeven/attachment'
import { defineTool } from '@aeven/tools'
import type { ToolRunContext } from '@aeven/tools'
import { imageMediaType, MediaError } from '@aeven/media'
import type {
  GeneratedImage,
  GeneratedMedia,
  MediaImageBackground,
  MediaImageReference,
  MediaImageRequest,
  MediaVideoJob,
  MediaVideoRequest,
} from '@aeven/media'
import type { FileAttachmentRef } from '@aeven/attachment'

/** Settings namespace holding the image model choice and its selectable models. */
export const MEDIA_SETTINGS_NAMESPACE = 'media'

/** Settings namespace holding the video model choice and its selectable models. */
export const VIDEO_SETTINGS_NAMESPACE = 'media-video'

/** Cordis plugin name. */
export const name = 'tool-media'
/**
 * The tool registry, the media seam, and durable storage must all exist.
 * `userQuestions` is read optionally: where no UI can answer, the configured
 * choice stands rather than the call failing. `fs` is read optionally too: only
 * a call that passes reference images needs it.
 */
export const inject = ['tools', 'media', 'attachments']

/**
 * Media types the version-one attachment path stores, and the reference image
 * formats a call may pass. A provider may return something else — an
 * unrecognized signature is labelled `application/octet-stream` — and that is
 * refused here with the type named, rather than at the storage layer as a bare
 * rejection.
 */
const STORABLE: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** One selectable image model. */
export interface ImageModelChoice {
  /** Media provider id that serves this model. */
  provider: string
  /** The provider's model id, verbatim. */
  model: string
  /** Menu label; the `provider/model` pair when omitted. */
  label?: string
  /** Optional one-line note the menu and the tool description show beside the model. */
  description?: string
}

/** The model-selection fields the image and video settings documents share. */
export interface ModelSelection {
  /**
   * Model id used when a call names none and no choice is made. Provider-specific
   * and verbatim, e.g. `Aeven-1.0-Image-Flash`. Omitted means every call must
   * name a model or answer the picker.
   */
  model?: string
  /** Media provider id used when a call names none. Omitted defers to the seam's own selection. */
  provider?: string
  /**
   * The selectable models, in menu order. When non-empty, a call naming a model
   * outside this list is refused. An empty list disables the picker and leaves
   * the model unrestricted.
   */
  choices?: ImageModelChoice[]
  /**
   * Ask which model to use until one has been chosen. The picker is skipped
   * regardless where no `userQuestions` UI can answer, or `choices` is empty.
   */
  confirmModel?: boolean
  /**
   * Whether a person has chosen a model through the picker. Written by the
   * tool when they answer, never authored by hand: it is what distinguishes a
   * deployment default from a choice, so the picker asks exactly once.
   */
  modelChosen?: boolean
  /** Largest reference image file one call may read, in bytes. */
  maxReferenceImageBytes?: number
}

/**
 * Config for the video tool, which is also the `media-video` settings
 * document. `generate_video` and `/video-model` exist only where it is set.
 */
export interface VideoConfig extends ModelSelection {
  /** Wait between two reads of a running job, in milliseconds. */
  pollIntervalMs?: number
  /** Longest one call waits for its job before failing, in milliseconds. */
  maxWaitMs?: number
}

/** Config for the image tool, which is also the `media` settings document. */
export interface ImageConfig extends ModelSelection {
  /**
   * Media providers whose own image-model listing is offered after `choices`.
   * The listing is read on every call, so a provider whose models change at
   * runtime — such as a subscription whose image model the user switches on or
   * off in Settings → Providers — is selectable exactly while it lists them.
   */
  listedProviders?: string[]
}

/** Config for the media tools: the image tool's fields, and the video tool's under `video`. */
export interface Config extends ImageConfig {
  /** The video tool's config; omitted registers no video tool. */
  video?: VideoConfig
}

/**
 * Default {@link Config.maxReferenceImageBytes}. A provider may bound the whole
 * request more tightly; the Aeven gateway accepts 8 MiB of request body.
 */
export const DEFAULT_MAX_REFERENCE_IMAGE_BYTES = 4 * 1024 * 1024

/** Default {@link VideoConfig.pollIntervalMs}: the interval the Aeven gateway's `Retry-After` names. */
export const DEFAULT_VIDEO_POLL_INTERVAL_MS = 5000

/** Default {@link VideoConfig.maxWaitMs}: the Aeven gateway's own video deadline plus its grace minute. */
export const DEFAULT_VIDEO_MAX_WAIT_MS = 31 * 60 * 1000

const selectionFields = {
  model: z.string(),
  provider: z.string(),
  choices: z.array(z.object({
    provider: z.string().required(),
    model: z.string().required(),
    label: z.string(),
    description: z.string(),
  })).default([]),
  confirmModel: z.boolean().default(true),
  modelChosen: z.boolean().default(false),
  maxReferenceImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_REFERENCE_IMAGE_BYTES),
}

export const VideoConfig: z<VideoConfig> = z.object({
  ...selectionFields,
  pollIntervalMs: z.number().step(1).min(1).default(DEFAULT_VIDEO_POLL_INTERVAL_MS),
  maxWaitMs: z.number().step(1).min(1).default(DEFAULT_VIDEO_MAX_WAIT_MS),
})

export const ImageConfig: z<ImageConfig> = z.object({
  ...selectionFields,
  listedProviders: z.array(z.string()).default([]),
})

export const Config: z<Config> = z.object({
  ...selectionFields,
  listedProviders: z.array(z.string()).default([]),
  video: VideoConfig,
})

/**
 * The menu label for one choice.
 * @param choice - the configured provider/model pair.
 * @returns its label, or the `provider/model` pair when it states none.
 */
export function choiceLabel(choice: ImageModelChoice): string {
  return choice.label ?? `${choice.provider}/${choice.model}`
}

/**
 * Match one selected menu label back to its choice.
 * @param choices - the offered choices.
 * @param selected - the label the user picked.
 * @returns the matching choice, or undefined when the answer names none.
 */
export function choiceFor(
  choices: readonly ImageModelChoice[],
  selected: string | undefined,
): ImageModelChoice | undefined {
  return choices.find(choice => choiceLabel(choice) === selected)
}

/**
 * Match one typed command argument to a choice.
 *
 * The `provider/model` form names a pair verbatim, and is the form a picker row
 * carries. A bare model id matches only while exactly one offered choice
 * carries it, so two providers serving the same id are never silently resolved
 * to the first of them.
 * @param choices - the offered choices.
 * @param input - the argument as typed after the command name.
 * @returns the matching choice, or undefined when no single choice carries it.
 */
export function choiceNamed(choices: readonly ImageModelChoice[], input: string): ImageModelChoice | undefined {
  const separator = input.indexOf('/')
  if (separator !== -1) {
    const provider = input.slice(0, separator)
    const model = input.slice(separator + 1)
    const exact = choices.find(choice => choice.provider === provider && choice.model === model)
    if (exact !== undefined) return exact
  }
  const matches = choices.filter(choice => choice.model === input)
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * The offered choices under the names that identify one of them: what a typed
 * argument must carry, and what a refusal lists.
 * @param choices - the offered choices.
 * @returns the pair for each choice, in menu order.
 */
export function choiceRefs(choices: readonly ImageModelChoice[]): string[] {
  return choices.map(choice => `${choice.provider}/${choice.model}`)
}

/** The model-supplied `generate_image` arguments. */
export interface GenerateImageArgs {
  prompt: string
  model?: string
  n?: number
  size?: string
  background?: MediaImageBackground
  resolution?: string
  seed?: number
  guidance_scale?: number
  output_format?: 'png' | 'jpeg'
  optimize_prompt_mode?: 'standard' | 'fast'
  reference_images?: string[]
}

/**
 * Resolve one call's request from its arguments and this deployment's config.
 * Defaulting is explicit here rather than inside the seam, so a missing model
 * fails by name instead of reaching a provider as an empty id. The provider is
 * the one the matching choice names, else the configured one.
 * @param args - the model-supplied arguments.
 * @param config - the deployment's defaults and selectable models.
 * @param references - the reference images already read for this call.
 * @returns the seam request.
 */
export function resolveRequest(
  args: Omit<GenerateImageArgs, 'reference_images'>,
  config: ImageConfig,
  references: readonly MediaImageReference[] = [],
): MediaImageRequest {
  const model = args.model ?? config.model
  if (model === undefined || model === '') {
    throw new MediaError(
      'no image model named: pass `model`, or set `model` on the tool-media plugin',
      'MEDIA_INVALID_REQUEST',
    )
  }
  const choices = config.choices ?? []
  const choice = choices.find(entry => entry.model === model)
  if (choice === undefined && choices.length > 0) {
    throw new MediaError(
      `"${model}" is not an available image model; use one of ${choices.map(entry => entry.model).join(', ')}`,
      'MEDIA_INVALID_REQUEST',
    )
  }
  const provider = choice?.provider ?? config.provider
  return {
    model,
    prompt: args.prompt,
    ...provider === undefined ? {} : { provider },
    ...args.n === undefined ? {} : { n: args.n },
    ...args.size === undefined ? {} : { size: args.size },
    ...args.background === undefined ? {} : { background: args.background },
    ...args.resolution === undefined ? {} : { resolution: args.resolution },
    ...args.seed === undefined ? {} : { seed: args.seed },
    ...args.guidance_scale === undefined ? {} : { guidanceScale: args.guidance_scale },
    ...args.output_format === undefined ? {} : { outputFormat: args.output_format },
    ...args.optimize_prompt_mode === undefined ? {} : { optimizePromptMode: args.optimize_prompt_mode },
    ...references.length === 0 ? {} : { references },
  }
}

/** What reading reference images needs from the running call. */
export interface ReferenceReadContext {
  /** The session workspace relative paths resolve against; undefined leaves the backend default. */
  readonly cwd: string | undefined
  /** Cancellation for the resolution and the reads. */
  readonly signal: AbortSignal | undefined
}

/**
 * Read the reference images a call names, in order.
 *
 * Paths resolve through the mounted filesystem backend, so a workspace file and
 * the normalized copy of a conversation image a model was shown are read the
 * same way. The format is identified from each file's bytes.
 * @param fs - the mounted filesystem, or undefined where none is mounted.
 * @param paths - the model-supplied paths.
 * @param context - the call's working directory and cancellation.
 * @param maxBytes - largest file accepted.
 * @returns the reference images, in the order named.
 */
export async function readReferences(
  fs: Context['fs'] | undefined,
  paths: readonly string[],
  context: ReferenceReadContext,
  maxBytes: number,
): Promise<MediaImageReference[]> {
  if (paths.length === 0) return []
  if (fs === undefined) {
    throw new MediaError('reference_images needs a filesystem, and none is mounted', 'MEDIA_INVALID_REQUEST')
  }
  const references: MediaImageReference[] = []
  for (const path of paths) {
    const target = await fs.resolve(path, {
      ...context.cwd === undefined ? {} : { cwd: context.cwd },
      ...context.signal === undefined ? {} : { signal: context.signal },
    })
    const data = await fs.readBytes(target, context.signal, maxBytes)
    const mediaType = imageMediaType(data)
    if (!STORABLE.includes(mediaType)) {
      throw new MediaError(
        `reference image "${target.displayPath}" is not a PNG, JPEG, WebP, or GIF image`,
        'MEDIA_INVALID_REQUEST',
      )
    }
    references.push({ mediaType, data })
  }
  return references
}

/**
 * Narrow generated bytes to a storable attachment input.
 * @param mediaType - the media type the provider reported for these bytes.
 * @param data - the generated bytes.
 * @returns the same bytes under a media type the attachment path accepts.
 */
export function storable(mediaType: string, data: Uint8Array): { data: Uint8Array; mediaType: ImageMediaType } {
  if (!STORABLE.includes(mediaType)) {
    throw new MediaError(
      `generated image media type "${mediaType}" cannot be stored as a conversation attachment`,
      'MEDIA_UPSTREAM',
    )
  }
  return { data, mediaType: mediaType as ImageMediaType }
}

/** File extension for each media type the attachment path stores. */
const IMAGE_EXTENSIONS: Record<ImageMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * Display name of one generated image: the model that produced it and its
 * position in the call, which is what the conversation's image preview titles
 * and what a download is called.
 * @param model - the model the provider reported for the call.
 * @param index - zero-based position of the image within the call.
 * @param mediaType - the stored media type, which picks the extension.
 * @returns a display name the attachment store accepts.
 */
export function generatedImageName(model: string, index: number, mediaType: ImageMediaType): string {
  const stem = model.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'generated'
  return `${stem}-${String(index + 1)}.${IMAGE_EXTENSIONS[mediaType]}`
}

/**
 * The durable reference for one generated image.
 *
 * A provider that already stored the image hands back its reference, which is
 * used as-is: re-reading and re-storing the same bytes would produce a second
 * copy of an image the store already holds.
 * @param image - one image the provider produced.
 * @param save - stores bytes and returns their durable reference.
 * @returns the reference the tool result carries.
 */
export async function storeImage(
  image: GeneratedImage,
  save: (input: { data: Uint8Array; mediaType: ImageMediaType }) => Promise<ImageAttachmentRef>,
): Promise<ImageAttachmentRef> {
  switch (image.kind) {
    case 'bytes': return save(storable(image.mediaType, image.data))
    case 'attachment': return image.attachment
    default: return assertNever(image)
  }
}

/**
 * Refuse an image kind this build does not know.
 * @param image - the unhandled member.
 * @returns never; always throws.
 */
function assertNever(image: never): never {
  throw new MediaError(
    `unsupported generated image kind ${JSON.stringify((image as { kind: unknown }).kind)}`,
    'MEDIA_UPSTREAM',
  )
}

/**
 * Re-narrow one stored reference read back from the output value.
 *
 * The output schema DSL cannot express the `AttachmentId` brand, so a value
 * reaching `render` carries plain strings. The bytes were stored by this same
 * tool through `saveImage`, so the brand holds; this restores it for the image
 * block without a second storage read.
 * @param ref - the reference as the output schema describes it.
 * @returns the same reference under its branded type.
 */
export function imageBlockRef(ref: {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
}): ImageAttachmentRef {
  return {
    attachmentId: ref.attachmentId as ImageAttachmentRef['attachmentId'],
    mediaType: ref.mediaType as ImageAttachmentRef['mediaType'],
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
  }
}

/**
 * The sentence a result states about what a generation cost.
 * @param costUsdMicros - the charge in millionths of a US dollar, where the provider reported one.
 * @returns the sentence, or nothing where no charge was reported.
 */
export function costText(costUsdMicros: number | undefined): string {
  if (costUsdMicros === undefined) return ''
  const usd = costUsdMicros / 1_000_000
  return ` Charged $${usd >= 0.01 || usd === 0 ? usd.toFixed(2) : usd.toFixed(4)} to the user's Aeven account.`
}

/**
 * The name a result gives the model that generated: the offered choice's
 * label, so the user reads the product name, else the model id.
 * @param choices - the offered choices.
 * @param model - the model id the call used.
 * @returns the label to state.
 */
export function modelLabel(choices: readonly ImageModelChoice[] | undefined, model: string): string {
  return choices?.find(choice => choice.model === model)?.label ?? model
}

/** What one media tool generates. */
export type MediaKind = 'image' | 'video'

/** The model-supplied `generate_video` arguments. */
export interface GenerateVideoArgs {
  prompt: string
  model?: string
  duration?: number
  resolution?: string
  aspect_ratio?: string
  seed?: number
  generate_audio?: boolean
  reference_images?: string[]
}

/**
 * Resolve one video call's request from its arguments and this deployment's
 * config, under the same model rules as {@link resolveRequest}.
 * @param args - the model-supplied arguments.
 * @param config - the deployment's video defaults and selectable models.
 * @param references - the frame images already read for this call.
 * @returns the seam request.
 */
export function resolveVideoRequest(
  args: Omit<GenerateVideoArgs, 'reference_images'>,
  config: VideoConfig,
  references: readonly MediaImageReference[] = [],
): MediaVideoRequest {
  const model = args.model ?? config.model
  if (model === undefined || model === '') {
    throw new MediaError(
      'no video model named: pass `model`, or set `video.model` on the tool-media plugin',
      'MEDIA_INVALID_REQUEST',
    )
  }
  const choices = config.choices ?? []
  const choice = choices.find(entry => entry.model === model)
  if (choice === undefined && choices.length > 0) {
    throw new MediaError(
      `"${model}" is not an available video model; use one of ${choices.map(entry => entry.model).join(', ')}`,
      'MEDIA_INVALID_REQUEST',
    )
  }
  const provider = choice?.provider ?? config.provider
  return {
    model,
    prompt: args.prompt,
    ...provider === undefined ? {} : { provider },
    ...args.duration === undefined ? {} : { duration: args.duration },
    ...args.resolution === undefined ? {} : { resolution: args.resolution },
    ...args.aspect_ratio === undefined ? {} : { aspectRatio: args.aspect_ratio },
    ...args.seed === undefined ? {} : { seed: args.seed },
    ...args.generate_audio === undefined ? {} : { generateAudio: args.generate_audio },
    ...references.length === 0 ? {} : { references },
  }
}

/** Media types the conversation plays a generated clip as. */
const VIDEO_TYPES: readonly string[] = ['video/mp4', 'video/webm']

/**
 * Display name of one generated clip: the model that produced it, which is
 * what the player's download is called.
 * @param model - the model the call used.
 * @param mediaType - the clip's media type, which picks the extension.
 * @returns a display name the attachment store accepts.
 */
export function generatedVideoName(model: string, mediaType: string): string {
  const stem = model.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'generated'
  return `${stem}.${mediaType === 'video/webm' ? 'webm' : 'mp4'}`
}

/**
 * The file attachment input for one finished clip. The stored text is what the
 * model reads in place of the bytes when the result is replayed.
 * @param clip - the finished clip.
 * @param model - the model that produced it.
 * @param prompt - the prompt it was generated from.
 * @returns the input for `ctx.attachments.saveFile`.
 */
export function videoFileInput(clip: GeneratedMedia, model: string, prompt: string): {
  data: Uint8Array
  mediaType: string
  name: string
  text: { text: string; method: 'native'; extractor: string; truncated: boolean }
} {
  if (!VIDEO_TYPES.includes(clip.mediaType)) {
    throw new MediaError(`generated video media type "${clip.mediaType}" cannot be played in the conversation`, 'MEDIA_UPSTREAM')
  }
  return {
    data: clip.data,
    mediaType: clip.mediaType,
    name: generatedVideoName(model, clip.mediaType),
    text: {
      text: `Video generated by ${model} from the prompt: ${prompt}`,
      method: 'native',
      extractor: 'tool-media',
      truncated: false,
    },
  }
}

/**
 * Re-narrow one stored file reference read back from the output value, as
 * {@link imageBlockRef} does for images.
 * @param ref - the reference as the output schema describes it.
 * @returns the same reference under its branded type.
 */
export function fileBlockRef(ref: {
  attachmentId: string
  mediaType: string
  bytes: number
  name: string
  extraction: {
    textId: string
    chars: number
    method: string
    extractor: string
    truncated: boolean
    pages?: number
  }
}): FileAttachmentRef {
  return {
    attachmentId: ref.attachmentId as FileAttachmentRef['attachmentId'],
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    name: ref.name,
    extraction: {
      textId: ref.extraction.textId as FileAttachmentRef['extraction']['textId'],
      chars: ref.extraction.chars,
      method: ref.extraction.method as FileAttachmentRef['extraction']['method'],
      extractor: ref.extraction.extractor,
      truncated: ref.extraction.truncated,
      ...ref.extraction.pages === undefined ? {} : { pages: ref.extraction.pages },
    },
  }
}

/**
 * Wait for one video job to finish, reading it every `intervalMs`.
 * @param read - reads the job's current state.
 * @param job - the started job.
 * @param intervalMs - wait between two reads.
 * @param maxWaitMs - longest total wait.
 * @param signal - cancellation for the wait and the reads.
 * @returns the succeeded job.
 */
export async function awaitVideo(
  read: (job: MediaVideoJob) => Promise<MediaVideoJob>,
  job: MediaVideoJob,
  intervalMs: number,
  maxWaitMs: number,
  signal: AbortSignal | undefined,
): Promise<MediaVideoJob> {
  const deadline = Date.now() + maxWaitMs
  let current = job
  while (current.status === 'running') {
    if (Date.now() >= deadline) {
      throw new MediaError(`video job ${job.id} did not finish within ${String(maxWaitMs)} ms`, 'MEDIA_UPSTREAM')
    }
    await delay(intervalMs, signal)
    current = await read(current)
  }
  if (current.status === 'failed') {
    throw new MediaError(`video generation failed: ${current.error ?? 'the provider reported no reason'}`, 'MEDIA_UPSTREAM')
  }
  return current
}

/** Resolve after `ms`, or reject with the signal's reason when it aborts first. */
function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Build the picker request for one generation.
 *
 * The agent is passed only when the execution carries one: `ask()` refuses an
 * agent that is not the live caller, and a tool run outside a session has none
 * to name.
 * @param choices - the offered choices, in menu order.
 * @param prompt - the prompt shown as the question's supporting detail.
 * @param exec - the running tool execution, carrying the agent and signal.
 * @param kind - what the model generates, which words the question.
 * @returns the request to hand `ctx.userQuestions.ask()`.
 */
export function askRequest(
  choices: readonly ImageModelChoice[],
  prompt: string,
  exec: Pick<ToolRunContext, 'agent' | 'signal'>,
  kind: MediaKind = 'image',
): AskUserQuestionRequest {
  return {
    questions: [{
      id: `${kind}-model`,
      header: kind === 'image' ? 'Image model' : 'Video model',
      question: `Which model should generate this ${kind}?`,
      detail: prompt,
      options: choices.map(choice => ({
        label: choiceLabel(choice),
        ...choice.description === undefined ? {} : { description: choice.description },
      })),
    }],
    ...exec.agent !== undefined ? { agent: exec.agent } : {},
    signal: exec.signal,
  }
}

/**
 * The tool description's list of selectable models.
 * @param config - the composition's config, whose choices and default it names.
 * @returns the sentence appended to the description, or nothing where no choices are configured.
 */
export function modelsText(config: ModelSelection): string {
  const choices = config.choices ?? []
  if (choices.length === 0) return ''
  const entries = choices.map(choice => [
    choice.model,
    choice.model === config.model ? ' (default)' : '',
    choice.description === undefined ? '' : ` — ${choice.description}`,
  ].join(''))
  return ` Available models: ${entries.join('; ')}.`
}

/** What one kind's model selection is installed from. */
interface SelectionSpec<C extends ModelSelection> {
  /** What the selected model generates. */
  readonly kind: MediaKind
  /** Settings namespace holding the choice. */
  readonly namespace: string
  /** The settings document's schema. */
  readonly schema: z<C>
  /** The composition's config, the document's base layer. */
  readonly base: C
  /** Choices offered after the configured ones, read per call. */
  readonly extraChoices: (settings: C, signal: AbortSignal | undefined) => Promise<ImageModelChoice[]>
}

/** One kind's installed model selection. */
interface InstalledSelection<C extends ModelSelection> {
  /** The resolved settings document now. */
  current(): C
  /**
   * The config one generation resolves its request from, after the picker
   * where it applies.
   */
  pick(args: { prompt: string; model?: string }, exec: Pick<ToolRunContext, 'agent' | 'signal'>): Promise<C>
}

/**
 * Install one kind's model selection: its settings document, the picker a
 * generation runs before spending a credit, and the `/<kind>-model` command
 * that re-opens it.
 * @param ctx - context carrying the media seam and, optionally, settings, commands, and questions.
 * @param spec - the kind, its settings document, and its extra choices.
 * @returns the selection a generation reads.
 */
function installSelection<C extends ModelSelection>(ctx: Context, spec: SelectionSpec<C>): InstalledSelection<C> {
  const { kind } = spec
  const command = `${kind}-model`
  // The composition layer is the starting document; the settings scope
  // replaces this getter with one reading the user layer, so an edit in
  // Settings takes effect on the next call without a remount.
  let current = (): C => spec.base
  // Remembering a choice needs the scope itself, not just a read source:
  // `register` returns one that both reads the merged document and persists a
  // patch into the user layer.
  let remember: (choice: Pick<ModelSelection, 'provider' | 'model'>) => Promise<void> = async () => {}
  ctx.inject(['settings'], (settingsCtx: Context) => {
    const scope = settingsCtx.settings.register(spec.namespace, spec.schema, { base: spec.base })
    current = () => scope.get()
    remember = async (choice) => {
      await scope.update({ ...choice, modelChosen: true })
    }
  })

  /**
   * The selectable models for one call: the configured choices, then every
   * extra model the configured ones do not already name.
   * @param settings - the resolved settings document.
   * @param signal - cancellation for the provider listings.
   * @returns the choices in menu order.
   */
  const offeredChoices = async (settings: C, signal: AbortSignal | undefined): Promise<ImageModelChoice[]> => {
    const configured = settings.choices ?? []
    const known = new Set(configured.map(choice => `${choice.provider}\u0000${choice.model}`))
    const extra = (await spec.extraChoices(settings, signal))
      .filter(choice => !known.has(`${choice.provider}\u0000${choice.model}`))
    return [...configured, ...extra]
  }

  /**
   * Ask which model to generate with, and answer as the config that request
   * resolution then reads.
   *
   * The picker is skipped — leaving the configured choice in force — when it is
   * switched off, when no choice is offered, or when no `userQuestions` UI is
   * mounted to answer it. A call that named its own model still asks, because
   * confirming before spending an upstream credit is the point; that model
   * leads the menu so accepting it is one click.
   * @param args - the model-supplied arguments.
   * @param exec - the caller's agent and cancellation signal.
   * @param reask - ask again even though a choice is already stored.
   * @returns the config request resolution should use for this call.
   */
  const pickModel = async (
    args: { prompt: string; model?: string },
    exec: Pick<ToolRunContext, 'agent' | 'signal'>,
    reask = false,
  ): Promise<C> => {
    const settings: C = { ...current(), choices: await offeredChoices(current(), exec.signal) }
    const choices = settings.choices ?? []
    const questions = ctx.get('userQuestions')
    // Asked once: a stored choice is what a person set, and re-asking every
    // generation would make the setting meaningless.
    if (
      (!reask && (settings.confirmModel === false || settings.modelChosen === true))
      || choices.length === 0
      || questions === undefined
    ) return settings
    const named = args.model === undefined
      ? undefined
      : choices.find(choice => choice.model === args.model)
    const ordered = named === undefined ? choices : [named, ...choices.filter(choice => choice !== named)]
    const answer = await questions.ask(askRequest(ordered, args.prompt, exec, kind))
    const picked = choiceFor(ordered, answer.answers[0]?.selected[0])
    // An answer naming no offered option leaves the configured choice in force
    // rather than inventing a model id from free text, and stores nothing, so
    // the next generation asks again.
    if (picked === undefined) return settings
    await remember({ provider: picked.provider, model: picked.model })
    return { ...settings, provider: picked.provider, model: picked.model }
  }

  /**
   * Write the model one argued `/<kind>-model` line names, which is what a
   * client picker submits once a person has chosen.
   * @param choices - the offered choices, as the picker would show them.
   * @param named - the argument as typed.
   * @returns the outcome the dispatching surface renders.
   */
  const applyNamed = async (choices: readonly ImageModelChoice[], named: string): Promise<CommandResult> => {
    if (choices.length === 0) return { kind: 'error', text: `no ${kind} model is available to choose from` }
    const matches = choices.filter(choice => choice.model === named)
    if (matches.length > 1) {
      return {
        kind: 'error',
        text: `"${named}" is served by more than one provider; name one as ${choiceRefs(matches).join(' or ')}`,
      }
    }
    const picked = choiceNamed(choices, named)
    if (picked === undefined) {
      return {
        kind: 'error',
        text: `"${named}" is not an available ${kind} model; use one of ${choiceRefs(choices).join(', ')}`,
      }
    }
    await remember({ provider: picked.provider, model: picked.model })
    return { kind: 'success', text: `${kind === 'image' ? 'Image' : 'Video'} model set to ${picked.model}.` }
  }

  // `/<kind>-model` re-opens the picker on demand. Without it a stored choice
  // would be unchangeable from the product: the tool asks once by design, and
  // this is the surface that asks again. An argued line is the same write
  // without the question, so a client picker can submit the choice a person
  // made in its own shell.
  ctx.inject(['commands'], (commandCtx: Context) => {
    commandCtx.effect(() => commandCtx.commands.register({
      name: command,
      description: `Choose which model generates ${kind === 'image' ? 'images' : 'videos'}.`,
      input: { hint: '<model>' },
      async handler(invocation: CommandInvocation): Promise<CommandResult> {
        const before = current()
        const named = invocation.rawInput.trim()
        if (named !== '') return applyNamed(await offeredChoices(before, invocation.signal), named)
        const chosen = await pickModel(
          { prompt: 'Choose the model future generations use.' },
          { agent: invocation.agent, signal: invocation.signal },
          true,
        )
        if (chosen.model === undefined) {
          return { kind: 'error', text: `no ${kind} model is available to choose from` }
        }
        const label = kind === 'image' ? 'Image' : 'Video'
        return chosen.model === before.model && before.modelChosen === true
          ? { kind: 'success', text: `${label} model unchanged: ${chosen.model}.` }
          : { kind: 'success', text: `${label} model set to ${chosen.model}.` }
      },
    }), `tool-media: /${command} command`)
  })

  return { current, pick: (args, exec) => pickModel(args, exec) }
}

/**
 * Register `generate_image`, and `generate_video` where `video` is configured,
 * on `ctx.tools`.
 * @param ctx - context carrying the tool registry, the media seam, and attachments.
 * @param config - the deployment's default models and providers.
 */
export function apply(ctx: Context, config: Config): void {
  const { video, ...imageConfig } = config
  const images = installSelection<ImageConfig>(ctx, {
    kind: 'image',
    namespace: MEDIA_SETTINGS_NAMESPACE,
    schema: ImageConfig,
    base: imageConfig,
    // The listing is read on every call, so a provider whose models change at
    // runtime is selectable exactly while it lists them.
    extraChoices: async (settings, signal) => {
      const listed = new Set(settings.listedProviders ?? [])
      if (listed.size === 0) return []
      return (await ctx.media.listImageModels(signal))
        .filter(model => listed.has(model.provider))
        .map(model => ({
          provider: model.provider,
          model: model.id,
          ...model.label === undefined ? {} : { label: model.label },
          ...model.description === undefined ? {} : { description: model.description },
        }))
    },
  })
  const pickModel = images.pick

  if (video !== undefined) registerVideoTool(ctx, video)

  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate an image from a text prompt and attach it to the conversation. Use when the user asks to create, draw, edit, or generate a picture. When the user supplies a complete image prompt, pass it verbatim without rewriting, expanding, or inventing details. Otherwise compose a visual prompt from their request. To edit or draw from existing images, pass them as reference_images and refer to them by position in the prompt. Ask for no more images in one call than the chosen model\'s description allows; for more images, make another call. The image is displayed directly to the user. Do not repeat or embed it in your reply, write an image path, or call other tools to locate or verify it.'
      + modelsText(config),
    parameters: {
      prompt: { type: 'string', required: true, description: 'The user-supplied image prompt verbatim when provided; otherwise a visual description based on their request.' },
      model: { type: 'string', description: 'Optional model id for this call only, verbatim, from the available models. Omit to use the selected default.' },
      n: { type: 'integer', description: "How many images to generate, at most the count the chosen model's description states. Omit for one." },
      size: { type: 'string', description: "Pixel size in WIDTHxHEIGHT form, e.g. '1024x1024' or '2730x1536' for 16:9, or a named size the chosen model lists in its description, e.g. '2K'. Never a tier the model does not list. Omit for the model default." },
      background: { type: 'string', enum: ['transparent', 'opaque'], description: 'Background to generate, for a model that offers the option. Omit to let the model decide.' },
      resolution: { type: 'string', description: 'A resolution tier the chosen model lists in its description, e.g. 2K. Use either resolution or size.' },
      seed: { type: 'integer', description: 'Provider seed, where the chosen model lists one; a fixed seed does not guarantee reproducible images.' },
      guidance_scale: { type: 'number', description: 'Prompt guidance strength, where the chosen model lists it; the Aeven models have none.' },
      output_format: { type: 'string', enum: ['png', 'jpeg'], description: 'Output file format, where the chosen model lists it.' },
      optimize_prompt_mode: { type: 'string', enum: ['standard', 'fast'], description: 'Prompt optimization, where the chosen model lists it: standard for quality, fast for lower latency.' },
      reference_images: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths of existing images to edit or draw from, in the order the prompt refers to them: workspace files, or the normalized copy path shown for a conversation image.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          label: { type: 'string', required: true },
          costUsdMicros: { type: 'integer' },
          images: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                attachmentId: { type: 'string', required: true },
                mediaType: { type: 'string', required: true },
                bytes: { type: 'integer', required: true },
                width: { type: 'integer', required: true },
                height: { type: 'integer', required: true },
                // A stored reference also reports the display name a provider
                // gave the image, and the dimensions normalization scaled down
                // from; a closed schema must declare both to accept it.
                name: { type: 'string' },
                originalDimensions: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    width: { type: 'integer', required: true },
                    height: { type: 'integer', required: true },
                  },
                },
              },
            },
          },
        },
      },
      // Durable image blocks are displayed at the generating call.
      render: (_args, value) => [
        {
          type: 'text',
          text: `Generated ${String(value.images.length)} image(s) with ${value.label}.${costText(value.costUsdMicros)} Already displayed to the user; do not repeat or embed them in your reply.`,
        },
        ...value.images.map(image => ({ type: 'image' as const, attachment: imageBlockRef(image) })),
      ],
    },
    async execute(args, exec) {
      // The picker runs before the provider call, so a generation the user did
      // not want never reaches an upstream and never spends a credit.
      const chosen = await pickModel(args, exec)
      const references = await readReferences(
        ctx.get('fs'),
        args.reference_images ?? [],
        { cwd: exec.agent?.session.header.cwd, signal: exec.signal },
        chosen.maxReferenceImageBytes ?? DEFAULT_MAX_REFERENCE_IMAGE_BYTES,
      )
      const result = await ctx.media.generateImage(resolveRequest(args, chosen, references), exec.signal)
      const images: ImageAttachmentRef[] = []
      for (const [index, image] of result.images.entries()) {
        images.push(await storeImage(image, input => ctx.attachments.saveImage({
          ...input,
          // The name is what the conversation's image preview titles and what a
          // download is called; without one it can only report `unknown`.
          name: generatedImageName(result.model, index, input.mediaType),
        })))
      }
      return {
        provider: result.provider,
        model: result.model,
        label: modelLabel(chosen.choices, result.model),
        ...result.costUsdMicros === undefined ? {} : { costUsdMicros: result.costUsdMicros },
        images,
      }
    },
  }))
}

/**
 * Register `generate_video` and `/video-model`.
 *
 * One call starts the provider's job, waits for it, and stores the finished
 * clip as a file attachment the result cites, so the conversation plays it at
 * the call and the model reads it as an attached file.
 * @param ctx - context carrying the tool registry, the media seam, and attachments.
 * @param config - the deployment's video default and selectable models.
 */
function registerVideoTool(ctx: Context, config: VideoConfig): void {
  const selection = installSelection<VideoConfig>(ctx, {
    kind: 'video',
    namespace: VIDEO_SETTINGS_NAMESPACE,
    schema: VideoConfig,
    base: config,
    extraChoices: () => Promise.resolve([]),
  })

  ctx.tools.register(defineTool({
    name: 'generate_video',
    description: 'Generate a video clip from a text prompt, optionally starting from an image, and attach it to the conversation. Use when the user asks to create, animate, or generate a video. Give a complete prompt covering subject, action, camera movement, style, and lighting. Generation takes minutes. To animate an existing image, pass it as the first of reference_images; a second image is the last frame. The video is displayed directly to the user with playback controls. Do not repeat or embed it in your reply, write a video path, or call other tools to locate or verify it.'
      + modelsText(config),
    parameters: {
      prompt: { type: 'string', required: true, description: 'Complete description of the video to generate.' },
      model: { type: 'string', description: 'Optional model id for this call only, verbatim, from the available models. Omit to use the selected default.' },
      duration: { type: 'integer', description: 'Clip length in seconds the chosen model lists — a range, or only fixed lengths such as 4, 6 or 8 — or -1 to let the model decide where it offers that. Omit for the model default.' },
      resolution: { type: 'string', description: 'An output resolution the chosen model lists, e.g. 720p. Omit for the model default.' },
      aspect_ratio: { type: 'string', description: "An aspect ratio the chosen model lists, e.g. '16:9' or '9:16', or 'adaptive' to follow the first frame. Omit for the model default." },
      seed: { type: 'integer', description: 'Provider seed, where the chosen model lists one; a fixed seed does not guarantee a reproducible clip.' },
      generate_audio: { type: 'boolean', description: 'Whether the clip carries audio synchronized with the visuals, where the chosen model offers it.' },
      reference_images: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths of at most two images: the first frame, then optionally the last frame. Workspace files, or the normalized copy path shown for a conversation image.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          label: { type: 'string', required: true },
          costUsdMicros: { type: 'integer' },
          video: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              name: { type: 'string', required: true },
              extraction: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  textId: { type: 'string', required: true },
                  chars: { type: 'integer', required: true },
                  method: { type: 'string', required: true },
                  extractor: { type: 'string', required: true },
                  truncated: { type: 'boolean', required: true },
                  pages: { type: 'integer' },
                },
              },
            },
          },
        },
      },
      // The durable file block is played at the generating call.
      render: (_args, value) => [
        {
          type: 'text',
          text: `Generated a video with ${value.label}.${costText(value.costUsdMicros)} Already displayed to the user with playback controls; do not repeat or embed it in your reply.`,
        },
        { type: 'file' as const, attachment: fileBlockRef(value.video) },
      ],
    },
    async execute(args, exec) {
      // The picker runs before the provider call, so a generation the user did
      // not want never reaches an upstream and never spends a credit.
      const chosen = await selection.pick(args, exec)
      const references = await readReferences(
        ctx.get('fs'),
        args.reference_images ?? [],
        { cwd: exec.agent?.session.header.cwd, signal: exec.signal },
        chosen.maxReferenceImageBytes ?? DEFAULT_MAX_REFERENCE_IMAGE_BYTES,
      )
      const request = resolveVideoRequest(args, chosen, references)
      const started = await ctx.media.startVideo(request, exec.signal)
      const finished = await awaitVideo(
        job => ctx.media.videoStatus(job, exec.signal),
        started,
        chosen.pollIntervalMs ?? DEFAULT_VIDEO_POLL_INTERVAL_MS,
        chosen.maxWaitMs ?? DEFAULT_VIDEO_MAX_WAIT_MS,
        exec.signal,
      )
      const clip = await ctx.media.fetchVideo(finished, exec.signal)
      const video = await ctx.attachments.saveFile(videoFileInput(clip, request.model, args.prompt))
      return {
        provider: finished.provider,
        model: request.model,
        label: modelLabel(chosen.choices, request.model),
        ...finished.costUsdMicros === undefined ? {} : { costUsdMicros: finished.costUsdMicros },
        video,
      }
    },
  }))
}
