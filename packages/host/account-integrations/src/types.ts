/** Account-owned integration settings exchanged with the browser. */

import type { Branded } from '@aeven/brand'

/** Durable identity of one account's connector. */
export type ConnectorId = Branded<'account-connector-id'>

/** Provider selected when creating a connector. */
export type ConnectorProvider = 'github' | 'gmail' | 'google-drive' | 'google-calendar' | 'microsoft365' | 'mcp' | 'email'

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
  /** Server settings of an `email` connector; passwords are never returned. */
  email?: EmailConnectorSettings
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

/** Transport security of one email server: implicit TLS or a mandatory STARTTLS upgrade. */
export type EmailSecurity = 'tls' | 'starttls'

/** One email server binding. */
export interface EmailServerSettings {
  host: string
  port: number
  security: EmailSecurity
  username: string
}

/** The receive binding; POP3 requires implicit TLS. */
export interface EmailReceiveSettings extends EmailServerSettings {
  protocol: 'imap' | 'pop3'
}

/** Non-secret settings of one email account. */
export interface EmailConnectorSettings {
  address: string
  /** Further addresses the account may send as. */
  aliases: string[]
  receive: EmailReceiveSettings
  /** Absent for a receive-only account. */
  send?: EmailServerSettings
}

/** Email account creation fields; passwords are write-only. */
export interface EmailConnectionRequest extends EmailConnectorSettings {
  /** Display name; defaults to the address. */
  name?: string
  receivePassword: string
  /** Absent when the send binding reuses the receive password. */
  sendPassword?: string
}

/** Email account edit fields; an absent password keeps the stored one. */
export interface EmailConnectionUpdate extends EmailConnectorSettings {
  name?: string
  receivePassword?: string
  sendPassword?: string
}

/** Verification step that failed while adding an email account. */
export type EmailProbeStep = 'receive-connect' | 'receive-authenticate' | 'receive-list' | 'send-connect' | 'send-authenticate'

/** Why an email account could not be added. */
export type EmailConnectionFailure = 'authentication' | 'connection' | 'tls' | 'invalid' | 'duplicate' | 'limit' | 'unavailable' | 'other'

/** Outcome of adding an email account. */
export type EmailConnectionResult =
  | { kind: 'connected'; id: ConnectorId }
  | { kind: 'failed'; reason: EmailConnectionFailure; step?: EmailProbeStep }
