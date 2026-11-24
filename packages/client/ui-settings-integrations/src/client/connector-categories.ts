/**
 * The category each connector is listed under on the Connectors page, and the order of those categories.
 * @module
 */
import type { ConnectorProvider } from '@aeven/api-remotes/client'

/** A heading on the Connectors page; each names the locale key of its title. */
export type ConnectorCategory =
  | 'categoryCommunication' | 'categoryProductivity' | 'categoryDevelopment' | 'categorySales'
  | 'categoryCommerce' | 'categoryFinance' | 'categoryMedia' | 'categoryCustom'

/** Category headings, top to bottom; Custom comes last because its servers can be anything, any number of them. */
export const CONNECTOR_CATEGORIES: readonly ConnectorCategory[] = [
  'categoryCommunication', 'categoryProductivity', 'categoryDevelopment', 'categorySales',
  'categoryCommerce', 'categoryFinance', 'categoryMedia', 'categoryCustom',
]

/** The heading every provider is listed under; a provider keeps the Host's list order inside its category. */
export const connectorCategory: Readonly<Record<ConnectorProvider, ConnectorCategory>> = {
  email: 'categoryCommunication', gmail: 'categoryCommunication', outlook: 'categoryCommunication', teams: 'categoryCommunication',
  slack: 'categoryCommunication', discord: 'categoryCommunication', whatsapp: 'categoryCommunication', telegram: 'categoryCommunication',
  'google-drive': 'categoryProductivity', 'google-calendar': 'categoryProductivity', 'google-tasks': 'categoryProductivity',
  'google-contacts': 'categoryProductivity', 'google-meet': 'categoryProductivity', 'microsoft-365': 'categoryProductivity',
  'outlook-calendar': 'categoryProductivity', onedrive: 'categoryProductivity', sharepoint: 'categoryProductivity',
  notion: 'categoryProductivity', calendly: 'categoryProductivity', atlassian: 'categoryProductivity', monday: 'categoryProductivity',
  github: 'categoryDevelopment', vercel: 'categoryDevelopment', cloudflare: 'categoryDevelopment', aws: 'categoryDevelopment', supabase: 'categoryDevelopment', bigquery: 'categoryDevelopment', 'compute-engine': 'categoryDevelopment',
  'azure-devops': 'categoryDevelopment', oracle: 'categoryDevelopment',
  salesforce: 'categorySales',
  shopify: 'categoryCommerce',
  stripe: 'categoryFinance',
  spotify: 'categoryMedia',
  mcp: 'categoryCustom',
}
