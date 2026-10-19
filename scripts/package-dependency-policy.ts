/** Explicit exceptions and Host packages for the published dependency policy. */

/** Packages treated as Client/Host packages without declaring `avn.client`. */
const CLIENT_FACE_INCLUDE: readonly string[] = []

/** Packages exempted from automatic Client/Host treatment despite declaring `avn.client`. */
const CLIENT_FACE_EXCLUDE: readonly string[] = [
  '@aeven/api-session-controller',
  '@aeven/api-workspace-controller',
]

/** Host-only packages whose peer relays are deliberately flattened. */
const HOST_DEPENDENCY_PACKAGES: readonly string[] = [
  '@aeven/llm',
  '@aeven/session',
]

/** Development-only package relationships not represented by source imports. */
const CONFIGURATION_ONLY_DEV_DEPENDENCIES = {
  '@aeven/client-locale': ['@aeven/api-remotes'],
  '@aeven/client-ui-conversation': [
    '@aeven/api-remotes',
    '@aeven/client-ui-workspace',
  ],
  '@aeven/client-ui-model-selection': ['@aeven/client-ui-input-trigger'],
  '@aeven/client-ui-sidebar': ['@aeven/client-ui-workspace'],
  '@aeven/client-ui-subagent': ['@aeven/client-ui-input-trigger'],
  '@aeven/client-ui-theme': ['@aeven/api-remotes'],
  '@aeven/client-ui-tool': ['@aeven/api-remotes'],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Workspace packages whose complete runtime surface is safe across duplicate installations. */
const DUPLICATE_SAFE_PACKAGES: readonly string[] = [
  '@aeven/brand',
  '@aeven/typert-protocol',
  '@aeven/util-crypto',
  '@aeven/util-values',
]

/**
 * Runtime exports whose values remain valid when npm installs another package copy.
 */
const SAFE_HOST_DEPENDENCY_EXPORTS = {
  '@aeven/atomic-write': ['withFileLock', 'writeFileAtomic'],
  '@aeven/brand-page': ['brandPageHtml'],
  '@aeven/credentials': ['credentialKey'],
  '@aeven/deque': ['Deque'],
  '@aeven/home-paths': ['resolveAvnHome'],
  '@aeven/llm': [
    'LlmAdapter',
    'RetryPolicySchema',
    'assertUsableApiKey',
    'callConfigEquals',
    'resolveImageAttachmentAccess',
    'resolveRetryPolicy',
  ],
  '@aeven/llm-pi-ai': ['PiAiAdapter'],
  '@aeven/media': ['MediaError', 'rejectImageControls'],
  '@aeven/tools': ['defineTool'],
  '@aeven/timeout': ['MAX_TIMER_DELAY_MS'],
  '@deepseek-ai/schemastery': ['default'],
} as const satisfies HostDependencyExports

/** Runtime exports that require every consumer to resolve the provider's shared peer instance. */
const PEER_REQUIRED_HOST_EXPORTS = {
  // The failure taxonomy crosses package boundaries: the Agent loop and other
  // adapters narrow a provider failure with `error instanceof LlmError`, so a
  // second installed copy would read a real provider failure as an unknown one.
  '@aeven/llm': ['LlmError'],
  '@aeven/scope': ['carrierKeyOf', 'scopeOf', 'scopeTarget'],
} as const satisfies HostDependencyExports

/** Exact import specifier to reviewed runtime exports. */
type HostDependencyExports = Readonly<Record<string, readonly string[]>>

/** Complete configurable input to package dependency classification. */
export interface PackageDependencyPolicy {
  readonly clientFaceInclude: readonly string[]
  readonly clientFaceExclude: readonly string[]
  readonly hostPackages: readonly string[]
  readonly configurationOnlyDevDependencies: Readonly<Record<string, readonly string[]>>
  readonly duplicateSafePackages?: readonly string[]
  readonly safeHostDependencyExports: HostDependencyExports
  readonly peerRequiredHostExports: HostDependencyExports
}

/** Repository dependency policy consumed by verification and benchmarking. */
export const PACKAGE_DEPENDENCY_POLICY: PackageDependencyPolicy = {
  clientFaceInclude: CLIENT_FACE_INCLUDE,
  clientFaceExclude: CLIENT_FACE_EXCLUDE,
  hostPackages: HOST_DEPENDENCY_PACKAGES,
  configurationOnlyDevDependencies: CONFIGURATION_ONLY_DEV_DEPENDENCIES,
  duplicateSafePackages: DUPLICATE_SAFE_PACKAGES,
  safeHostDependencyExports: SAFE_HOST_DEPENDENCY_EXPORTS,
  peerRequiredHostExports: PEER_REQUIRED_HOST_EXPORTS,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a package manifest declares a dynamically loaded Client entry. */
export function hasClientDeclaration(avnField: unknown): boolean {
  return isRecord(avnField) && Object.hasOwn(avnField, 'client')
}

/** Whether the repository policy flattens one package's non-Cordis peers. */
export function usesFlattenedPackageDependencies(
  manifestPath: string,
  packageName: string,
  avnField: unknown,
  policy: PackageDependencyPolicy = PACKAGE_DEPENDENCY_POLICY,
): boolean {
  if (!manifestPath.startsWith('packages/') || manifestPath.startsWith('packages/experimental/')) return false
  if (policy.hostPackages.includes(packageName)) return true
  if (manifestPath.startsWith('packages/client/')) return true
  const included = hasClientDeclaration(avnField) || policy.clientFaceInclude.includes(packageName)
  return included && !policy.clientFaceExclude.includes(packageName)
}
