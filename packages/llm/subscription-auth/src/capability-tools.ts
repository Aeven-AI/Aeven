/**
 * Optional Codex / Grok Imagine tool definitions. The factory only returns
 * public `ToolDefinition` objects — it never registers on `ctx.tools`.
 * Feature flags and `imageCount` are re-read from `current()` at execute time.
 * @module @aeven/subscription-auth/capability-tools
 */

import type { ImageAttachmentRef } from '@aeven/attachment'
import { LlmError } from '@aeven/llm'
import type { ToolDefinition, ToolRunContext } from '@aeven/tools'
import { CAPABILITY_SETTINGS_BOUNDS, type CapabilitySettings } from './capability-settings.ts'
import type { CodexAuthSession } from './codex-http.ts'
import {
  CODEX_IMAGE_BACKGROUNDS,
  CODEX_IMAGE_MODEL,
  CODEX_IMAGE_PROMPT_MAX_LENGTH,
  CODEX_IMAGE_QUALITIES,
  CODEX_IMAGE_SIZES,
  type CodexImageAttachmentStore,
  type CodexImageBackground,
  type CodexImageController,
  type CodexImageGenerateInput,
  type CodexImageQuality,
  type CodexImageResult,
  type CodexImageRoute,
  type CodexImageRoutePolicy,
  type CodexImageSessionContext,
  type CodexImageSize,
  createCodexImageController,
} from './codex-images.ts'
import {
  type GenerateImagineImageInput,
  GROK_IMAGINE_IMAGE_MODEL,
  GROK_IMAGINE_IMAGE_TOOL,
  GROK_IMAGINE_VIDEO_MODEL,
  GROK_IMAGINE_VIDEO_STATUS_TOOL,
  GROK_IMAGINE_VIDEO_TOOL,
  type GrokImagineClient,
  IMAGINE_IMAGE_ASPECT_RATIOS,
  IMAGINE_IMAGE_RESOLUTIONS,
  IMAGINE_PROMPT_MAX_LENGTH,
  IMAGINE_VIDEO_ASPECT_RATIOS,
  IMAGINE_VIDEO_MAX_DURATION_SECONDS,
  IMAGINE_VIDEO_MIN_DURATION_SECONDS,
  IMAGINE_VIDEO_RESOLUTIONS,
  type ImagineImageResult,
  type ImagineVideoStartResult,
  type ImagineVideoStatusResult,
  imagineImagePath,
  parseVideoRequestId,
  type StartImagineVideoInput,
} from './grok-imagine.ts'
import { imagineMediaPath, type MediaArtifactMeta } from './media-store.ts'

/** Tool name for codex image generate. */
export const CODEX_IMAGE_GENERATE_TOOL = 'codex_image_generate'
/** Tool name for codex image edit. */
export const CODEX_IMAGE_EDIT_TOOL = 'codex_image_edit'

export {
  GROK_IMAGINE_IMAGE_TOOL,
  GROK_IMAGINE_VIDEO_STATUS_TOOL,
  GROK_IMAGINE_VIDEO_TOOL,
} from './grok-imagine.ts'

const IMAGE_COUNT_VALUES = [1, 2, 3, 4] as const
const VIDEO_DURATION_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const
const IMAGINE_IMAGE_PREFIX = '/plugins/avn-grok-build/imagine/images/'
const IMAGINE_MEDIA_PREFIX = '/plugins/avn-grok-build/imagine/media/'

/** Shared client surface; production passes one `GrokImagineClient` so video status can see started jobs. */
export type CapabilityImagineClient = Pick<GrokImagineClient, 'generateImage' | 'startVideo' | 'videoStatus'>

/** Per-exec Codex controller factory. Tests inject a fake; production binds auth + attachments. */
export type CreateCodexImageController = (
  session: CodexImageSessionContext,
  routePolicy: CodexImageRoutePolicy,
) => CodexImageController

