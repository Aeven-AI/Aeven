/** Platform-neutral assembly of generated Host Remote contributions. */

import type { Context } from '@deepseek-ai/cordis'
import agentPresetsRemote from '@aeven/agent-presets/remote'
import commandsRemote from '@aeven/commands/remote'
import settingsControllerRemote from '@aeven/api-settings-controller/remote'
import goalsRemote from '@aeven/goal/remote'
import llmRemote from '@aeven/llm/remote'
import dynamicRemote from '@aeven/cordis-host-runner/remote'
import pluginInventoryRemote from '@aeven/host-plugin-inventory/remote'
import messageFeedbackRemote from '@aeven/message-feedback/remote'
import sessionReferencesRemote from '@aeven/session-reference/remote'
import browserChromiumRemote from '@aeven/browser-chromium/remote'
import workspaceFilesRemote from '@aeven/api-workspace-files/remote'
import terminalRemote from '@aeven/api-terminal-controller/remote'
import deviceRemote from '@aeven/device/remote'
import subagentsRemote from '@aeven/subagent/remote'
import sessionRemote from '@aeven/api-session-controller/remote'
import jobRemote from '@aeven/api-job-controller/remote'
import workspaceRemote from '@aeven/api-workspace-controller/remote'
import speechRemote from '@aeven/api-speech-to-text/remote'
import type { ClientRemote } from '@aeven/api-gateway/client'

export type { ClientRemote } from '@aeven/api-gateway/client'
export type { PluginInventorySnapshot } from '@aeven/host-plugin-inventory/types'
export type {} from '@aeven/agent-presets/remote'
export type {} from '@aeven/commands/remote'
export type {} from '@aeven/api-settings-controller/remote'
export type {} from '@aeven/goal/remote'
export type {} from '@aeven/llm/remote'
export type {} from '@aeven/host-plugin-inventory/remote'
export type {} from '@aeven/message-feedback/remote'
export type {} from '@aeven/session-reference/remote'
export type {} from '@aeven/browser-chromium/remote'
export type {} from '@aeven/api-terminal-controller/remote'
export type {} from '@aeven/device/remote'
export type {} from '@aeven/subagent/remote'
export type * from '@aeven/subagent/client'
export type {} from '@aeven/api-session-controller/remote'
export type {} from '@aeven/api-job-controller/remote'
export type * from '@aeven/api-job-controller/types'
export type * from '@aeven/api-session-controller/types'
export type {} from '@aeven/api-workspace-controller/remote'
export type * from '@aeven/api-workspace-controller/types'
export type {} from '@aeven/api-speech-to-text/remote'
export type * from '@aeven/api-speech-to-text/types'
export type { SessionJob as JobView } from '@aeven/api-session-controller/types'
// The forwarded-event allowlist's selection seat: without it in the consumer's
// compilation face `TypertRemoteEvent` is `never` and every `$on` call fails.
export type { ApiRemoteForwardedEvent } from '../types.ts'
// The owner packages' client-safe `./types` exports supply the `Events`
// signatures `$on` hands to a listener, so a consumer reads the very
// declaration the Host emits rather than a flattened restatement of it.
export type {} from '@aeven/commands/types'
export type {} from '@aeven/cordis-host-runner/types'
export type {} from '@aeven/credentials/types'
export type {} from '@aeven/llm/types'
export type {} from '@aeven/agent-presets/types'
export type {} from '@aeven/settings/types'
export type {} from '@aeven/user-approval/types'
export type {} from '@aeven/tool-browser/types'
export type {} from '@aeven/tool-location/types'
export type {} from '@aeven/user-questions/types'
export type {} from '@aeven/api-session-controller/types'

/**
 * The carrier's Client-facing types, re-exported so a business package names one
 * assembly package instead of both this facade and the Connection plugin. Type-only:
 * the carrier's runtime values stay behind their own module edge.
 */
