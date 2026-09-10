/** Response parsers and small formatting helpers for the settings UI. */

import { isRecord } from './api.ts'
import {
  GATEWAY_PORT_MAX,
  GATEWAY_PORT_MIN,
  GATEWAY_RANDOM_PORT_MAX,
  GATEWAY_RANDOM_PORT_MIN,
  GATEWAY_RANDOM_RESERVED,
  IMAGINE_SOURCE_KEY,
  SOURCE_COMMIT_ACTIONS,
  SOURCE_CONFLICTS,
  SOURCE_DEFAULT_PATH,
  SOURCE_KINDS,
  SOURCE_PREVIEW_ACTIONS,
  SOURCE_REASONS,
} from './constants.ts'
import type {
  CapabilitySettingsView,
  CapabilitySnapshot,
  GatewayView,
  GrokBuildSettingsInjected,
  ImagineCredentialView,
  ProviderStatus,
  SourceCommitAction,
  SourceConflict,
  SourceKind,
  SourcePreview,
  SourcePreviewAction,
  SourceReason,
  SourceStatus,
  UsageBreakdownView,
  UsageCreditsView,
  UsageEntitlementView,
  UsageGateView,
  UsageView,
  UsageProductLabelView,
  UsageWindowLabelView,
  UsageWindowView,
} from './types.ts'

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length < 500 ? value : undefined
}

export function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function optionalPercent(value: unknown): number | undefined {
  const numeric = optionalFiniteNumber(value)
  return numeric !== undefined && numeric >= 0 && numeric <= 100 ? numeric : undefined
}

export function isSourceKind(value: string): value is SourceKind {
  return (SOURCE_KINDS as readonly string[]).includes(value)
}

export function isSourceReason(value: string): value is SourceReason {
  return (SOURCE_REASONS as readonly string[]).includes(value)
}

export function isSourceConflict(value: string): value is SourceConflict {
  return (SOURCE_CONFLICTS as readonly string[]).includes(value)
}

export function isSourcePreviewAction(value: string): value is SourcePreviewAction {
  return (SOURCE_PREVIEW_ACTIONS as readonly string[]).includes(value)
}

export function isSourceCommitAction(value: string): value is SourceCommitAction {
  return (SOURCE_COMMIT_ACTIONS as readonly string[]).includes(value)
}

export function looksSecret(value: string): boolean {
  return /eyJ[A-Za-z0-9_-]+\.|sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+/u.test(value)
}

export function safeDisplayPath(value: unknown, kind: SourceKind): string {
  const text = optionalString(value)
  if (text === undefined || looksSecret(text) || text.length > 180) return SOURCE_DEFAULT_PATH[kind]
  return text
}

export function safeWarning(value: unknown): string | undefined {
  const text = optionalString(value)
  if (text === undefined || looksSecret(text)) return undefined
  return text
}

export function formatEpoch(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : undefined
  if (ms === undefined) return undefined
  const formatted = new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  return formatted.length > 0 ? formatted : undefined
}

export function parseSource(value: unknown): SourceStatus | undefined {
  if (!isRecord(value) || typeof value['kind'] !== 'string' || !isSourceKind(value['kind'])) return undefined
  const kind = value['kind']
  const reasonRaw = optionalString(value['reason'])
  const expiresAt = optionalFiniteNumber(value['expiresAt'])
  return {
    kind,
    displayPath: safeDisplayPath(value['displayPath'], kind),
    available: value['available'] === true,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(reasonRaw !== undefined && isSourceReason(reasonRaw) ? { reason: reasonRaw } : {}),
  }
}

export function mergeSources(discovered: readonly SourceStatus[]): SourceStatus[] {
  return SOURCE_KINDS.map((kind) => {
    const found = discovered.find(entry => entry.kind === kind)
    return found ?? { kind, displayPath: SOURCE_DEFAULT_PATH[kind], available: false, reason: 'missing' }
  })
}

export function parseSources(value: unknown): SourceStatus[] {
  const rows = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value['sources'])
      ? value['sources']
      : []
  return mergeSources(rows.map(parseSource).filter((entry): entry is SourceStatus => entry !== undefined))
}

export function parsePreview(value: unknown): SourcePreview | undefined {
  if (!isRecord(value)) return undefined
  const previewId = optionalString(value['previewId'])
  const kindRaw = optionalString(value['kind'])
  if (previewId === undefined || kindRaw === undefined || !isSourceKind(kindRaw)) return undefined
  const conflictRaw = optionalString(value['conflict'])
  const actionRaw = optionalString(value['action'])
  const expiresAt = optionalFiniteNumber(value['expiresAt'])
  const ticketExpiresAt = optionalFiniteNumber(value['ticketExpiresAt'])
  const warnings = Array.isArray(value['warnings'])
    ? value['warnings'].map(safeWarning).filter((entry): entry is string => entry !== undefined)
    : []
  return {
    previewId,
    kind: kindRaw,
    displayPath: safeDisplayPath(value['displayPath'], kindRaw),
    confirmOverwriteRequired: value['confirmOverwriteRequired'] === true,
    warnings,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(ticketExpiresAt === undefined ? {} : { ticketExpiresAt }),
    ...(conflictRaw !== undefined && isSourceConflict(conflictRaw) ? { conflict: conflictRaw } : {}),
    ...(actionRaw !== undefined && isSourcePreviewAction(actionRaw) ? { action: actionRaw } : {}),
  }
}