/**
 * Route gate for the Codex image tools. `codexImagesAnyModel` relaxes the
 * Codex-route requirement; otherwise the gate stays `codex-capable`.
 * @param settings - Settings value.
 * @returns The resulting codex image route policy.
 */
export function codexImageRoutePolicy(settings: CapabilitySettings): CodexImageRoutePolicy {
  return settings.codexImagesAnyModel ? 'any' : 'codex-capable'
}

/** Resolve authoritative host model metadata for the calling route. */
export type ResolveCodexImageRoute = (exec: ToolRunContext) => Promise<CodexImageRoute | undefined>

/**
 * Exact provider/model identity from the live request header, then agent options.
 * @param exec - Exec value.
 * @returns The resulting calling route identity.
 */
export function callingRouteIdentity(exec: ToolRunContext): { provider: string; model: string } | undefined {
  const session = exec.agent?.session
  const header =
    session !== undefined && typeof session.requestHeader === 'function' ? session.requestHeader()?.config : undefined
  const provider = header?.provider ?? exec.agent?.options.provider
  const model = header?.model ?? exec.agent?.options.model
  if (typeof provider !== 'string' || provider.length === 0) return undefined
  if (typeof model !== 'string' || model.length === 0) return undefined
  return { provider, model }
}

/**
 * Copy host-resolved modalities onto the calling identity. Never invents
 * `inputModalities`; lookup failures keep the identity and omit the field so
 * the image-capability gate fails closed.
 * @param exec - Exec value.
 * @param resolveModelInfo - Resolve model info value.
 * @returns The resolved codex image route from llm.
 */
export async function resolveCodexImageRouteFromLlm(
  exec: ToolRunContext,
  resolveModelInfo: (
    provider: string,
    model: string,
    signal?: AbortSignal,
  ) => Promise<{ inputModalities?: readonly string[] }>,
): Promise<CodexImageRoute | undefined> {
  const identity = callingRouteIdentity(exec)
  if (identity === undefined) return undefined
  try {
    const info = await resolveModelInfo(identity.provider, identity.model, exec.signal)
    const modalities = info.inputModalities
    return {
      ...identity,
      ...(Array.isArray(modalities) ? { inputModalities: [...(modalities as string[])] } : {}),
    }
  } catch {
    return identity
  }
}

/**
 * One finished generated artifact, named by the store that already holds it so
 * the tool layer never handles the bytes itself.
 */
export type WorkspaceArtifact =
	| { readonly kind: 'image'; readonly attachment: ImageAttachmentRef }
	| { readonly kind: 'video'; readonly artifactId: string }

/**
 * Copy one finished artifact into the calling session's workspace.
 * @param exec - the running tool call, whose agent names the session.
 * @param artifact - the stored image or video to copy out.
 * @returns the workspace-relative path written, or `undefined` when this
 * deployment resolves no workspace root and the copy was skipped.
 */
export type SaveArtifactToWorkspace = (
  exec: ToolRunContext,
  artifact: WorkspaceArtifact,
) => Promise<string | undefined>

/**
 * Copy every artifact this call produced, keeping the generated media as the
 * result even when the workspace copy is unavailable: the attachment and its
 * same-origin path already carry the media, so a failed copy must not fail a
 * successful generation.
 * @param save - the deployment's writer, absent when no workspace is mounted.
 * @param exec - the running tool call.
 * @param artifacts - stored artifacts to copy out, in result order.
 * @returns the workspace-relative paths actually written.
 */
async function saveAllToWorkspace(
  save: SaveArtifactToWorkspace | undefined,
  exec: ToolRunContext,
  artifacts: readonly WorkspaceArtifact[],
): Promise<string[]> {
  if (save === undefined) return []
  const written: string[] = []
  for (const artifact of artifacts) {
    try {
      const path = await save(exec, artifact)
      if (path !== undefined) written.push(path)
    } catch {
      // A workspace that rejects the write (read-only mount, permissions,
      // full disk) leaves the artifact reachable at its same-origin path.
      return written
    }
  }
  return written
}

