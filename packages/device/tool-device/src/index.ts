/**
 * Model-facing `device_*` tools, ported from t3code's device toolkit: list the
 * simulators and emulators, open one where the user watches it in the right
 * sidebar, see its screen, and close it.
 *
 * The surface is deliberately small. Driving a device (taps, typing,
 * installs, logs) goes through the agent-device CLI that `device_open`
 * returns, which carries the accessibility-snapshot model an agent needs and
 * keeps pace with its own releases; wrapping its commands here would lag it.
 *
 * @module @aeven/tool-device
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore, ImageAttachmentRef } from '@aeven/attachment'
import type {} from '@aeven/attachment'
import {
  LOCAL_DEVICE_HOST_ID, type DeviceHostId, type DeviceId, type DevicePlatform, type DeviceService, type DeviceSummary,
} from '@aeven/device'
import type {} from '@aeven/device'
import type {} from '@aeven/llm'
import { HarnessError } from '@aeven/llm'
import { defineTool, type ToolRunContext } from '@aeven/tools'
import type { JsonValue } from '@aeven/util-values'

export const name = 'tool-device'
export const inject = ['tools']

const hostId = { type: 'string', description: 'Device host from device_list. Defaults to this machine.' } as const
const text = { render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] }

/**
 * Just-in-time guidance returned from `device_open`: the one place the model
 * learns how to drive the device, so sessions that never open one never pay
 * for it.
 * @param device - the opened device.
 * @param command - the agent-device launcher.
 * @param args - flags every command carries.
 * @returns the instructions.
 */
export function agentDeviceQuickStart(device: DeviceSummary, command: string, args: readonly string[]): string {
  const quote = (value: string) => /^[\w./:-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`
  const executable = quote(command)
  const target = args.map(quote).join(' ')
  return [
    `The user is watching ${device.name} (${device.version}) in the device pane beside this chat.`,
    `Drive it with ${executable}. Use this exact executable path; login shells may reset PATH. Always pass ${target}.`,
    'Typical loop:',
    `  ${executable} open <bundle-or-package-id> ${target}     # or: open <app> <deep-link-url>`,
    `  ${executable} snapshot -i ${target}                     # accessibility tree with @eN refs`,
    `  ${executable} click @e3 ${target}`,
    `  ${executable} fill @e5 "text" ${target}`,
    `  ${executable} install <app> <path-to-.app-or-.apk> ${target}`,
    `Prefer snapshot refs over coordinates. Call device_screenshot to see the screen. Run ${executable} help for workflow guides and ${executable} <command> --help for flags.`,
    'Do not call simctl, adb, xcrun, or serve-sim directly while these tools are attached; use agent-device.',
    'Keep the --config and --session flags on every command so concurrent devices stay independent.',
    device.platform === 'ios'
      ? 'First use builds an XCTest runner and can take a couple of minutes; later commands are fast.'
      : 'The Android snapshot helper installs itself on first use.',
  ].join('\n')
}

/**
 * Width and height from a PNG's IHDR chunk.
 * @param png - the image bytes.
 * @returns its dimensions, 0×0 when the bytes are not a PNG.
 */
export function pngDimensions(png: Uint8Array): { width: number; height: number } {
  if (png.length < 24) return { width: 0, height: 0 }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const isPng = view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452
  return isPng ? { width: view.getUint32(16), height: view.getUint32(20) } : { width: 0, height: 0 }
}

/**
 * Register the device tools.
 * @param ctx - plugin context carrying the tool registry.
 */
