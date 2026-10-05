/** Account-owned integration settings exchanged with the browser. */

import type { Branded } from '@aeven/brand'

/** Durable identity of one account's connector. */
export type ConnectorId = Branded<'account-connector-id'>

/** Provider selected when creating a connector. */
export type ConnectorProvider = 'github' | 'gmail' | 'google-drive' | 'google-calendar' | 'microsoft365' | 'mcp'

/** Stable Settings identity of one skill definition. */
export type SkillViewId = Branded<'account-skill-view-id'>

/** Skill visible in Settings, with account-owned management availability. */
export interface PersonalSkillView {
  id: SkillViewId
  name: string
  description: string
  enabled: boolean
  /** Effective invocation availability, including connector activation. */
  available?: boolean
  content: string
  files: string[]
  source: string
  /** Account-owned content may be removed; all sources support account invocation preferences. */
  managed: boolean
  workspace?: string
}

/** Connector metadata; credentials are never returned. */
export interface PersonalConnectorView {
  id: ConnectorId
  provider: ConnectorProvider
  name: string
  enabled: boolean
  connected: boolean
  endpoint?: string
}

/** Current signed-in account's skills and connectors. */
export interface AccountIntegrationsView {
  skills: PersonalSkillView[]
  connectors: PersonalConnectorView[]
  providers: ConnectorProviderView[]
}

/** Deployment sign-in availability; contains no OAuth secrets. */
export interface ConnectorProviderView {
  provider: ConnectorProvider
  configured: boolean
  /** Installed skill definitions belonging to this connector. */
  skills: PersonalSkillView[]
}

/** Link for an account-bound provider consent flow. */
export interface ConnectorAuthorization {
  url: string
}

/** One uploaded bundle file, relative to its SKILL.md directory. */
export interface SkillUploadFile {
  path: string
  base64: string
}

/** Connector creation fields; token is write-only. */
export interface ConnectorCreateRequest {
  provider: ConnectorProvider
  name: string
  endpoint?: string
  token?: string
}