/**
 * Attach workspace copies of one Codex result's generated images. Reference
 * images are inputs the session already holds, so only `images` is copied out.
 * @param result - the public Codex result about to be returned.
 * @param save - the deployment's writer, absent when no workspace is mounted.
 * @param exec - the running tool call.
 * @returns the result, carrying `workspacePaths` when any copy was written.
 */
async function withWorkspaceCopies<T extends { images: readonly ImageAttachmentRef[] }>(
  result: T,
  save: SaveArtifactToWorkspace | undefined,
  exec: ToolRunContext,
): Promise<T | (T & { workspacePaths: string[] })> {
  const workspacePaths = await saveAllToWorkspace(
    save,
    exec,
    result.images.map(attachment => ({ kind: 'image' as const, attachment })),
  )
  return workspacePaths.length === 0 ? result : { ...result, workspacePaths }
}

/** Options for capability tools. */
export interface CapabilityToolsOptions {
  /** Live capability section. Re-read on every execute so a disable takes effect immediately. */
  current(): CapabilitySettings
  readonly auth: CodexAuthSession
  readonly attachments: CodexImageAttachmentStore
  readonly imagine: CapabilityImagineClient
  readonly createCodexController?: CreateCodexImageController
  readonly resolveCodexImageRoute?: ResolveCodexImageRoute
  /** Omitted when no workspace is mounted; results then carry no `workspacePath`. */
  readonly saveToWorkspace?: SaveArtifactToWorkspace
}

const attachmentRefSchema = {
  type: 'object' as const,
  additionalProperties: false as const,
  properties: {
    attachmentId: { type: 'string' as const, required: true as const },
    mediaType: { type: 'string' as const, required: true as const },
    bytes: { type: 'integer' as const, required: true as const },
    width: { type: 'integer' as const, required: true as const },
    height: { type: 'integer' as const, required: true as const },
    name: { type: 'string' as const },
  },
}

/**
 * Shared schema fragment for the Imagine video `requestId`. The host value
 * schema DSL cannot express string patterns, so execute-time validation keeps
 * the authoritative `^[A-Za-z0-9_-]{1,256}$` boundary.
 */
const videoRequestIdSchema = {
  type: 'string' as const,
  required: true as const,
}

/** Shared prompt fragment; execute-time clients reject empty/oversized input. */
const promptParameter = {
  type: 'string' as const,
  required: true as const,
}

/** Wording of the Codex image tools' `n` parameter; only the counted subject differs. */
const IMAGE_COUNT_DESCRIPTIONS = {
  generate: 'How many images to generate. Defaults to the live imageCount setting and cannot exceed it.',
  edit: 'How many edited images to return. Defaults to the live imageCount setting and cannot exceed it.',
} as const

/**
 * The parameters the two Codex image tools share. Both tools take the same
 * count and optional size/quality/background knobs, so they declare one shared
 * fragment map instead of restating it; only `n`'s wording differs.
 * @param operation - the tool being declared.
 * @returns the shared parameter fragments.
 */
function codexImageParameters(operation: 'generate' | 'edit') {
  return {
    n: {
      type: 'integer' as const,
      enum: [...IMAGE_COUNT_VALUES],
      description: IMAGE_COUNT_DESCRIPTIONS[operation],
    },
    size: {
      type: 'string' as const,
      enum: [...CODEX_IMAGE_SIZES],
      description: 'Output size. Defaults to auto.',
    },
    quality: {
      type: 'string' as const,
      enum: [...CODEX_IMAGE_QUALITIES],
      description: 'Output quality. Defaults to auto.',
    },
    background: {
      type: 'string' as const,
      enum: [...CODEX_IMAGE_BACKGROUNDS],
      description: 'Background mode. Defaults to auto.',
    },
  }
}