export function apply(ctx: Context): void {
  const devices = (): DeviceService => {
    const service = ctx.get('devices')
    if (service === undefined) throw new HarnessError('Device support is not installed in this deployment.', 'DEVICE_UNAVAILABLE')
    return service
  }
  const sessionOf = (exec: ToolRunContext) => {
    if (exec.agent === undefined) throw new HarnessError('device tools need a calling agent', 'DEVICE_NO_AGENT')
    return exec.agent.id
  }
  const requireAccess = (service: DeviceService): void => {
    const state = service.snapshot()
    if (state.status === 'disabled') {
      throw new HarnessError('Device support is off. Ask the user to enable it in the device pane of the right sidebar.', 'DEVICE_DISABLED')
    }
    if (!state.agentAccessEnabled) {
      throw new HarnessError('The user has not allowed the model to control devices. Ask them to allow agent access in the device pane.', 'DEVICE_NO_ACCESS')
    }
  }
  const pick = (all: readonly DeviceSummary[], input: { deviceId?: string; platform?: DevicePlatform; hostId?: string }): DeviceSummary => {
    const host = (input.hostId ?? LOCAL_DEVICE_HOST_ID) as DeviceHostId
    if (input.deviceId !== undefined) {
      const match = all.find(device => device.hostId === host && device.id === input.deviceId)
      if (match === undefined) throw new HarnessError(`No device ${input.deviceId} on host ${host}. Call device_list for current ids.`, 'DEVICE_NOT_FOUND')
      return match
    }
    const candidates = all.filter(device => device.hostId === host && (input.platform === undefined || device.platform === input.platform))
    if (candidates.length === 0) {
      throw new HarnessError(input.platform === undefined
        ? 'No simulators or emulators were found. Call device_list to see why.'
        : `No ${input.platform} devices were found on host ${host}. Call device_list to see why.`, 'DEVICE_NOT_FOUND')
    }
    if (input.platform === undefined && new Set(candidates.map(device => device.platform)).size > 1) {
      throw new HarnessError('Both iOS and Android devices are available; pass platform or deviceId.', 'DEVICE_AMBIGUOUS')
    }
    return candidates.find(device => device.booted) ?? candidates[0] as DeviceSummary
  }

  /**
   * The attachment store, when the session's model can read images.
   * @returns the store, or the reason an image cannot be attached.
   */
  const imageStore = async (exec: ToolRunContext): Promise<AttachmentStore | string> => {
    const attachments = ctx.get('attachments')
    const llm = ctx.get('llm')
    const routed = exec.agent?.session.requestHeader()?.config
    const provider = routed?.provider ?? exec.agent?.options.provider
    const model = routed?.model ?? exec.agent?.options.model
    if (attachments === undefined || llm === undefined || provider === undefined || model === undefined) return 'no image store is available'
    const info = await llm.resolveModelInfo(provider, model, exec.signal).catch(() => undefined)
    if (info?.inputModalities?.includes('image') !== true) return `model "${model}" does not accept images`
    return attachments
  }

  const tools = [
    defineTool({
      name: 'device_list',
      description: 'List iOS Simulators and Android Emulators on the device hosts, which platforms each host can run, and which devices are already open beside this session. Call this before device_open when you do not know a device id.',
      parameters: { hostId: { ...hostId, description: 'Limit to one device host. Defaults to all hosts.' } },
      output: { schema: { type: 'string' }, ...text },
      async execute(args, exec) {
        const service = devices()
        requireAccess(service)
        const sessionId = sessionOf(exec)
        const state = await service.list()
        const only = args.hostId
        return JSON.stringify({
          hosts: state.hosts.filter(host => only === undefined || host.id === only).map(host => ({
            id: host.id, label: host.label, platforms: host.platforms, state: state.hostStates[host.id],
          })),
          devices: state.devices.filter(device => only === undefined || device.hostId === only),
          open: service.sessionsFor(sessionId).map(session => ({ hostId: session.hostId, deviceId: session.deviceId })),
        })
      },
    }),
    defineTool({
      name: 'device_open',
      description: "Open a simulator or emulator for this session: boots it if needed, starts its live stream, and shows it in the user's device pane so they can watch. Returns the agent-device command pinned to the device; drive the device with it afterwards.",
      parameters: {
        deviceId: { type: 'string', description: 'Simulator udid or emulator serial from device_list. Omit to use the booted device for the platform, or the first one.' },
        platform: { type: 'string', enum: ['ios', 'android'], description: 'Required when deviceId is omitted and both platforms are available.' },
        hostId,
      },
      output: { schema: { type: 'string' }, ...text },
      async execute(args, exec) {
        const service = devices()
        requireAccess(service)
        const sessionId = sessionOf(exec)
        const state = await service.list()
        const target = pick(state.devices, args as { deviceId?: string; platform?: DevicePlatform; hostId?: string })
        // Consent and the agent daemon resolve before anything boots or a session is recorded.
        await service.agentTarget(sessionId, target)
        const session = await service.open(sessionId, { hostId: target.hostId, deviceId: target.id, platform: target.platform })
        const device = service.snapshot().devices.find(candidate => candidate.hostId === session.hostId && candidate.id === session.deviceId) ?? target
        // A booted AVD has a new id (its emulator serial), so the flags are resolved for the opened device.
        const agent = await service.agentTarget(sessionId, device)
        return JSON.stringify({
          device,
          agentDevice: { command: agent.command, args: agent.args },
          quickStart: agentDeviceQuickStart(device, agent.command, agent.args),
        })
      },
    }),
    defineTool({
      name: 'device_screenshot',
      description: 'Capture the current screen of a device open beside this session. Use it to see what the user sees; for taps and text use the agent-device command from device_open.',
      parameters: {
        deviceId: { type: 'string', description: 'Device from device_list. Omit to use the device most recently opened in this session.' },
        hostId,
      },
      output: {
        schema: { type: 'json' },
        render: (_args: unknown, value: JsonValue) => {
          const result = value as { summary: string; image: ImageAttachmentRef | null }
          return result.image === null
            ? [{ type: 'text' as const, text: result.summary }]
            : [{ type: 'text' as const, text: result.summary }, { type: 'image' as const, attachment: result.image }]
        },
      },
      async execute(args, exec) {
        const service = devices()
        requireAccess(service)
        const sessionId = sessionOf(exec)
        const target = args.deviceId !== undefined
          ? { hostId: (args.hostId ?? LOCAL_DEVICE_HOST_ID) as DeviceHostId, deviceId: args.deviceId as DeviceId }
          : service.sessionsFor(sessionId).filter(session => args.hostId === undefined || session.hostId === args.hostId).at(-1)
        if (target === undefined) throw new HarnessError('No device is open in this session. Call device_open first.', 'DEVICE_NOT_OPEN')
        const shot = await service.screenshot({ hostId: target.hostId, deviceId: target.deviceId })
        const { width, height } = pngDimensions(shot.png)
        const summary = `${shot.device.name} (${shot.device.version}), ${String(width)}×${String(height)}`
        const store = await imageStore(exec)
        if (typeof store !== 'string') {
          const image = await store.saveImage({ data: shot.png, mediaType: 'image/png', name: `${shot.device.name}.png` })
          return { summary, image } as unknown as JsonValue
        }
        // A model that cannot read images still gets the capture, as a file it can hand to other tools.
        const dir = join(service.stateDir, 'screenshots')
        await mkdir(dir, { recursive: true })
        const file = join(dir, `${new Date().toISOString().replaceAll(':', '-')}.png`)
        await writeFile(file, shot.png)
        return { summary: `${summary}. The image was not attached (${store}); it is saved at ${file}.`, image: null }
      },
    }),
    defineTool({
      name: 'device_close',
      description: "Remove a device from the device pane beside this session. Pass shutdown=true to also power the simulator or emulator off.",
      parameters: {
        deviceId: { type: 'string', description: 'Device to close. Omit to close every device open in this session.' },
        hostId,
        shutdown: { type: 'boolean', description: 'Also power the simulator or emulator off. Defaults to false.' },
      },
      output: { schema: { type: 'string' }, ...text },
      async execute(args, exec) {
        const service = devices()
        requireAccess(service)
        await service.close(sessionOf(exec), {
          ...args.hostId === undefined ? {} : { hostId: args.hostId as DeviceHostId },
          ...args.deviceId === undefined ? {} : { deviceId: args.deviceId as DeviceId },
          ...args.shutdown === undefined ? {} : { shutdown: args.shutdown },
        })
        return 'Closed.'
      },
    }),
  ]
  for (const tool of tools) ctx.tools.register(tool)
}
