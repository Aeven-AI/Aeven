import type { ImageAttachmentRef } from '@aeven/attachment'
import type { ToolDefinition, ToolRunContext } from '@aeven/tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CAPABILITY_SETTINGS_BOUNDS,
  type CapabilitySettings,
  DEFAULT_CAPABILITY_SETTINGS,
} from '../src/capability-settings.ts'
import {
  CAPABILITY_TOOL_NAMES,
  type CapabilityImagineClient,
  CODEX_IMAGE_EDIT_TOOL,
  CODEX_IMAGE_GENERATE_TOOL,
  type CreateCodexImageController,
  callingRouteIdentity,
  codexImageRoutePolicy,
  createCapabilityTools,
  resolveCodexImageRouteFromLlm,
  type SaveArtifactToWorkspace,
} from '../src/capability-tools.ts'
import type { CodexAuthSession } from '../src/codex-http.ts'
import {
  assertCodexImageCapableRoute,
  CODEX_IMAGE_MODEL,
  type CodexImageController,
  type CodexImageSessionContext,
} from '../src/codex-images.ts'
import {
  type GenerateImagineImageInput,
  GROK_IMAGINE_IMAGE_MODEL,
  GROK_IMAGINE_IMAGE_TOOL,
  GROK_IMAGINE_VIDEO_MODEL,
  GROK_IMAGINE_VIDEO_STATUS_TOOL,
  GROK_IMAGINE_VIDEO_TOOL,
  IMAGINE_IMAGE_IDS_MAX,
  IMAGINE_IMAGE_IDS_MIN,
  IMAGINE_PROMPT_MAX_LENGTH,
  type ImagineImageAttachmentRef,
  type ImagineImageResult,
  type ImagineVideoStartResult,
  type ImagineVideoStatusResult,
  type StartImagineVideoInput,
} from '../src/grok-imagine.ts'
import { imagineMediaPath } from '../src/media-store.ts'

const ARTIFACT_ID = 'ab'.repeat(16)

function imageRef(id: string): ImageAttachmentRef {
  return {
    attachmentId: id as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: 32,
    width: 1,
    height: 1,
    name: `${id}.png`,
  }
}

function imagineRef(id: string): ImagineImageAttachmentRef {
  return {
    attachmentId: id,
    mediaType: 'image/png',
    bytes: 32,
    width: 1,
    height: 1,
    name: `${id}.png`,
  }
}

function enabledSettings(overrides: Partial<CapabilitySettings> = {}): CapabilitySettings {
  return {
    ...DEFAULT_CAPABILITY_SETTINGS,
    codexImages: true,
    codexImageEdits: true,
    grokImagineImage: true,
    grokImagineVideo: true,
    imageCount: CAPABILITY_SETTINGS_BOUNDS.imageCount.default,
    ...overrides,
  }
}

function fakeExec(overrides: Partial<ToolRunContext> = {}): ToolRunContext {
  return {
    callId: 'call-1' as ToolRunContext['callId'],
    rootCallId: 'call-1' as ToolRunContext['rootCallId'],
    name: 'tool',
    arguments: {},
    signal: new AbortController().signal,
    token: Symbol('tool-token') as ToolRunContext['token'],
    deferContext: () => {},
    concludeTurn: () => {},
    ...overrides,
  }
}

function fakeAgent(
  input: {
    options?: { provider?: string; model?: string }
    header?: { provider: string; model: string }
    deriveMessages?: () => readonly unknown[]
  } = {},
): NonNullable<ToolRunContext['agent']> {
  return {
    options: input.options ?? {},
    session: {
      ...(input.deriveMessages === undefined ? {} : { deriveMessages: input.deriveMessages }),
      ...(input.header === undefined ? {} : { requestHeader: () => ({ config: input.header }) }),
    },
  } as unknown as NonNullable<ToolRunContext['agent']>
}

function toolByName(tools: readonly ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`missing tool ${name}`)
  return tool
}

function leakyImagineImage(): ImagineImageResult {
  const attachment = imagineRef('img_local')
  return {
    model: GROK_IMAGINE_IMAGE_MODEL,
    images: [
      {
        attachment,
        path: `/plugins/dsh-grok-build/imagine/images/${attachment.attachmentId}`,
      },
    ],
    attachment,
    path: `/plugins/dsh-grok-build/imagine/images/${attachment.attachmentId}`,
    url: 'https://imgen.x.ai/signed?token=abc',
    token: 'sk-secret',
  } as ImagineImageResult & { url: string; token: string }
}

function leakyVideoStart(): ImagineVideoStartResult & { url: string; access_token: string } {
  return {
    model: GROK_IMAGINE_VIDEO_MODEL,
    requestId: 'req_video_1',
    status: 'pending',
    url: 'https://videogen.x.ai/job',
    access_token: 'tok-secret',
  }
}

function leakyVideoStatus(): ImagineVideoStatusResult & { url: string; token: string } {
  return {
    requestId: 'req_video_1',
    status: 'completed',
    artifact: {
      artifactId: ARTIFACT_ID,
      mediaType: 'video/mp4',
      bytes: 64,
      createdAt: 1,
      expiresAt: 2,
    },
    path: imagineMediaPath(ARTIFACT_ID),
    url: 'https://videogen.x.ai/signed-clip',
    token: 'upstream-token',
  }
}

function fakeAuth(): CodexAuthSession {
  return {
    resolve: vi.fn(async () => ({ accessToken: 'tok', accountId: 'acct' })),
    invalidate: vi.fn(async () => {}),
  }
}

function fakeAttachments() {
  return {
    imageLimits: {
      maxImageBytes: 1024 * 1024,
      maxImagesPerMessage: 6,
      maxMessageImageBytes: 4 * 1024 * 1024,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const,
    },
    validateImage: vi.fn(async () => {}),
    saveImage: vi.fn(async () => imageRef('saved')),
    readImage: vi.fn(async (ref: ImageAttachmentRef) => ({ ref, data: new Uint8Array([1, 2, 3]) })),
  }
}