const warningSchema = {
  type: 'object' as const,
  additionalProperties: false as const,
  properties: {
    index: { type: 'integer' as const, required: true as const },
    code: { type: 'string' as const, required: true as const },
    message: { type: 'string' as const, required: true as const },
  },
}

const artifactSchema = {
  type: 'object' as const,
  additionalProperties: false as const,
  properties: {
    artifactId: { type: 'string' as const, required: true as const },
    mediaType: { type: 'string' as const, required: true as const },
    bytes: { type: 'integer' as const, required: true as const },
    createdAt: { type: 'integer' as const, required: true as const },
    expiresAt: { type: 'integer' as const, required: true as const },
    name: { type: 'string' as const },
  },
}

const imagineImageItemSchema = {
  type: 'object' as const,
  additionalProperties: false as const,
  properties: {
    attachment: { ...attachmentRefSchema, required: true as const },
    path: { type: 'string' as const, required: true as const },
  },
}

/**
 * The output schema the two Codex image tools share. Both publish the same
 * result shape and differ only in which operation the value records.
 * @param operation - the operation the declaring tool performs.
 * @returns the shared output schema, with `operation` pinned to that value.
 */
function codexImageOutputSchema<const Operation extends 'generate' | 'edit'>(operation: Operation) {
  return {
    type: 'object' as const,
    additionalProperties: false as const,
    properties: {
      operation: { type: 'string' as const, required: true as const, enum: [operation] },
      model: { type: 'string' as const, required: true as const },
      images: { type: 'array' as const, required: true as const, items: attachmentRefSchema },
      references: { type: 'array' as const, required: true as const, items: attachmentRefSchema },
      warnings: { type: 'array' as const, required: true as const, items: warningSchema },
      workspacePaths: { type: 'array' as const, items: { type: 'string' as const } },
    },
  }
}

function disabled(name: string): never {
  throw new LlmError(`${name} is disabled`, 'INVALID_ARGS')
}

function imageCountLimit(settings: CapabilitySettings): number {
  const value = settings.imageCount
  if (!Number.isSafeInteger(value) || value < CAPABILITY_SETTINGS_BOUNDS.imageCount.min) {
    return CAPABILITY_SETTINGS_BOUNDS.imageCount.default
  }
  return Math.min(value, CAPABILITY_SETTINGS_BOUNDS.imageCount.max)
}

function resolveImageCount(n: number | undefined, settings: CapabilitySettings): number {
  const limit = imageCountLimit(settings)
  const value = n ?? limit
  if (!Number.isSafeInteger(value) || value < 1 || value > limit) {
    throw new LlmError(`n cannot exceed the configured imageCount (${String(limit)})`, 'INVALID_ARGS')
  }
  return value
}

async function routeFromExec(
  exec: ToolRunContext,
  resolve: ResolveCodexImageRoute | undefined,
): Promise<CodexImageRoute | undefined> {
  if (resolve === undefined) return undefined
  try {
    const resolved = await resolve(exec)
    if (resolved === undefined) return undefined
    const modalities = resolved.inputModalities
    return {
      ...(typeof resolved.provider === 'string' && resolved.provider.length > 0 ? { provider: resolved.provider } : {}),
      ...(typeof resolved.model === 'string' && resolved.model.length > 0 ? { model: resolved.model } : {}),
      ...(Array.isArray(modalities) ? { inputModalities: [...(modalities as string[])] } : {}),
    }
  } catch {
    return undefined
  }
}

async function generateSession(
  exec: ToolRunContext,
  resolve: ResolveCodexImageRoute | undefined,
): Promise<CodexImageSessionContext> {
  const route = await routeFromExec(exec, resolve)
  return {
    deriveMessages: () => [],
    ...(route === undefined ? {} : { route }),
  }
}