export function parseCommitAction(value: unknown): SourceCommitAction | undefined {
  if (!isRecord(value)) return undefined
  const action = optionalString(value['action'])
  return action !== undefined && isSourceCommitAction(action) ? action : undefined
}

export function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = optionalFiniteNumber(value)
  return numeric !== undefined && Number.isInteger(numeric) && numeric >= min && numeric <= max ? numeric : fallback
}

export function emptyCapabilitySettings(): CapabilitySettingsView {
  return {
    codexSearch: false,
    codexFast: false,
    searchResults: 5,
  }
}

export function parseCapabilitySettings(value: unknown): CapabilitySettingsView {
  const source = isRecord(value) ? value : {}
  return {
    codexSearch: source['codexSearch'] === true,
    codexFast: source['codexFast'] === true,
    searchResults: boundedInteger(source['searchResults'], 1, 20, 5),
  }
}

export function parseCapabilities(value: unknown): CapabilitySnapshot | undefined {
  if (!isRecord(value)) return undefined
  const nested = isRecord(value['value']) ? value['value'] : value
  const revision = optionalFiniteNumber(value['revision'])
  if (revision === undefined && !isRecord(value['value']) && value['writable'] === undefined) return undefined
  return {
    value: parseCapabilitySettings(nested),
    revision: revision ?? 0,
    writable: value['writable'] === true,
  }
}

const USAGE_WINDOW_LABELS = new Set<UsageWindowLabelView>([
  'fiveHour',
  'weekly',
  'weeklyOpus',
  'monthly',
  'session',
  'codeReview',
  'usage',
  'custom',
])

const USAGE_ENTITLEMENTS = new Set<UsageEntitlementView>([
  'entitled',
  'no-subscription',
  'not-entitled',
  'redirected',
  'unknown',
])