function fakeImagine(overrides: Partial<CapabilityImagineClient> = {}): CapabilityImagineClient {
  return {
    generateImage: vi.fn(async () => leakyImagineImage()),
    startVideo: vi.fn(async () => leakyVideoStart()),
    videoStatus: vi.fn(async () => leakyVideoStatus()),
    ...overrides,
  }
}

function fakeCodexController(overrides: Partial<CodexImageController> = {}): CodexImageController {
  const generated = imageRef('generated')
  return {
    generate: vi.fn<CodexImageController['generate']>(async () => ({
      operation: 'generate',
      model: CODEX_IMAGE_MODEL,
      images: [generated],
      references: [],
      warnings: [],
    })),
    edit: vi.fn<CodexImageController['edit']>(async () => ({
      operation: 'edit',
      model: CODEX_IMAGE_MODEL,
      images: [imageRef('edited')],
      references: [imageRef('owned')],
      warnings: [],
    })),
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('unexpected real network')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createCapabilityTools', () => {
  it('returns the five named tools without registering anything', async () => {
    const tools = await createCapabilityTools({
      current: () => DEFAULT_CAPABILITY_SETTINGS,
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
    })
    expect(tools.map(tool => tool.name)).toEqual([...CAPABILITY_TOOL_NAMES])
    expect(tools.every(tool => tool.isConcurrencySafe === undefined)).toBe(true)
    expect(tools.find(tool => tool.name === GROK_IMAGINE_IMAGE_TOOL)?.timeoutMs).toBeUndefined()
    expect(tools.find(tool => tool.name === GROK_IMAGINE_VIDEO_TOOL)?.timeoutMs).toBeUndefined()
    expect(tools.find(tool => tool.name === GROK_IMAGINE_VIDEO_STATUS_TOOL)?.timeoutMs).toBeUndefined()
  })

  it('leaves the Codex route gate open, because any-model is fixed on', () => {
    expect(codexImageRoutePolicy(enabledSettings())).toBe('any')
    expect(codexImageRoutePolicy(DEFAULT_CAPABILITY_SETTINGS)).toBe('any')
    // The narrow policy is still reachable for a caller that states it.
    expect(codexImageRoutePolicy({ ...DEFAULT_CAPABILITY_SETTINGS, codexImagesAnyModel: false })).toBe('codex-capable')
  })

  it('refuses at execute time when a capability is off, which settings can no longer make it', async () => {
    const generate = vi.fn()
    const edit = vi.fn()
    const imagine = fakeImagine()
    const resolveCodexImageRoute = vi.fn(async () => ({
      provider: 'codex-oauth',
      model: 'gpt-5.4',
      inputModalities: ['text', 'image'],
    }))
    // Stated directly rather than through `normalizeCapabilitySettings`, which
    // pins these on: the execute-time guard is defence in depth behind the
    // advertisement gate, and this is the only way left to exercise it.
    const allOff = {
      ...DEFAULT_CAPABILITY_SETTINGS,
      codexImages: false,
      codexImageEdits: false,
      grokImagineImage: false,
      grokImagineVideo: false,
    }
    const tools = await createCapabilityTools({
      current: () => allOff,
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine,
      createCodexController: () => fakeCodexController({ generate, edit }),
      resolveCodexImageRoute,
    })
    const exec = fakeExec({
      agent: fakeAgent({
        options: { provider: 'codex-oauth', model: 'gpt-5.4' },
        header: { provider: 'codex-oauth', model: 'gpt-5.4' },
      }),
    })
    await expect(toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute({ prompt: 'cube' }, exec)).rejects.toMatchObject({
      message: expect.stringContaining('disabled') as string,
    })
    await expect(
      toolByName(tools, CODEX_IMAGE_EDIT_TOOL).execute({ prompt: 'blue', imageIds: ['owned'] }, exec),
    ).rejects.toMatchObject({ message: expect.stringContaining('disabled') as string })
    await expect(toolByName(tools, GROK_IMAGINE_IMAGE_TOOL).execute({ prompt: 'orbit' }, exec)).rejects.toMatchObject({
      message: expect.stringContaining('disabled') as string,
    })
    await expect(toolByName(tools, GROK_IMAGINE_VIDEO_TOOL).execute({ prompt: 'orbit' }, exec)).rejects.toMatchObject({
      message: expect.stringContaining('disabled') as string,
    })
    await expect(
      toolByName(tools, GROK_IMAGINE_VIDEO_STATUS_TOOL).execute({ requestId: 'req_video_1' }, exec),
    ).rejects.toMatchObject({ message: expect.stringContaining('disabled') as string })
    expect(generate).not.toHaveBeenCalled()
    expect(edit).not.toHaveBeenCalled()
    expect(resolveCodexImageRoute).not.toHaveBeenCalled()
    expect(imagine.generateImage).not.toHaveBeenCalled()
    expect(imagine.startVideo).not.toHaveBeenCalled()
    expect(imagine.videoStatus).not.toHaveBeenCalled()
  })

  it('re-checks live flags after the tools already exist', async () => {
    let settings = enabledSettings()
    const generate = vi.fn()
    const tools = await createCapabilityTools({
      current: () => settings,
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      createCodexController: () => fakeCodexController({ generate }),
    })
    settings = enabledSettings({
      codexImages: false,
      codexImageEdits: false,
      grokImagineImage: false,
      grokImagineVideo: false,
    })
    await expect(
      toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute({ prompt: 'cube' }, fakeExec()),
    ).rejects.toMatchObject({ message: expect.stringContaining('disabled') as string })
    await expect(
      toolByName(tools, GROK_IMAGINE_VIDEO_STATUS_TOOL).execute({ requestId: 'req_video_1' }, fakeExec()),
    ).rejects.toMatchObject({ message: expect.stringContaining('disabled') as string })
    expect(generate).not.toHaveBeenCalled()
  })

  it('defaults omitted n to imageCount and rejects a larger n', async () => {
    const generate = vi.fn<CodexImageController['generate']>(async () => ({
      operation: 'generate',
      model: CODEX_IMAGE_MODEL,
      images: [imageRef('generated')],
      references: [],
      warnings: [],
    }))
    const imagineGenerate = vi.fn(async () => leakyImagineImage())
    const tools = await createCapabilityTools({
      current: () => enabledSettings({ imageCount: 2 }),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine({ generateImage: imagineGenerate }),
      createCodexController: () => fakeCodexController({ generate }),
    })
    await toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute({ prompt: 'cube' }, fakeExec())
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'cube', n: 2 }), expect.any(AbortSignal))
    await expect(
      toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute({ prompt: 'cube', n: 3 }, fakeExec()),
    ).rejects.toMatchObject({ message: expect.stringContaining('imageCount') as string })
    await expect(
      toolByName(tools, GROK_IMAGINE_IMAGE_TOOL).execute({ prompt: 'orbit', n: 3 }, fakeExec()),
    ).rejects.toMatchObject({ message: expect.stringContaining('imageCount') as string })
    expect(imagineGenerate).not.toHaveBeenCalled()
  })

  it('renders Codex and Imagine images from the canonical returned attachment refs', async () => {
    const generated = imageRef('generated')
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      createCodexController: () =>
        fakeCodexController({
          generate: vi.fn<CodexImageController['generate']>(async () => ({
            operation: 'generate',
            model: CODEX_IMAGE_MODEL,
            images: [generated],
            references: [],
            warnings: [],
          })),
        }),
    })
    const generateTool = toolByName(tools, CODEX_IMAGE_GENERATE_TOOL)
    const generateValue = (await generateTool.execute({ prompt: 'cube' }, fakeExec())) as {
      images: ImageAttachmentRef[]
    }
    expect(generateValue.images[0]?.attachmentId).toBe('generated')
    const generateView = generateTool.output.render({ prompt: 'cube' }, generateValue as never)
    expect(generateView[0]).toMatchObject({ type: 'text' })
    expect(generateView[1]).toMatchObject({
      type: 'image',
      attachment: { attachmentId: 'generated', mediaType: 'image/png' },
    })

    const imagineTool = toolByName(tools, GROK_IMAGINE_IMAGE_TOOL)
    const imagineValue = (await imagineTool.execute({ prompt: 'orbit' }, fakeExec())) as {
      images: Array<{ attachment: ImageAttachmentRef; path: string }>
    }
    expect(imagineValue.images[0]?.attachment.attachmentId).toBe('img_local')
    const imagineView = imagineTool.output.render({ prompt: 'orbit' }, imagineValue as never)
    expect(imagineView[0]).toMatchObject({ type: 'text' })
    expect(imagineView[1]).toMatchObject({
      type: 'image',
      attachment: { attachmentId: 'img_local' },
    })
  })

  it('fails Codex edit closed without an agent session and forwards deriveMessages when present', async () => {
    const sessions: CodexImageSessionContext[] = []
    const deriveMessages = vi.fn(() => [{ content: [{ type: 'image', attachment: imageRef('owned') }] }])
    const edit = vi.fn<CodexImageController['edit']>(async () => ({
      operation: 'edit',
      model: CODEX_IMAGE_MODEL,
      images: [imageRef('edited')],
      references: [imageRef('owned')],
      warnings: [],
    }))
    const createCodexController = vi.fn<CreateCodexImageController>((session) => {
      sessions.push(session)
      return fakeCodexController({ edit })
    })
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      createCodexController,
    })
    const editTool = toolByName(tools, CODEX_IMAGE_EDIT_TOOL)
    await expect(editTool.execute({ prompt: 'blue', imageIds: ['owned'] }, fakeExec())).rejects.toMatchObject({
      message: expect.stringContaining('agent session') as string,
    })
    expect(createCodexController).not.toHaveBeenCalled()

    const signal = new AbortController().signal
    await editTool.execute(
      { prompt: 'blue', imageIds: ['owned'] },
      fakeExec({
        signal,
        agent: fakeAgent({
          options: { provider: 'codex-oauth', model: 'gpt-5.4' },
          deriveMessages,
        }),
      }),
    )
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.deriveMessages()).toEqual([{ content: [{ type: 'image', attachment: imageRef('owned') }] }])
    expect(deriveMessages).toHaveBeenCalled()
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'blue', imageIds: ['owned'] }), signal)
  })

  it('lets generation run with empty history and forwards abort signal', async () => {
    const generate = vi.fn<CodexImageController['generate']>(async (_input, _signal) => ({
      operation: 'generate',
      model: CODEX_IMAGE_MODEL,
      images: [imageRef('generated')],
      references: [],
      warnings: [],
    }))
    const sessions: CodexImageSessionContext[] = []
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      createCodexController: (session) => {
        sessions.push(session)
        return fakeCodexController({ generate })
      },
    })
    const signal = new AbortController().signal
    await toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute({ prompt: 'cube' }, fakeExec({ signal }))
    expect(sessions[0]?.deriveMessages()).toEqual([])
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'cube' }), signal)
  })

  it('returns opaque Imagine outputs without upstream URLs or tokens', async () => {
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
    })
    const image = await toolByName(tools, GROK_IMAGINE_IMAGE_TOOL).execute({ prompt: 'orbit' }, fakeExec())
    expect(JSON.stringify(image)).not.toMatch(/imgen\.x\.ai|token|sk-secret/iu)
    expect(image).toMatchObject({
      model: GROK_IMAGINE_IMAGE_MODEL,
      path: '/plugins/dsh-grok-build/imagine/images/img_local',
      attachment: { attachmentId: 'img_local' },
    })

    const started = await toolByName(tools, GROK_IMAGINE_VIDEO_TOOL).execute({ prompt: 'orbit' }, fakeExec())
    expect(started).toEqual({
      model: GROK_IMAGINE_VIDEO_MODEL,
      requestId: 'req_video_1',
      status: 'pending',
    })
    expect(JSON.stringify(started)).not.toMatch(/videogen\.x\.ai|access_token|tok-secret/iu)

    const statusTool = toolByName(tools, GROK_IMAGINE_VIDEO_STATUS_TOOL)
    const status = (await statusTool.execute({ requestId: 'req_video_1' }, fakeExec())) as {
      requestId: string
      status: 'completed'
      artifact: { artifactId: string; mediaType: string; bytes: number; createdAt: number; expiresAt: number }
      path: string
    }
    expect(status).toEqual({
      requestId: 'req_video_1',
      status: 'completed',
      artifact: {
        artifactId: ARTIFACT_ID,
        mediaType: 'video/mp4',
        bytes: 64,
        createdAt: 1,
        expiresAt: 2,
      },
      path: imagineMediaPath(ARTIFACT_ID),
    })
    expect(JSON.stringify(status)).not.toMatch(/videogen\.x\.ai|upstream-token|https?:\/\//iu)
    const statusView = statusTool.output.render({ requestId: 'req_video_1' }, status)
    expect(statusView).toEqual([
      { type: 'text', text: `Imagine video req_video_1 completed (${imagineMediaPath(ARTIFACT_ID)}).` },
    ])
    expect(statusView.every(block => block.type === 'text')).toBe(true)
  })

  it('requires both Codex image flags for edits and grokImagineVideo for status', async () => {
    const edit = vi.fn()
    const imagine = fakeImagine()
    const resolveCodexImageRoute = vi.fn(async () => ({
      provider: 'codex-oauth',
      model: 'gpt-5.4',
      inputModalities: ['text', 'image'],
    }))
    const tools = await createCapabilityTools({
      current: () => enabledSettings({ codexImages: false, grokImagineVideo: false }),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine,
      createCodexController: () => fakeCodexController({ edit }),
      resolveCodexImageRoute,
    })
    await expect(
      toolByName(tools, CODEX_IMAGE_EDIT_TOOL).execute(
        { prompt: 'blue', imageIds: ['owned'] },
        fakeExec({
          agent: fakeAgent({
            options: { provider: 'codex-oauth', model: 'gpt-5.4' },
            deriveMessages: () => [],
          }),
        }),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('disabled') as string })
    await expect(
      toolByName(tools, GROK_IMAGINE_VIDEO_STATUS_TOOL).execute({ requestId: 'req_video_1' }, fakeExec()),
    ).rejects.toMatchObject({ message: expect.stringContaining('disabled') as string })
    expect(edit).not.toHaveBeenCalled()
    expect(resolveCodexImageRoute).not.toHaveBeenCalled()
    expect(imagine.videoStatus).not.toHaveBeenCalled()
  })

  it('clamps an imageCount outside the schema bounds to the schema default', async () => {
    const generate = vi.fn<CodexImageController['generate']>(async () => ({
      operation: 'generate',
      model: CODEX_IMAGE_MODEL,
      images: [imageRef('generated')],
      references: [],
      warnings: [],
    }))
    const tools = await createCapabilityTools({
      current: () => enabledSettings({ imageCount: 0 }),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      createCodexController: () => fakeCodexController({ generate }),
    })
    await toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute({ prompt: 'cube' }, fakeExec())
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ n: CAPABILITY_SETTINGS_BOUNDS.imageCount.default }),
      expect.any(AbortSignal),
    )
  })

  it('forwards every optional Codex generate parameter and renders the saved paths', async () => {
    const generate = vi.fn<CodexImageController['generate']>(async () => ({
      operation: 'generate',
      model: CODEX_IMAGE_MODEL,
      images: [imageRef('generated')],
      references: [],
      warnings: [],
    }))
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      createCodexController: () => fakeCodexController({ generate }),
      saveToWorkspace: async () => 'images/generated.png',
    })
    const tool = toolByName(tools, CODEX_IMAGE_GENERATE_TOOL)
    const args = { prompt: 'cube', size: '1024x1024', quality: 'high', background: 'opaque' } as const
    const value = (await tool.execute({ ...args }, fakeExec())) as {
      workspacePaths?: string[]
      images: ImageAttachmentRef[]
    }
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'cube', size: '1024x1024', quality: 'high', background: 'opaque' }),
      expect.any(AbortSignal),
    )
    expect(value.workspacePaths).toEqual(['images/generated.png'])
    expect(tool.output.render({ ...args }, value as never)).toEqual([
      {
        type: 'text',
        text: `Generated 1 Codex image(s) with ${CODEX_IMAGE_MODEL}, saved to images/generated.png.`,
      },
      { type: 'image', attachment: expect.objectContaining({ attachmentId: 'generated' }) as ImageAttachmentRef },
    ])
  })

  it('forwards every optional Codex edit parameter and renders saved and unsaved results', async () => {
    const edit = vi.fn<CodexImageController['edit']>(async () => ({
      operation: 'edit',
      model: CODEX_IMAGE_MODEL,
      images: [imageRef('edited')],
      references: [imageRef('owned')],
      warnings: [],
    }))
    const saveToWorkspace = vi.fn<SaveArtifactToWorkspace>(async () => 'images/edited.png')
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      createCodexController: () => fakeCodexController({ edit }),
      saveToWorkspace,
    })
    const tool = toolByName(tools, CODEX_IMAGE_EDIT_TOOL)
    const exec = fakeExec({
      agent: fakeAgent({
        options: { provider: 'codex-oauth', model: 'gpt-5.4' },
        deriveMessages: () => [],
      }),
    })
    const args = {
      prompt: 'brighter',
      imageIds: ['owned'],
      size: '1024x1536',
      quality: 'medium',
      background: 'transparent',
    } as const
    const saved = (await tool.execute({ ...args }, exec)) as { workspacePaths?: string[] }
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({
        imageIds: ['owned'],
        size: '1024x1536',
        quality: 'medium',
        background: 'transparent',
      }),
      expect.any(AbortSignal),
    )
    expect(tool.output.render({ ...args }, saved as never)[0]).toEqual({
      type: 'text',
      text: `Edited 1 Codex image(s) with ${CODEX_IMAGE_MODEL}, saved to images/edited.png.`,
    })

    saveToWorkspace.mockResolvedValue(undefined)
    const unsaved = (await tool.execute({ prompt: 'brighter', imageIds: ['owned'] }, exec)) as {
      workspacePaths?: string[]
    }
    expect(unsaved.workspacePaths).toBeUndefined()
    expect(tool.output.render({ prompt: 'brighter', imageIds: ['owned'] }, unsaved as never)).toEqual([
      { type: 'text', text: `Edited 1 Codex image(s) with ${CODEX_IMAGE_MODEL}.` },
      { type: 'image', attachment: expect.objectContaining({ attachmentId: 'edited' }) as ImageAttachmentRef },
    ])
  })

  it('forwards the Imagine image options and renders the saved paths', async () => {
    const generateImage = vi.fn(async () => leakyImagineImage())
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine({ generateImage }),
      saveToWorkspace: async () => 'images/img_local.png',
    })
    const tool = toolByName(tools, GROK_IMAGINE_IMAGE_TOOL)
    const args = { prompt: 'orbit', aspectRatio: '16:9', resolution: '2k' } as const
    const value = (await tool.execute({ ...args }, fakeExec())) as { workspacePaths?: string[] }
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'orbit', aspectRatio: '16:9', resolution: '2k' }),
      expect.any(AbortSignal),
    )
    expect(value.workspacePaths).toEqual(['images/img_local.png'])
    expect(tool.output.render({ ...args }, value as never)[0]).toEqual({
      type: 'text',
      text: 'Generated 1 Imagine image(s), saved to images/img_local.png.',
    })
  })

  it('forwards the Imagine video options and renders the started job', async () => {
    const startVideo = vi.fn(async () => leakyVideoStart())
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine({ startVideo }),
    })
    const tool = toolByName(tools, GROK_IMAGINE_VIDEO_TOOL)
    const args = { prompt: 'orbit', duration: 5, aspectRatio: '16:9', resolution: '720p' } as const
    const value = await tool.execute({ ...args }, fakeExec())
    expect(startVideo).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'orbit', duration: 5, aspectRatio: '16:9', resolution: '720p' }),
      expect.any(AbortSignal),
    )
    expect(tool.output.render({ ...args }, value as never)).toEqual([
      { type: 'text', text: 'Imagine video job req_video_1 is pending.' },
    ])
  })

  it('returns a job with no artifact yet without touching the workspace', async () => {
    const saveToWorkspace = vi.fn(async () => 'videos/never.mp4')
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine({
        videoStatus: vi.fn(async () => ({ requestId: 'req_video_2', status: 'pending' as const })),
      }),
      saveToWorkspace,
    })
    const tool = toolByName(tools, GROK_IMAGINE_VIDEO_STATUS_TOOL)
    const status = (await tool.execute({ requestId: 'req_video_2' }, fakeExec())) as {
      requestId: string
      status: string
      artifact?: unknown
      path?: string
    }
    expect(status).toEqual({ requestId: 'req_video_2', status: 'pending' })
    expect(saveToWorkspace).not.toHaveBeenCalled()
    expect(tool.output.render({ requestId: 'req_video_2' }, status as never)).toEqual([
      { type: 'text', text: 'Imagine video req_video_2 is pending.' },
    ])
  })

  it('reports a failed job error without inventing an artifact', async () => {
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine({
        videoStatus: vi.fn(async () => ({
          requestId: 'req_video_3',
          status: 'failed' as const,
          error: 'video did not respect moderation rules',
        })),
      }),
    })
    const status = (await toolByName(tools, GROK_IMAGINE_VIDEO_STATUS_TOOL).execute(
      { requestId: 'req_video_3' },
      fakeExec(),
    )) as { requestId: string; status: string; error?: string; artifact?: unknown }
    expect(status).toEqual({
      requestId: 'req_video_3',
      status: 'failed',
      error: 'video did not respect moderation rules',
    })
  })

  it('keeps the artifact name a completed job reported', async () => {
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine({
        videoStatus: vi.fn(async () => ({
          requestId: 'req_video_1',
          status: 'completed' as const,
          artifact: {
            artifactId: ARTIFACT_ID,
            mediaType: 'video/mp4' as const,
            bytes: 64,
            createdAt: 1,
            expiresAt: 2,
            name: 'clip.mp4',
          },
          path: imagineMediaPath(ARTIFACT_ID),
        })),
      }),
    })
    const status = (await toolByName(tools, GROK_IMAGINE_VIDEO_STATUS_TOOL).execute(
      { requestId: 'req_video_1' },
      fakeExec(),
    )) as { artifact?: { name?: string } }
    expect(status.artifact?.name).toBe('clip.mp4')
  })

  it('passes Codex warnings through with their index, code, and message', async () => {
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      createCodexController: () =>
        fakeCodexController({
          generate: vi.fn<CodexImageController['generate']>(async () => ({
            operation: 'generate',
            model: CODEX_IMAGE_MODEL,
            images: [imageRef('generated')],
            references: [],
            warnings: [{ index: 1, code: 'IMAGE_DATA_MISSING', message: 'Only b64_json image items are accepted.' }],
          })),
        }),
    })
    const value = (await toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute(
      { prompt: 'cube' },
      fakeExec(),
    )) as { warnings: Array<{ index: number; code: string; message: string }> }
    expect(value.warnings).toEqual([
      { index: 1, code: 'IMAGE_DATA_MISSING', message: 'Only b64_json image items are accepted.' },
    ])
  })

  it('falls back to the result attachment when Imagine returns no images', async () => {
    const single = imagineRef('img_single')
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine({
        generateImage: vi.fn(async () => ({
          model: GROK_IMAGINE_IMAGE_MODEL,
          images: [],
          attachment: single,
          path: `/plugins/dsh-grok-build/imagine/images/${single.attachmentId}`,
        })),
      }),
    })
    const tool = toolByName(tools, GROK_IMAGINE_IMAGE_TOOL)
    const value = (await tool.execute({ prompt: 'orbit' }, fakeExec())) as {
      images: ImageAttachmentRef[]
      attachment: ImageAttachmentRef
      path: string
    }
    expect(value.images).toEqual([])
    expect(value.attachment.attachmentId).toBe(single.attachmentId)
    expect(value.path).toBe(`/plugins/dsh-grok-build/imagine/images/${single.attachmentId}`)
    expect(tool.output.render({ prompt: 'orbit' }, value as never)).toEqual([
      { type: 'text', text: 'Generated 0 Imagine image(s).' },
    ])
  })

  it('omits the name of an attachment that has none', async () => {
    const nameless: ImagineImageAttachmentRef = {
      attachmentId: 'img_nameless',
      mediaType: 'image/png',
      bytes: 32,
      width: 1,
      height: 1,
    }
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine({
        generateImage: vi.fn(async () => ({
          model: GROK_IMAGINE_IMAGE_MODEL,
          images: [{ attachment: nameless, path: `/plugins/dsh-grok-build/imagine/images/${nameless.attachmentId}` }],
          attachment: nameless,
          path: `/plugins/dsh-grok-build/imagine/images/${nameless.attachmentId}`,
        })),
      }),
    })
    const value = (await toolByName(tools, GROK_IMAGINE_IMAGE_TOOL).execute({ prompt: 'orbit' }, fakeExec())) as {
      images: Array<{ attachment: ImageAttachmentRef }>
      attachment: ImageAttachmentRef
    }
    expect(value.images[0]?.attachment).toEqual({ ...nameless })
    expect(Object.hasOwn(value.images[0]?.attachment ?? {}, 'name')).toBe(false)
    expect(Object.hasOwn(value.attachment, 'name')).toBe(false)
  })

  it('recomputes a plugin path that does not sit under the Imagine prefix', async () => {
    const escaped = imagineRef('img_escaped')
    const expected = `/plugins/dsh-grok-build/imagine/images/${escaped.attachmentId}`
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine({
        generateImage: vi.fn(async () => ({
          model: GROK_IMAGINE_IMAGE_MODEL,
          images: [{ attachment: escaped, path: '/etc/passwd' }],
          attachment: escaped,
          path: 'https://imgen.x.ai/signed?token=abc',
        })),
      }),
    })
    const value = (await toolByName(tools, GROK_IMAGINE_IMAGE_TOOL).execute(
      { prompt: 'orbit' },
      fakeExec(),
    )) as { images: Array<{ path: string }>; path: string }
    expect(value.images[0]?.path).toBe(expected)
    expect(value.path).toBe(expected)
    expect(JSON.stringify(value)).not.toContain('passwd')
    expect(JSON.stringify(value)).not.toContain('imgen.x.ai')
  })
})