async function requireEditSession(
  exec: ToolRunContext,
  resolve: ResolveCodexImageRoute | undefined,
): Promise<CodexImageSessionContext> {
  const session = exec.agent?.session
  if (session === undefined || typeof session.deriveMessages !== 'function') {
    throw new LlmError('codex_image_edit requires an active agent session', 'INVALID_ARGS')
  }
  const route = await routeFromExec(exec, resolve)
  return {
    deriveMessages: () => session.deriveMessages(),
    ...(route === undefined ? {} : { route }),
  }
}

function publicPluginPath(path: string | undefined, fallback: string, prefix: string): string {
  if (typeof path === 'string' && path.startsWith(prefix)) return path
  return fallback
}

function publicAttachmentRef(ref: {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
  name?: string
}): ImageAttachmentRef {
  return {
    attachmentId: ref.attachmentId as ImageAttachmentRef['attachmentId'],
    mediaType: ref.mediaType as ImageAttachmentRef['mediaType'],
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...(ref.name === undefined ? {} : { name: ref.name }),
  }
}

function publicArtifact(meta: MediaArtifactMeta): MediaArtifactMeta {
  return {
    artifactId: meta.artifactId,
    mediaType: meta.mediaType,
    bytes: meta.bytes,
    createdAt: meta.createdAt,
    expiresAt: meta.expiresAt,
    ...(meta.name === undefined ? {} : { name: meta.name }),
  }
}

function publicCodexResult<const Operation extends 'generate' | 'edit'>(
  result: CodexImageResult & { operation: Operation },
): {
  operation: Operation
  model: typeof CODEX_IMAGE_MODEL
  images: ImageAttachmentRef[]
  references: ImageAttachmentRef[]
  warnings: Array<{ index: number; code: string; message: string }>
} {
  return {
    operation: result.operation,
    model: CODEX_IMAGE_MODEL,
    images: result.images.map(publicAttachmentRef),
    references: result.references.map(publicAttachmentRef),
    warnings: result.warnings.map(warning => ({
      index: warning.index,
      code: warning.code,
      message: warning.message,
    })),
  }
}

function publicImagineImageResult(result: ImagineImageResult): {
  model: string
  images: Array<{ attachment: ImageAttachmentRef; path: string }>
  attachment: ImageAttachmentRef
  path: string
} {
  const images = result.images.map((image) => {
    const attachment = publicAttachmentRef(image.attachment)
    return {
      attachment,
      path: publicPluginPath(image.path, imagineImagePath(String(attachment.attachmentId)), IMAGINE_IMAGE_PREFIX),
    }
  })
  const first = images[0]
  const fallback = first ?? {
    attachment: publicAttachmentRef(result.attachment),
    path: publicPluginPath(result.path, imagineImagePath(result.attachment.attachmentId), IMAGINE_IMAGE_PREFIX),
  }
  return {
    model: GROK_IMAGINE_IMAGE_MODEL,
    images,
    attachment: fallback.attachment,
    path: fallback.path,
  }
}

function publicVideoStart(result: ImagineVideoStartResult): ImagineVideoStartResult {
  return {
    model: GROK_IMAGINE_VIDEO_MODEL,
    requestId: result.requestId,
    status: 'pending',
  }
}

function publicVideoStatus(result: ImagineVideoStatusResult): {
  readonly requestId: string
  readonly status: ImagineVideoStatusResult['status']
  readonly artifact?: MediaArtifactMeta
  readonly path?: string
  readonly error?: string
} {
  const artifact = result.artifact === undefined ? undefined : publicArtifact(result.artifact)
  const path =
    artifact === undefined
      ? undefined
      : publicPluginPath(result.path, imagineMediaPath(artifact.artifactId), IMAGINE_MEDIA_PREFIX)
  return {
    requestId: result.requestId,
    status: result.status,
    ...(artifact === undefined ? {} : { artifact }),
    ...(path === undefined ? {} : { path }),
    ...(typeof result.error === 'string' ? { error: result.error } : {}),
  }
}

