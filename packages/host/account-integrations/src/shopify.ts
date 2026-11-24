/**
 * Shopify connector: one row per connected store, each served by its own `@aeven/shopify-mcp`
 * stdio process over the store's Admin GraphQL API with a short-lived token the Aeven API issues.
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { z } from 'zod'

/** A store's domain as Shopify issues it; the Aeven API and the server apply the same rule. */
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/

/**
 * The store Settings submits, as a `<store>.myshopify.com` domain, a URL on it, an admin URL
 * (`admin.shopify.com/store/<store>`), or the bare store handle; each normalizes to the domain.
 */
export const shopifyRequestSchema = z.object({
  shop: z.string().trim().toLowerCase().transform((value) => {
    const admin = /^(?:https:\/\/)?admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/.exec(value)
    if (admin !== null) return `${admin[1] ?? ''}.myshopify.com`
    const host = value.replace(/^https:\/\//, '').replace(/[/?#].*$/, '')
    return host.includes('.') ? host : `${host}.myshopify.com`
  }).pipe(z.string().regex(SHOP_DOMAIN)),
})

/**
 * Locate the server entry the connector spawns per store.
 * @param override - `shopifyEntryPath` from configuration, when set.
 * @returns the built entry, or undefined when the package is absent on this host.
 */
export function resolveShopifyEntry(override: string | undefined): string | undefined {
  if (override !== undefined) return override
  try {
    const manifest = createRequire(import.meta.url).resolve('@aeven/shopify-mcp/package.json')
    return join(dirname(manifest), 'dist', 'main.js')
  } catch {
    // An absent package means Shopify is unsupported on this host; Settings reports it as not configured.
    return undefined
  }
}

/**
 * Prove a fresh grant reaches the store's Admin API, and read the store's name for its row.
 * @param shop - the store's domain.
 * @param token - the access token the Aeven API issued.
 * @param apiVersion - the Admin API version the server uses.
 * @param timeoutMs - the request budget.
 * @returns the store's name.
 * @throws when Shopify refuses the token or answers without the store.
 */
export async function verifyShopify(shop: string, token: string, apiVersion: string, timeoutMs: number): Promise<string> {
  const response = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: '{ shop { name } }' }),
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`Shopify Admin API access verification failed (HTTP ${response.status})`)
  const body = await response.json() as { data?: { shop?: { name?: unknown } } }
  const name = body.data?.shop?.name
  if (typeof name !== 'string' || name === '') throw new Error('Shopify Admin API returned no store')
  return name
}