describe('Codex image route resolution', () => {
  it('prefers requestHeader.config over agent.options and falls back when the header is absent', () => {
    expect(
      callingRouteIdentity(
        fakeExec({
          agent: fakeAgent({
            options: { provider: 'codex-oauth', model: 'gpt-5.4' },
            header: { provider: 'codex-oauth', model: 'gpt-5.3-codex-spark' },
          }),
        }),
      ),
    ).toEqual({ provider: 'codex-oauth', model: 'gpt-5.3-codex-spark' })
    expect(
      callingRouteIdentity(
        fakeExec({
          agent: fakeAgent({ options: { provider: 'codex-oauth-fast', model: 'gpt-5.4' } }),
        }),
      ),
    ).toEqual({ provider: 'codex-oauth-fast', model: 'gpt-5.4' })
    expect(callingRouteIdentity(fakeExec())).toBeUndefined()
    expect(
      callingRouteIdentity(fakeExec({ agent: fakeAgent({ options: { provider: 'codex-oauth' } }) })),
    ).toBeUndefined()
  })

  it('copies authoritative modalities and omits them when lookup fails', async () => {
    const exec = fakeExec({
      agent: fakeAgent({ options: { provider: 'codex-oauth', model: 'gpt-5.4' } }),
    })
    const resolveModelInfo = vi.fn(async () => ({ inputModalities: ['text', 'image'] as const }))
    await expect(resolveCodexImageRouteFromLlm(exec, resolveModelInfo)).resolves.toEqual({
      provider: 'codex-oauth',
      model: 'gpt-5.4',
      inputModalities: ['text', 'image'],
    })
    expect(resolveModelInfo).toHaveBeenCalledWith('codex-oauth', 'gpt-5.4', exec.signal)

    await expect(
      resolveCodexImageRouteFromLlm(exec, async () => {
        throw new Error('UNKNOWN_MODEL')
      }),
    ).resolves.toEqual({ provider: 'codex-oauth', model: 'gpt-5.4' })
    await expect(resolveCodexImageRouteFromLlm(exec, async () => ({}))).resolves.toEqual({
      provider: 'codex-oauth',
      model: 'gpt-5.4',
    })
    await expect(resolveCodexImageRouteFromLlm(fakeExec(), resolveModelInfo)).resolves.toBeUndefined()
  })

  it('fails the real controller closed without a resolver, identity, or image modality', async () => {
    const attachments = fakeAttachments()
    // The route gate only narrows under the explicit any-model opt-out; the
    // resolved settings pin it open, so this case states the narrow policy.
    const narrow = () => enabledSettings({ codexImagesAnyModel: false })
    const tools = await createCapabilityTools({
      current: narrow,
      auth: fakeAuth(),
      attachments,
      imagine: fakeImagine(),
    })
    const generate = toolByName(tools, CODEX_IMAGE_GENERATE_TOOL)
    await expect(generate.execute({ prompt: 'cube' }, fakeExec())).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    })

    const resolveModelInfo = vi.fn(async (provider: string, model: string) => {
      if (model === 'gpt-5.3-codex-spark') return { inputModalities: ['text'] as const }
      if (provider === 'grok-build') return { inputModalities: ['text', 'image'] as const }
      throw new Error('UNKNOWN_MODEL')
    })
    const gated = await createCapabilityTools({
      current: narrow,
      auth: fakeAuth(),
      attachments,
      imagine: fakeImagine(),
      resolveCodexImageRoute: exec => resolveCodexImageRouteFromLlm(exec, resolveModelInfo),
    })
    const gatedGenerate = toolByName(gated, CODEX_IMAGE_GENERATE_TOOL)
    await expect(
      gatedGenerate.execute(
        { prompt: 'cube' },
        fakeExec({
          agent: fakeAgent({
            options: { provider: 'codex-oauth', model: 'gpt-5.4' },
            header: { provider: 'codex-oauth', model: 'gpt-5.3-codex-spark' },
          }),
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(resolveModelInfo).toHaveBeenCalledWith('codex-oauth', 'gpt-5.3-codex-spark', expect.any(AbortSignal))
    await expect(
      gatedGenerate.execute(
        { prompt: 'cube' },
        fakeExec({ agent: fakeAgent({ options: { provider: 'grok-build', model: 'grok-4.6' } }) }),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    await expect(
      gatedGenerate.execute(
        { prompt: 'cube' },
        fakeExec({ agent: fakeAgent({ options: { provider: 'codex-oauth', model: 'missing' } }) }),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(attachments.saveImage).not.toHaveBeenCalled()
  })

  it('passes the live any-model policy per execution and restores the strict gate immediately', async () => {
    let current = enabledSettings({ codexImagesAnyModel: true })
    const generate = vi.fn<CodexImageController['generate']>(async () => ({
      operation: 'generate',
      model: CODEX_IMAGE_MODEL,
      images: [imageRef('generated')],
      references: [],
      warnings: [],
    }))
    const tools = await createCapabilityTools({
      current: () => current,
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      createCodexController: (session, policy) => {
        if (policy !== 'any') assertCodexImageCapableRoute(session.route)
        return fakeCodexController({ generate })
      },
      resolveCodexImageRoute: async () => ({
        provider: 'deepseek',
        model: 'deepseek-v4',
        inputModalities: ['text'],
      }),
    })
    const tool = toolByName(tools, CODEX_IMAGE_GENERATE_TOOL)
    await tool.execute({ prompt: 'allowed' }, fakeExec())
    expect(generate).toHaveBeenCalledOnce()
    current = enabledSettings({ codexImagesAnyModel: false })
    await expect(tool.execute({ prompt: 'strict' }, fakeExec())).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    })
    expect(generate).toHaveBeenCalledOnce()
  })

  it('forwards the resolved route without inventing modalities and keeps edit ownership', async () => {
    const sessions: CodexImageSessionContext[] = []
    const deriveMessages = vi.fn(() => [
      {
        content: [
          { type: 'image', attachment: imageRef('owned') },
          { type: 'tool-result', content: [{ type: 'image', attachment: imageRef('nested') }] },
        ],
      },
    ])
    const generate = vi.fn<CodexImageController['generate']>(async () => ({
      operation: 'generate',
      model: CODEX_IMAGE_MODEL,
      images: [imageRef('generated')],
      references: [],
      warnings: [],
    }))
    const edit = vi.fn<CodexImageController['edit']>(async () => ({
      operation: 'edit',
      model: CODEX_IMAGE_MODEL,
      images: [imageRef('edited')],
      references: [imageRef('owned')],
      warnings: [],
    }))
    const resolveModelInfo = vi.fn(async () => ({ inputModalities: ['image'] as const }))
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      createCodexController: (session) => {
        sessions.push(session)
        return fakeCodexController({ generate, edit })
      },
      resolveCodexImageRoute: exec => resolveCodexImageRouteFromLlm(exec, resolveModelInfo),
    })
    const signal = new AbortController().signal
    await toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute(
      { prompt: 'cube' },
      fakeExec({
        signal,
        agent: fakeAgent({
          options: { provider: 'codex-oauth', model: 'gpt-5.4' },
          header: { provider: 'openai-codex', model: 'gpt-5.5' },
        }),
      }),
    )
    expect(sessions[0]?.deriveMessages()).toEqual([])
    expect(sessions[0]?.route).toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.5',
      inputModalities: ['image'],
    })
    expect(resolveModelInfo).toHaveBeenCalledWith('openai-codex', 'gpt-5.5', signal)

    await toolByName(tools, CODEX_IMAGE_EDIT_TOOL).execute(
      { prompt: 'blue', imageIds: ['owned'] },
      fakeExec({
        agent: fakeAgent({
          options: { provider: 'codex-oauth-fast', model: 'gpt-5.4' },
          deriveMessages,
        }),
      }),
    )
    expect(sessions[1]?.deriveMessages()).toEqual(deriveMessages.mock.results[0]?.value)
    expect(sessions[1]?.route).toEqual({
      provider: 'codex-oauth-fast',
      model: 'gpt-5.4',
      inputModalities: ['image'],
    })
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ imageIds: ['owned'] }), expect.any(AbortSignal))
  })

  it('omits a route identity the resolver could not name', async () => {
    const sessions: CodexImageSessionContext[] = []
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      createCodexController: (session) => {
        sessions.push(session)
        return fakeCodexController()
      },
      resolveCodexImageRoute: async () => ({ provider: '', model: '', inputModalities: ['text'] }),
    })
    await toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute({ prompt: 'cube' }, fakeExec())
    expect(sessions[0]?.route).toEqual({ inputModalities: ['text'] })
  })

  it('runs a Codex image call without a route when the resolver declines or fails', async () => {
    const sessions: CodexImageSessionContext[] = []
    let mode: 'decline' | 'throw' = 'decline'
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      createCodexController: (session) => {
        sessions.push(session)
        return fakeCodexController()
      },
      resolveCodexImageRoute: async () => {
        if (mode === 'throw') throw new Error('route lookup failed')
        return undefined
      },
    })
    const tool = toolByName(tools, CODEX_IMAGE_GENERATE_TOOL)
    await tool.execute({ prompt: 'cube' }, fakeExec())
    expect(sessions[0]?.route).toBeUndefined()

    mode = 'throw'
    await tool.execute({ prompt: 'cube' }, fakeExec())
    expect(sessions[1]?.route).toBeUndefined()
    expect(sessions).toHaveLength(2)
  })
})