function renderImageRefs(
  summary: string,
  refs: readonly {
    attachmentId: string
    mediaType: string
    bytes: number
    width: number
    height: number
    name?: string
  }[],
) {
  return [
    { type: 'text' as const, text: summary },
    ...refs.map(ref => ({ type: 'image' as const, attachment: publicAttachmentRef(ref) })),
  ]
}

/**
 * Build the model-supplied knobs of a Codex image request, resolving `n`
 * against the live setting and passing through only the optional fields the
 * caller actually sent, so an omitted knob keeps the client's own default.
 * @param args - the optional image knobs this call supplied.
 * @param settings - live capability settings, which bound `n`.
 * @returns the request knobs, with `n` resolved.
 */
function codexImageOptions(
  args: {
    readonly n?: number | undefined
    readonly size?: CodexImageSize | undefined
    readonly quality?: CodexImageQuality | undefined
    readonly background?: CodexImageBackground | undefined
  },
  settings: CapabilitySettings,
): Pick<CodexImageGenerateInput, 'n' | 'size' | 'quality' | 'background'> {
  return {
    n: resolveImageCount(args.n, settings),
    ...(args.size === undefined ? {} : { size: args.size }),
    ...(args.quality === undefined ? {} : { quality: args.quality }),
    ...(args.background === undefined ? {} : { background: args.background }),
  }
}

/**
 * Render summary shared by the two Codex image tools: the same sentence names
 * the workspace copies when any were written, and only the verb differs.
 * @param verb - the tool's own action, `Generated` or `Edited`.
 * @param value - the result being rendered.
 * @returns the summary text.
 */
function codexImageSummary(
  verb: 'Generated' | 'Edited',
  value: {
    readonly model: string
    readonly images: readonly unknown[]
    readonly workspacePaths?: readonly string[] | undefined
  },
): string {
  const summary = `${verb} ${String(value.images.length)} Codex image(s) with ${value.model}`
  const paths = value.workspacePaths
  return paths === undefined || paths.length === 0 ? `${summary}.` : `${summary}, saved to ${paths.join(', ')}.`
}

/**
 * Build the five optional capability tools. Callers register the returned
 * definitions; this function has no Cordis / registry side effects. The tools
 * peer is loaded only after Cordis has composed the optional `tools` service.
 * @param options - Operation options.
 * @returns The created capability tools.
 */
