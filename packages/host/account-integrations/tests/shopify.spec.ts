/**
 * The Shopify descriptor: which store Settings may connect, from the forms a merchant types it in.
 */

import { describe, expect, it } from 'vitest'
import { shopifyRequestSchema } from '../src/shopify.ts'

describe('Shopify store field', () => {
  it('normalizes a domain, a URL, an admin URL, and a bare handle to the store domain', () => {
    for (const shop of ['mugs.myshopify.com', 'https://Mugs.myshopify.com/admin/products', 'admin.shopify.com/store/mugs', 'https://admin.shopify.com/store/mugs/orders', 'mugs', ' MUGS ']) {
      expect(shopifyRequestSchema.parse({ shop }).shop, shop).toBe('mugs.myshopify.com')
    }
  })

  it('refuses a store outside myshopify.com', () => {
    for (const shop of ['mugs.com', 'evil.example.com', 'mugs.myshopify.com.evil.example', '-mugs', '']) {
      expect(shopifyRequestSchema.safeParse({ shop }).success, shop).toBe(false)
    }
  })
})