describe('Imagine tool signal threading', () => {
  it('forwards exec.signal into every Imagine client method', async () => {
    const captured: Array<AbortSignal | undefined> = []
    const fakeImagineClient: CapabilityImagineClient = {
      generateImage: vi.fn(async (_input: GenerateImagineImageInput, signal?: AbortSignal) => {
        captured.push(signal)
        return leakyImagineImage()
      }),
      startVideo: vi.fn(async (_input: StartImagineVideoInput, signal?: AbortSignal) => {
        captured.push(signal)
        return leakyVideoStart()
      }),
      videoStatus: vi.fn(async (_requestId: string, options?: { name?: string; signal?: AbortSignal }) => {
        captured.push(options?.signal)
        return leakyVideoStatus()
      }),
    }
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagineClient,
    })
    const controller = new AbortController()
    const exec = {
      ...fakeExec({ signal: controller.signal }),
    }
    await toolByName(tools, 'grok_imagine_image').execute({ prompt: 'x' }, exec)
    await toolByName(tools, 'grok_imagine_video').execute({ prompt: 'x' }, exec)
    await toolByName(tools, 'grok_imagine_video_status').execute({ requestId: 'req_video_1' }, exec)
    expect(captured).toHaveLength(3)
    expect(captured.every(s => s === controller.signal)).toBe(true)
  })

  it('rejects video status before the client sees a non-conforming requestId', async () => {
    const imagineVideoStatus = vi.fn(async () => leakyVideoStatus())
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine({ videoStatus: imagineVideoStatus }),
    })
    await expect(
      toolByName(tools, 'grok_imagine_video_status').execute({ requestId: '../escape' }, fakeExec()),
    ).rejects.toMatchObject({ message: expect.stringMatching(/safe ASCII identifier/) as string })
    expect(imagineVideoStatus).not.toHaveBeenCalled()
  })
})

