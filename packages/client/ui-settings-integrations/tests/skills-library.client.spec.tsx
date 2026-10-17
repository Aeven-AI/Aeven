// @vitest-environment jsdom
/**
 * The Skills page lists the account's own skills only. Discovered repository,
 * preset, and connector-owned skills are ambient and not switchable, so they
 * never reach this list even when the Host reports them on a connector.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AccountIntegrationsView, SkillCatalogView } from '@aeven/api-remotes/client'
import type { IntegrationsLocaleKey } from '../src/client/locales.ts'
import { IntegrationsSection } from '../src/client/IntegrationsSection.tsx'
import type { IntegrationsSectionProps } from '../src/client/IntegrationsSection.tsx'

afterEach(cleanup)

// jsdom has no layout, so the detail view's scroll-into-view needs a stub.
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })

/** Copy for the keys the page reads, in the shape the locale seat returns. */
const COPY: Partial<Record<IntegrationsLocaleKey, string>> = {
  skills: 'Skills', skillsIntro: 'Skills you add by importing a SKILL.md, .skill, or ZIP bundle.',
  import: 'Import skill', importHint: 'Choose a SKILL.md.',
  searchSkills: 'Search skills', personalSkill: 'Personal import', removeSkill: 'Remove skill',
  files: 'Bundle files', copy: 'Copy', copied: 'Copied', footnotes: 'References', noMatches: 'No skills match your search.',
}

type Skill = AccountIntegrationsView['skills'][number]

/** One account-owned library entry. */
function imported(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'imported-1' as Skill['id'], name: 'invoice-checker', description: 'Checks invoices against the ledger.',
    enabled: true, content: '# Invoice checker\n\nCompare each invoice line with the ledger.', files: ['scripts/check.py'], source: 'account',
    ...overrides,
  }
}

/** A connector that reports the skills it owns. */
function connectorOwned(): AccountIntegrationsView['providers'][number] {
  return {
    provider: 'github', configured: true,
    skills: [{ id: 'github-skill' as Skill['id'], name: 'github', description: 'Inspect repositories.', enabled: true, content: '# GitHub', files: [], source: 'custom' }],
  }
}

/** One catalogued skill, with the install count the catalog carries for it. */
function catalogued(name: string, displayName: string, downloads: number): SkillCatalogView['skills'][number] {
  return {
    name, displayName, category: 'reverse-engineering', description: `${displayName} description.`,
    keywords: [], downloads, author: '', path: `packages/skill/skill-catalog/authored/${name}`, bytes: 100,
  }
}

/** Mount the Skills page with stubbed account operations. */
function mount(view: AccountIntegrationsView, detail?: string, catalog?: SkillCatalogView) {
  const setSkillEnabled = vi.fn().mockResolvedValue(undefined)
  const removeSkill = vi.fn().mockResolvedValue(undefined)
  const showDetail = vi.fn()
  // The page reads no global session or workspace state; the seats only satisfy the slot props.
  const props = {
    useSessions: vi.fn() as IntegrationsSectionProps['useSessions'],
    useSessionPendingInteraction: vi.fn() as IntegrationsSectionProps['useSessionPendingInteraction'],
    useWorkspaces: vi.fn() as IntegrationsSectionProps['useWorkspaces'],
    t: (key: IntegrationsLocaleKey) => COPY[key] ?? key,
    page: 'skills' as const, detail, close: vi.fn(),
    useChanges: (selector => selector(0)) as IntegrationsSectionProps['useChanges'],
    list: () => Promise.resolve(view),
    cachedList: () => undefined,
    catalog: () => Promise.resolve(catalog),
    catalogSkillContent: () => Promise.resolve(undefined),
    installCatalogSkill: vi.fn().mockResolvedValue(undefined),
    showDetail, importSkill: vi.fn().mockResolvedValue(undefined), setSkillEnabled, removeSkill,
    connect: vi.fn(), connectEmail: vi.fn(), updateEmail: vi.fn(), authorize: vi.fn(),
    setConnectorEnabled: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn().mockResolvedValue(undefined),
    startWhatsAppPairing: vi.fn(), whatsAppPairing: vi.fn(), cancelWhatsAppPairing: vi.fn(),
    startTelegramPairing: vi.fn(), startTelegramQrPairing: vi.fn(), telegramPairing: vi.fn(),
    submitTelegramCode: vi.fn(), submitTelegramPassword: vi.fn(), cancelTelegramPairing: vi.fn(),
  }
  render(<IntegrationsSection {...props} />)
  return { setSkillEnabled, removeSkill, showDetail }
}

describe('the skills library', () => {
  it('lists an account-owned skill with its description', async () => {
    mount({ skills: [imported()], connectors: [], providers: [] })
    await waitFor(() => { expect(screen.getByText('invoice-checker')).toBeDefined() })
    expect(screen.getByText('Checks invoices against the ledger.')).toBeDefined()
    expect(screen.queryByText('You haven’t added any skills yet.')).toBeNull()
  })

  it('keeps connector-owned skills off the library page', async () => {
    mount({ skills: [], connectors: [], providers: [connectorOwned()] })
    await waitFor(() => { expect(screen.queryByText('github')).toBeNull() })
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('switches one skill off without touching the others', async () => {
    const page = mount({ skills: [imported()], connectors: [], providers: [] })
    await waitFor(() => { expect(screen.getByRole('switch')).toBeDefined() })
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => { expect(page.setSkillEnabled).toHaveBeenCalledWith('invoice-checker', false) })
  })

  it('opens the instructions and removes the skill from its own page', async () => {
    const page = mount({ skills: [imported()], connectors: [], providers: [] }, 'imported-1')
    await waitFor(() => { expect(screen.getByText('Personal import')).toBeDefined() })
    expect(screen.getByText('Compare each invoice line with the ledger.')).toBeDefined()
    expect(screen.getByText('scripts/check.py')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Remove skill' }))
    await waitFor(() => { expect(page.removeSkill).toHaveBeenCalledWith('invoice-checker') })
  })
})

describe('the skills catalog', () => {
  it('lists every skill in title order rather than install order', async () => {
    mount({ skills: [], connectors: [], providers: [] }, undefined, {
      commit: 'abc123', synced: '2026-10-17',
      categories: [{ name: 'reverse-engineering', skills: 2 }],
      skills: [catalogued('zeta-skill', 'Zeta skill', 9000), catalogued('alpha-skill', 'Alpha skill', 2)],
    })
    await waitFor(() => { expect(screen.getByText('alpha-skill')).toBeDefined() })
    const text = document.body.textContent ?? ''
    expect(text.indexOf('alpha-skill')).toBeLessThan(text.indexOf('zeta-skill'))
  })
})