export type {
  ConnectionHandle, ConnectionSinks, ContentBlock,
  MessageId,
  RpcId, RpcRequest, RpcResponse, RpcResult, SessionId,
  StreamChunk,
} from '@aeven/client-connection/client'
export type {} from '@aeven/api-gateway/client'
export type {} from '@aeven/cordis-host-runner/remote'

// The payload vocabulary of the selected namespaces, re-exported so a Client
// contribution can name what it sends and receives without importing a Host
// package: this assembly is the one place both planes legitimately meet.
export type {
  ApprovalRequestId,
  CordisHalfState,
  CordisDynamicPackageId,
  CordisDynamicPluginId,
  CordisDynamicPluginRunId,
  CordisDynamicRunMode,
  CordisInspectMethodManifest,
  CordisInspectPlatform,
  CordisInspectProviderManifest,
  CordisInspectProviderView,
  CordisInspectQueryRequest,
  CordisInspectQueryResolution,
  CordisInspectQueryResolved,
  CordisInspectRequestId,
  CordisInspectResolveAck,
  CordisRunDiagnostic,
  CordisRunStatus,
  DynamicCordisClientSource,
  DynamicCordisHostHalfResult,
  DynamicCordisInventoryRow,
  DynamicCordisInvokeResult,
  DynamicCordisPackage,
  DynamicCordisRequestResolved,
  DynamicCordisResolveAck,
  DynamicCordisRetracted,
  DynamicCordisRunRequest,
  DynamicCordisRunResolution,
  DynamicCordisRunAttempt,
  DynamicCordisRunResponse,
  DynamicCordisStopResponse,
  DynamicCordisUndefineReceipt,
  RequestRunOutcome,
} from '@aeven/cordis-host-runner/types'
// Credential state vocabulary for the credentials namespace (values never ride it).
export type { CredentialInfo } from '@aeven/credentials/types'
// Redacted namespace vocabulary for the settings namespace (secrets never ride
// it). It travels with its seam, whose `./types` the Client face already reads.
export type {
  SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView,
} from '@aeven/settings/types'
// Provider registry and discovery vocabulary for the llm namespace.
export type {
  LlmConfigurableProvider, LlmDiscoveredModel,
  LlmModelDiscoveryRequest, LlmProviderInfo,
} from '@aeven/llm/types'
// Reference-discovery result vocabulary for the fileReferences and
// sessionReferenceResolver namespaces.
export type { FileReferenceCandidate } from '@aeven/file-reference/types'
export type { SessionReferenceMentionCandidate } from '@aeven/session-reference/types'

// The Remote failure vocabulary, re-exported so business packages keep naming
// this assembly alone. Types only: a value export would make spec imports load
// this module's owner /remote artifacts; specs take RemoteError from
// avn-client-test-runtime instead.
export type {
  RemoteErrorCode, RemoteErrorDetailsMap, RemoteFailure, RemoteResult,
} from '@aeven/typert-protocol'
export type { RemoteHostFacts } from '@aeven/api-gateway/client'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Generated Remote namespaces selected by this Client assembly. */
    remote: ClientRemote
  }
}

/** Required service: the typed Client Remote contribution mount. */
export const inject = ['remote']

/**
 * Mount the Host capabilities explicitly selected for this Client assembly.
 * @param ctx - Client Cordis root carrying the typed API service.
 * @returns disposer after every selected Remote namespace is ready.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    for (const contribution of [
      agentPresetsRemote, commandsRemote, settingsControllerRemote, goalsRemote, llmRemote, dynamicRemote,
      pluginInventoryRemote, messageFeedbackRemote, sessionReferencesRemote,
      subagentsRemote, sessionRemote, jobRemote, workspaceRemote, browserChromiumRemote, workspaceFilesRemote,
      terminalRemote, deviceRemote, speechRemote,
    ]) {
      disposers.push(await ctx.remote.$mount(contribution))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose()
    throw error
  }
  // Unwound in reverse mount order, so a namespace never outlives one mounted
  // after it.
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