describe('workspace copies', () => {
  it('reports the workspace paths written for generated images', async () => {
    const saveToWorkspace = vi.fn(async () => 'images/img_local.png')
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      saveToWorkspace,
    })
    const result = (await toolByName(tools, GROK_IMAGINE_IMAGE_TOOL).execute({ prompt: 'orbit' }, fakeExec())) as {
      workspacePaths?: string[]
    }
    expect(result.workspacePaths).toEqual(['images/img_local.png'])
    expect(saveToWorkspace).toHaveBeenCalledWith(expect.anything(), {
      kind: 'image',
      attachment: expect.objectContaining({ attachmentId: 'img_local' }) as ImageAttachmentRef,
    })
  })

  it('reports the workspace paths written for Codex generate and edit', async () => {
    const saveToWorkspace = vi.fn<SaveArtifactToWorkspace>(async () => 'images/generated.png')
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      createCodexController: () => fakeCodexController(),
      saveToWorkspace,
    })
    const generated = (await toolByName(tools, CODEX_IMAGE_GENERATE_TOOL).execute({ prompt: 'cube' }, fakeExec())) as {
      workspacePaths?: string[]
    }
    expect(generated.workspacePaths).toEqual(['images/generated.png'])

    const edited = (await toolByName(tools, CODEX_IMAGE_EDIT_TOOL).execute(
      { prompt: 'brighter', imageIds: ['generated'] },
      fakeExec({
        agent: fakeAgent({
          options: { provider: 'codex-oauth', model: 'gpt-5.5' },
          deriveMessages: () => [],
        }),
      }),
    )) as { workspacePaths?: string[] }
    expect(edited.workspacePaths).toEqual(['images/generated.png'])
    // Reference images are session inputs, not new output: only `images` is copied.
    for (const call of saveToWorkspace.mock.calls) {
      expect(call[1]).toMatchObject({ kind: 'image' })
    }
  })

  it('reports the workspace path written for a completed video', async () => {
    const saveToWorkspace = vi.fn(async () => 'videos/art_1.mp4')
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      saveToWorkspace,
    })
    const result = (await toolByName(tools, 'grok_imagine_video_status').execute(
      { requestId: 'req_video_1' },
      fakeExec(),
    )) as { workspacePath?: string }
    expect(result.workspacePath).toBe('videos/art_1.mp4')
  })

  it('keeps the generated media when the workspace copy fails or is unavailable', async () => {
    const failing = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      saveToWorkspace: async () => {
        throw new Error('read-only workspace')
      },
    })
    const result = (await toolByName(failing, GROK_IMAGINE_IMAGE_TOOL).execute({ prompt: 'orbit' }, fakeExec())) as {
      workspacePaths?: string[]
      path: string
    }
    expect(result.workspacePaths).toBeUndefined()
    expect(result.path).toContain('/plugins/dsh-grok-build/imagine/images/')

    const unmounted = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
    })
    const withoutWorkspace = (await toolByName(unmounted, GROK_IMAGINE_IMAGE_TOOL).execute(
      { prompt: 'orbit' },
      fakeExec(),
    )) as { workspacePaths?: string[] }
    expect(withoutWorkspace.workspacePaths).toBeUndefined()
  })

  it('records no workspace path when the deployment skips the copy', async () => {
    const saveToWorkspace = vi.fn(async () => undefined)
    const tools = await createCapabilityTools({
      current: () => enabledSettings(),
      auth: fakeAuth(),
      attachments: fakeAttachments(),
      imagine: fakeImagine(),
      saveToWorkspace,
    })
    const result = (await toolByName(tools, GROK_IMAGINE_IMAGE_TOOL).execute({ prompt: 'orbit' }, fakeExec())) as {
      workspacePaths?: string[]
    }
    expect(saveToWorkspace).toHaveBeenCalledTimes(1)
    expect(result.workspacePaths).toBeUndefined()
  })
})

describe('runtime capability bounds', () => {
  it('pins the prompt-length and imageIds limits enforced before upstream calls', () => {
    // The host value-schema DSL does not support length constraints, so the
    // client/runtime validators are authoritative and these constants keep
    // their documented limits from drifting accidentally.
    expect(IMAGINE_PROMPT_MAX_LENGTH).toBe(4000)
    expect(IMAGINE_IMAGE_IDS_MIN).toBe(1)
    expect(IMAGINE_IMAGE_IDS_MAX).toBe(5)
  })
})