export async function createCapabilityTools(options: CapabilityToolsOptions): Promise<readonly ToolDefinition[]> {
  const { defineTool } = await import('@aeven/tools')
  const createController: CreateCodexImageController =
    options.createCodexController ??
		((session, routePolicy) =>
		  createCodexImageController({
		    auth: options.auth,
		    attachments: options.attachments,
		    session,
		    routePolicy,
		  }))

  const generate = defineTool({
    name: CODEX_IMAGE_GENERATE_TOOL,
    description:
			'Generate images with the signed-in Codex subscription. Uses the fixed gpt-image-2 model. Does not accept a model id or image URL.',
    parameters: {
      prompt: {
        ...promptParameter,
        description: `Image generation prompt (1-${String(CODEX_IMAGE_PROMPT_MAX_LENGTH)} characters).`,
      },
      ...codexImageParameters('generate'),
    },
    output: {
      schema: codexImageOutputSchema('generate'),
      render: (_args, value) => renderImageRefs(codexImageSummary('Generated', value), value.images),
    },
    async execute(args, exec) {
      const settings = options.current()
      if (!settings.codexImages) disabled(CODEX_IMAGE_GENERATE_TOOL)
      const result = await createController(
        await generateSession(exec, options.resolveCodexImageRoute),
        codexImageRoutePolicy(settings),
      ).generate({ prompt: args.prompt, ...codexImageOptions(args, settings) }, exec.signal)
      return await withWorkspaceCopies(
        publicCodexResult({ ...result, operation: 'generate' }),
        options.saveToWorkspace,
        exec,
      )
    },
  })

  const edit = defineTool({
    name: CODEX_IMAGE_EDIT_TOOL,
    description:
			'Edit current-session Codex images. imageIds must be canonical attachment ids visible in this session. Does not accept HTTP(S) URLs or a model id.',
    parameters: {
      prompt: {
        ...promptParameter,
        description: `Edit instructions (1-${String(CODEX_IMAGE_PROMPT_MAX_LENGTH)} characters).`,
      },
      imageIds: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'One to five current-session image attachment ids (optionally image:<id>). URLs are rejected.',
      },
      ...codexImageParameters('edit'),
    },
    output: {
      schema: codexImageOutputSchema('edit'),
      render: (_args, value) => renderImageRefs(codexImageSummary('Edited', value), value.images),
    },
    async execute(args, exec) {
      const settings = options.current()
      if (!settings.codexImageEdits || !settings.codexImages) disabled(CODEX_IMAGE_EDIT_TOOL)
      const result = await createController(
        await requireEditSession(exec, options.resolveCodexImageRoute),
        codexImageRoutePolicy(settings),
      ).edit({ prompt: args.prompt, imageIds: args.imageIds, ...codexImageOptions(args, settings) }, exec.signal)
      return await withWorkspaceCopies(
        publicCodexResult({ ...result, operation: 'edit' }),
        options.saveToWorkspace,
        exec,
      )
    },
  })

  const imagineImage = defineTool({
    name: GROK_IMAGINE_IMAGE_TOOL,
    description:
			'Generate images with official xAI Imagine. Uses the fixed grok-imagine-image-2.0 model. Does not accept a model id or source URL.',
    parameters: {
      prompt: {
        ...promptParameter,
        description: `Image generation prompt (1-${String(IMAGINE_PROMPT_MAX_LENGTH)} characters).`,
      },
      n: {
        type: 'integer',
        enum: [...IMAGE_COUNT_VALUES],
        description: 'How many images to generate. Defaults to the live imageCount setting and cannot exceed it.',
      },
      aspectRatio: {
        type: 'string',
        enum: [...IMAGINE_IMAGE_ASPECT_RATIOS],
        description: 'Optional Imagine image aspect ratio.',
      },
      resolution: {
        type: 'string',
        enum: [...IMAGINE_IMAGE_RESOLUTIONS],
        description: 'Optional Imagine image resolution.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          model: { type: 'string', required: true },
          images: { type: 'array', required: true, items: imagineImageItemSchema },
          attachment: { ...attachmentRefSchema, required: true },
          path: { type: 'string', required: true },
          workspacePaths: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) =>
        renderImageRefs(
          value.workspacePaths === undefined || value.workspacePaths.length === 0
            ? `Generated ${String(value.images.length)} Imagine image(s).`
            : `Generated ${String(value.images.length)} Imagine image(s), saved to ${value.workspacePaths.join(', ')}.`,
          value.images.map(image => image.attachment),
        ),
    },
    async execute(args, exec) {
      const settings = options.current()
      if (!settings.grokImagineImage) disabled(GROK_IMAGINE_IMAGE_TOOL)
      const input: GenerateImagineImageInput = {
        prompt: args.prompt,
        n: resolveImageCount(args.n, settings),
        ...(args.aspectRatio === undefined ? {} : { aspectRatio: args.aspectRatio }),
        ...(args.resolution === undefined ? {} : { resolution: args.resolution }),
      }
      const result = publicImagineImageResult(await options.imagine.generateImage(input, exec.signal))
      const workspacePaths = await saveAllToWorkspace(
        options.saveToWorkspace,
        exec,
        result.images.map(image => ({ kind: 'image' as const, attachment: image.attachment })),
      )
      return workspacePaths.length === 0 ? result : { ...result, workspacePaths }
    },
  })

  const imagineVideo = defineTool({
    name: GROK_IMAGINE_VIDEO_TOOL,
    description:
			'Start an official xAI Imagine video job. Uses the fixed grok-imagine-video-1.5 model. Poll status with grok_imagine_video_status and the returned requestId.',
    parameters: {
      prompt: {
        ...promptParameter,
        description: `Video generation prompt (1-${String(IMAGINE_PROMPT_MAX_LENGTH)} characters).`,
      },
      duration: {
        type: 'integer',
        enum: [...VIDEO_DURATION_VALUES],
        description: `Optional duration in seconds (${String(IMAGINE_VIDEO_MIN_DURATION_SECONDS)}-${String(IMAGINE_VIDEO_MAX_DURATION_SECONDS)}).`,
      },
      aspectRatio: {
        type: 'string',
        enum: [...IMAGINE_VIDEO_ASPECT_RATIOS],
        description: 'Optional Imagine video aspect ratio.',
      },
      resolution: {
        type: 'string',
        enum: [...IMAGINE_VIDEO_RESOLUTIONS],
        description: 'Optional Imagine video resolution.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          model: { type: 'string', required: true },
          requestId: { ...videoRequestIdSchema },
          status: { type: 'string', required: true, enum: ['pending'] },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Imagine video job ${value.requestId} is ${value.status}.` }],
    },
    async execute(args, exec) {
      const settings = options.current()
      if (!settings.grokImagineVideo) disabled(GROK_IMAGINE_VIDEO_TOOL)
      const input: StartImagineVideoInput = {
        prompt: args.prompt,
        ...(args.duration === undefined ? {} : { duration: args.duration }),
        ...(args.aspectRatio === undefined ? {} : { aspectRatio: args.aspectRatio }),
        ...(args.resolution === undefined ? {} : { resolution: args.resolution }),
      }
      return publicVideoStart(await options.imagine.startVideo(input, exec.signal))
    },
  })

  const imagineVideoStatus = defineTool({
    name: GROK_IMAGINE_VIDEO_STATUS_TOOL,
    description:
			'Poll a previously started Imagine video job by requestId. Completed results expose only an opaque artifact id and same-origin path.',
    parameters: {
      requestId: { ...videoRequestIdSchema, description: 'Opaque request id returned by grok_imagine_video.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requestId: { ...videoRequestIdSchema },
          status: { type: 'string', required: true, enum: ['pending', 'completed', 'failed'] },
          artifact: artifactSchema,
          path: { type: 'string' },
          workspacePath: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const detail =
          value.status === 'completed' && value.path !== undefined
            ? `Imagine video ${value.requestId} completed (${value.workspacePath ?? value.path}).`
            : `Imagine video ${value.requestId} is ${value.status}.`
        return [{ type: 'text', text: detail }]
      },
    },
    async execute(args, exec) {
      const settings = options.current()
      if (!settings.grokImagineVideo) disabled(GROK_IMAGINE_VIDEO_STATUS_TOOL)
      const requestId = parseVideoRequestId(args.requestId)
      const result = publicVideoStatus(await options.imagine.videoStatus(requestId, { signal: exec.signal }))
      if (result.artifact === undefined) return result
      const [workspacePath] = await saveAllToWorkspace(options.saveToWorkspace, exec, [
        { kind: 'video', artifactId: result.artifact.artifactId },
      ])
      return workspacePath === undefined ? result : { ...result, workspacePath }
    },
  })

  return [generate, edit, imagineImage, imagineVideo, imagineVideoStatus]
}

/** Capability tool names. */
export const CAPABILITY_TOOL_NAMES = [
  CODEX_IMAGE_GENERATE_TOOL,
  CODEX_IMAGE_EDIT_TOOL,
  GROK_IMAGINE_IMAGE_TOOL,
  GROK_IMAGINE_VIDEO_TOOL,
  GROK_IMAGINE_VIDEO_STATUS_TOOL,
] as const
