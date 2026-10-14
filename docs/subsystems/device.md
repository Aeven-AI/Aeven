# Devices

English | [中文](device.zh.md)

Service declarations: [source](../../packages/device/device/src/index.ts).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdevices--deviceservice"></a>

### `ctx.devices` — `DeviceService`

Discovery, sessions, consent, and device control over registered hosts.

```ts cordis-catalog
/**
 * Add a host. Its devices appear on the next list.
 * @param host - the host implementation.
 * @returns disposer removing the host, its devices, and its sessions.
 */
registerHost(host: DeviceHost): () => void

/**
 * The current state snapshot.
 * @returns the hosts, their states, the devices, the sessions holding an open device, and the published revision.
 */
snapshot(): DeviceServiceState

/**
 * Follow the state: the current snapshot, then every change. Intermediate
 * states a slow reader missed collapse into the latest.
 * @param signal - stream cancellation.
 * @returns the state stream.
 */
@Remote({ mode: 'stream' }) async *watch(signal: AbortSignal): AsyncIterable<DeviceServiceState>

/**
 * Refresh every host's devices. Starts the hubs only after device support
 * was enabled; reports host failures in the state rather than throwing.
 * @returns the refreshed state.
 */
@Remote async list(): Promise<DeviceServiceState>

/**
 * Retry one failed host, including its agent tools when agent access was granted.
 * @param hostId - the host.
 * @returns the state after the retry.
 */
@Remote async retryHost(hostId: DeviceHostId): Promise<DeviceServiceState>

/**
 * Change the consent switches. Turning support off stops every helper;
 * revoking agent access stops only the agent daemons.
 * @param request - the switches to change.
 * @returns the state after the change and a device refresh.
 */
@Remote async configure(request: DeviceConfigureRequest): Promise<DeviceServiceState>

/**
 * Open a device for a session, booting it unless the request says not to.
 * @param sessionId - the session looking at the device.
 * @param request - the device and whether to boot it.
 * @returns the session's device session.
 */
@Remote async open(sessionId: SessionId, request: DeviceOpenRequest): Promise<DeviceSession>

/**
 * Close a session's device sessions, optionally powering the devices off.
 * @param sessionId - the session.
 * @param request - which device, and whether to shut it down.
 */
@Remote async close(sessionId: SessionId, request: DeviceCloseRequest): Promise<void>

/**
 * Power one device off; its sessions close in every session.
 * @param target - the device.
 * @param platform - the device's platform.
 */
@Remote async shutdown(target: DeviceTarget, platform: DevicePlatform): Promise<void>

/**
 * Read one device's settings and foreground app.
 * @param target - the device.
 * @returns the detail.
 */
@Remote async detail(target: DeviceTarget): Promise<DeviceDetail>

/**
 * Run one action, then read the device back.
 * @param request - the device and the action.
 * @returns the refreshed detail, so the pane shows what the device confirmed.
 */
@Remote async action(request: DeviceActionRequest): Promise<DeviceDetail>

/**
 * Capture a device's screen.
 * @param target - the device.
 * @returns the device and its PNG.
 */
async screenshot(target: DeviceTarget): Promise<DeviceScreenshot>

/**
 * The device sessions one session holds, oldest first.
 * @param sessionId - the session.
 * @returns its device sessions.
 */
sessionsFor(sessionId: SessionId): readonly DeviceSession[]

/**
 * A host's running hub, without starting anything; the hub proxy's lookup.
 * @param hostId - the host; the local host when omitted.
 * @returns the hub's loopback origin, or undefined while it is not running.
 */
hubOrigin(hostId?: string): string | undefined

/**
 * Point the model's agent-device commands at one device: start the host's
 * agent daemon, write its endpoint file, and write the launcher.
 * @param sessionId - the session driving the device.
 * @param device - the device.
 * @returns the launcher and the flags every command carries.
 */
async agentTarget(sessionId: SessionId, device: DeviceSummary): Promise<AgentDeviceTarget>

/**
 * A host's endpoints, installing and starting its hub when needed.
 * @param hostId - the host; the local host when omitted.
 * @returns the ready host.
 */
async readiness(hostId?: DeviceHostId): Promise<DeviceReadiness>

/**
 * {@link readiness} only when the host can run at least one platform; a
 * machine without a simulator toolchain never installs or starts anything.
 * @param hostId - the host.
 * @returns the ready host, or undefined when unsupported or disabled.
 */
async readinessIfSupported(hostId?: DeviceHostId): Promise<DeviceReadiness | undefined>

/**
 * The host with its agent daemon running, once agent access was granted.
 * @param hostId - the host.
 * @returns the agent-ready host, or undefined without consent or a platform.
 */
async agentReadinessIfSupported(hostId?: DeviceHostId): Promise<(DeviceHostAgentReady & { hostId: DeviceHostId }) | undefined>
```

Types: [SessionId](core.md)

Source: [`packages/device/device/src/index.ts`](../../packages/device/device/src/index.ts)
<!-- END GENERATED cordis-surface -->