function parseUsageWindow(value: unknown): UsageWindowView | undefined {
  if (!isRecord(value)) return undefined
  const id = optionalString(value['id'])
  const remainingPercent = optionalPercent(value['remainingPercent'])
  if (id === undefined || remainingPercent === undefined) return undefined
  const rawLabel = optionalString(value['label'])
  const tag =
    rawLabel !== undefined && USAGE_WINDOW_LABELS.has(rawLabel as UsageWindowLabelView)
      ? (rawLabel as UsageWindowLabelView)
      : 'usage'
  const labelText = optionalString(value['labelText'])
  const resetsAt = optionalFiniteNumber(value['resetsAt'])
  return {
    id,
    label: tag,
    remainingPercent,
    ...(labelText === undefined ? {} : { labelText }),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

function parseUsageCredits(value: unknown): UsageCreditsView | undefined {
  if (!isRecord(value)) return undefined
  const kind = optionalString(value['kind'])
  const remaining = optionalFiniteNumber(value['remaining'])
  if (remaining === undefined || remaining < 0) return undefined
  const unlimited = optionalBoolean(value['unlimited'])
  const limit = unlimited === undefined ? {} : { unlimited }
  if (kind === 'count') return { kind, remaining, ...limit }
  const currency = optionalString(value['currency'])
  if (kind !== 'money' || currency === undefined || !/^[A-Z]{3}$/u.test(currency)) return undefined
  return { kind, currency, remaining, ...limit }
}

const USAGE_PRODUCT_LABELS = new Set<UsageProductLabelView>(['grokBuild', 'chat', 'imagine', 'custom'])

function parseUsageBreakdown(value: unknown): UsageBreakdownView[] {
  if (!Array.isArray(value)) return []
  const entries: UsageBreakdownView[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const id = optionalString(item['id'])
    const usedPercent = optionalPercent(item['usedPercent'])
    if (id === undefined || usedPercent === undefined) continue
    const rawLabel = optionalString(item['label'])
    const tag = rawLabel !== undefined && USAGE_PRODUCT_LABELS.has(rawLabel as UsageProductLabelView)
      ? (rawLabel as UsageProductLabelView)
      : 'custom'
    const labelText = optionalString(item['labelText'])
    entries.push({ id, label: tag, usedPercent, ...(labelText === undefined ? {} : { labelText }) })
  }
  return entries
}

function parseUsageGate(value: unknown): UsageGateView | undefined {
  if (!isRecord(value)) return undefined
  const message = optionalString(value['message'])
  const url = optionalString(value['url'])
  const label = optionalString(value['label'])
  if (message === undefined && url === undefined && label === undefined) return undefined
  return {
    ...(message === undefined ? {} : { message }),
    ...(url === undefined ? {} : { url }),
    ...(label === undefined ? {} : { label }),
  }
}

/**
 * Read one provider's usage answer.
 *
 * An unreadable body becomes `unknown` rather than undefined: the card must
 * still say something about a signed-in provider, and "not determined" is a
 * truthful thing to say.
 * @param value - the parsed usage response body.
 * @returns the projection the card renders.
 */
export function parseUsage(value: unknown): UsageView {
  const payload = isRecord(value) ? value : {}
  const rawEntitlement = optionalString(payload['entitlement'])
  const entitlement =
    rawEntitlement !== undefined && USAGE_ENTITLEMENTS.has(rawEntitlement as UsageEntitlementView)
      ? (rawEntitlement as UsageEntitlementView)
      : 'unknown'
  const windows = Array.isArray(payload['windows'])
    ? payload['windows'].map(parseUsageWindow).filter((entry): entry is UsageWindowView => entry !== undefined)
    : []
  const credits = parseUsageCredits(payload['credits'])
  const breakdown = parseUsageBreakdown(payload['breakdown'])
  const gate = parseUsageGate(payload['gate'])
  const tier = optionalString(payload['tier'])
  const redirectUrl = optionalString(payload['redirectUrl'])
  const fetchedAt = optionalFiniteNumber(payload['fetchedAt'])
  return {
    entitlement,
    windows,
    ...(credits === undefined ? {} : { credits }),
    ...(breakdown.length === 0 ? {} : { breakdown }),
    ...(gate === undefined ? {} : { gate }),
    ...(tier === undefined ? {} : { tier }),
    ...(redirectUrl === undefined ? {} : { redirectUrl }),
    ...(fetchedAt === undefined ? {} : { fetchedAt }),
  }
}

/**
 * Whether the projection carries meters to draw.
 * @param usage - the parsed projection.
 * @returns true when a window or a credit balance is present.
 */
export function usageHasVisibleFields(usage: UsageView): boolean {
  return usage.windows.length > 0 || usage.credits !== undefined
}

export function parseGateway(value: unknown): GatewayView | undefined {
  if (!isRecord(value)) return undefined
  const bind = optionalString(value['bind'])
  const port = optionalFiniteNumber(value['port'])
  if (bind === undefined || port === undefined) return undefined
  const models = Array.isArray(value['models'])
    ? value['models'].filter((model): model is string => typeof model === 'string' && model.length > 0)
    : []
  const model = optionalString(value['model']) ?? models[0] ?? null
  if (models.length === 0 && model !== null) models.push(model)
  const keyAvailable = value['keyAvailable'] === true || value['keyConfigured'] === true
  return {
    enabled: value['enabled'] === true,
    running: value['running'] === true,
    bind,
    port,
    model,
    keyConfigured: keyAvailable,
    keyAvailable,
    keyHint: optionalString(value['keyHint']) ?? '',
    models,
    warning: optionalString(value['warning']) ?? '',
  }
}

export function formatGatewayBaseUrl(bind: string, port: number): string {
  const host = bind.includes(':') && !bind.startsWith('[') ? `[${bind}]` : bind
  return `http://${host}:${String(port)}`
}

export function randomGatewayPort(exclude?: number): number {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const span = GATEWAY_RANDOM_PORT_MAX - GATEWAY_RANDOM_PORT_MIN + 1
    const candidate = GATEWAY_RANDOM_PORT_MIN + Math.floor(Math.random() * span)
    if (candidate !== exclude && !GATEWAY_RANDOM_RESERVED.has(candidate)) return candidate
  }
  return exclude === GATEWAY_RANDOM_PORT_MIN ? GATEWAY_RANDOM_PORT_MIN + 1 : GATEWAY_RANDOM_PORT_MIN
}

export function parseGatewayPort(value: string): number | undefined {
  const port = Number(value)
  if (!Number.isInteger(port) || port < GATEWAY_PORT_MIN || port > GATEWAY_PORT_MAX) return undefined
  return port
}

export function parseImagineCredential(value: unknown): ImagineCredentialView | undefined {
  if (!isRecord(value)) return undefined
  const configured = optionalBoolean(value['configured'])
  if (configured === undefined && value['source'] === undefined && value['writable'] === undefined) return undefined
  const source = optionalString(value['source'])
  const writable = optionalBoolean(value['writable'])
  return {
    configured: configured === true,
    ...(source === undefined || looksSecret(source) ? {} : { source }),
    ...(writable === undefined ? {} : { writable }),
  }
}

export function imagineSourceLabel(source: string | undefined, t: GrokBuildSettingsInjected['t']): string {
  if (source === undefined) return t('imagineSourceUnknown')
  const mapped = IMAGINE_SOURCE_KEY[source] ?? IMAGINE_SOURCE_KEY[source.toLowerCase()]
  if (mapped !== undefined) return t(mapped)
  if (source.length <= 40 && /^[a-z0-9._-]+$/iu.test(source) && !looksSecret(source)) return source
  return t('imagineSourceUnknown')
}

export function modelFields(status: ProviderStatus): { available: string[]; selected: string[] } {
  if (status.status !== 'signed-in') return { available: [], selected: [] }
  return {
    available: 'available' in status ? status.available : [],
    selected: 'selected' in status ? status.selected : [],
  }
}
