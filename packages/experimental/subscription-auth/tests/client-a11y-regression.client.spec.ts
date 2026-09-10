import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('client accessibility regressions', () => {
  it('only associates mounted disclosure panels with aria-controls', async () => {
    const providerCard = await readFile(join(root, 'src/client/components/ProviderCard.tsx'), 'utf8')

    expect(providerCard).toContain(
      'aria-controls={expanded ? `coding-oauth-usage-${definition.slug}` : undefined}',
    )
  })

  it('keeps the account connection target separate from the usage disclosure', async () => {
    const providerCard = await readFile(join(root, 'src/client/components/ProviderCard.tsx'), 'utf8')

    const slugExpression = '$' + '{definition.slug}'
    expect(providerCard).toContain(`id={\`coding-oauth-usage-toggle-${slugExpression}\`}`)
    expect(providerCard).toContain(`id={\`coding-oauth-login-${slugExpression}\`}`)
    expect(providerCard).toMatch(
      /if \(providerStatus\.status === 'signed-in'\) \{\s+logoutTrigger\.current\?\.focus\(\)/u,
    )
    expect(providerCard).toContain(`document.getElementById(\`coding-oauth-login-${slugExpression}\`)?.focus()`)
  })

})
