/** Keyless assembled-Web evidence for syntax highlighting during a streamed code fence. */

import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@aeven/llm'
import { LlmAdapter } from '@aeven/llm'
import type {} from '@aeven/agent-default-model'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot, writeComposerDraft } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/streaming-fence-highlight', import.meta.url))
const MID_EXPECTED = fileURLToPath(new URL('./snapshots/streaming-fence-highlight/mid-stream.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const PROVIDER = 'streaming-fence-highlight-test'
const MODEL = 'streaming-fence'
const PROMPT = 'Stream one TypeScript fence for the highlighting snapshot.'
const FIRST_REPLY = '```ts\nconst first: number = 1\n'
const OPEN_REPLY = `${FIRST_REPLY}const second = "two"\nlet tail`
const REPLY = `${OPEN_REPLY}\n\`\`\``

/** Deterministic model response held after each visible fence-growth frame. */
class StreamingFenceAdapter extends LlmAdapter {
  private resolveFirstPaused!: () => void
  private resolveFirstContinuation!: () => void
  private resolveSecondPaused!: () => void
  private resolveSecondContinuation!: () => void
  private firstContinued = false
  private secondContinued = false
  readonly firstPaused = new Promise<void>((resolve) => { this.resolveFirstPaused = resolve })
  readonly secondPaused = new Promise<void>((resolve) => { this.resolveSecondPaused = resolve })
  private readonly firstContinuation = new Promise<void>((resolve) => { this.resolveFirstContinuation = resolve })
  private readonly secondContinuation = new Promise<void>((resolve) => { this.resolveSecondContinuation = resolve })

  grow(): void {
    if (this.firstContinued) return
    this.firstContinued = true
    this.resolveFirstContinuation()
  }

  finish(): void {
    if (this.secondContinued) return
    this.secondContinued = true
    this.resolveSecondContinuation()
  }

  continue(): void {
    this.grow()
    this.finish()
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: FIRST_REPLY }
    this.resolveFirstPaused()
    await this.firstContinuation
    yield { type: 'text-delta', index: 0, text: OPEN_REPLY.slice(FIRST_REPLY.length) }
    this.resolveSecondPaused()
    await this.secondContinuation
    if (options.signal?.aborted === true) throw options.signal.reason
    yield { type: 'text-delta', index: 0, text: '\n```' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: REPLY } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

interface FenceTree {
  language: string
  text: string
  classes: string[]
}

/** Read the stable, user-visible subset of one rendered code fence. */
async function fenceTree(block: ReturnType<Page['locator']>): Promise<FenceTree> {
  return await block.evaluate((element) => {
    const code = element.querySelector<HTMLElement>('code.hljs')
    if (code === null) throw new Error('streaming fence did not render through highlight.js')
    return {
      language: element.querySelector('.codeblock-title')?.textContent?.trim() ?? '',
      text: code.textContent ?? '',
      classes: [...code.querySelectorAll('span[class]')].map(span => span.className),
    }
  })
}

describe.skipIf(MODE === 'record')('web e2e: streaming code-fence highlighting', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const adapter = new StreamingFenceAdapter()

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    scaffold.ctx.effect(
      () => scaffold.ctx.llm.registerAdapter([PROVIDER], adapter),
      'streaming fence highlight adapter',
    )
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider: PROVIDER, model: MODEL })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    adapter.continue()
    await browser?.close()
    await scaffold?.close()
  })

  it('renders the growing fence through highlight.js and keeps highlighting when the turn settles', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-streaming-fence-highlight'))
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled(30_000)
    await writeComposerDraft(page, input, PROMPT)
    await input.press('Enter')
    await adapter.firstPaused

    const streaming = page.locator('[data-streaming="true"]')
    await streaming.waitFor({ timeout: 10_000 })
    const block = streaming.locator('.codeblock-wrapper').filter({ hasText: 'const first' })
    await block.locator('code.hljs').first().waitFor({ timeout: 10_000 })
    await block.evaluate((element) => {
      element.setAttribute('data-stream-block-retained', 'true')
    })

    adapter.grow()
    await adapter.secondPaused
    await expect.poll(() => block.locator('code.hljs').textContent()).toContain('const second')
    expect(await block.evaluate(element => element.getAttribute('data-stream-block-retained'))).toBe('true')
    const midTree = await fenceTree(block)
    expect(midTree.language).toBe('ts')
    expect(midTree.text).toContain('const first')
    expect(midTree.text).toContain('const second')
    expect(midTree.classes.some(name => name.includes('hljs-'))).toBe(true)

    const aria = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(
      MID_EXPECTED,
      `${aria}\n\n---\n\n${JSON.stringify(midTree, null, 2)}`,
      MODE,
    )

    adapter.finish()
    await settled
    await expect.poll(() => page.locator('[data-streaming="true"]').count(), { timeout: 10_000 }).toBe(0)
    const settledBlock = page.locator('.codeblock-wrapper').filter({ hasText: 'const first' })
    await settledBlock.locator('code.hljs').waitFor({ timeout: 10_000 })
    const settledTree = await fenceTree(settledBlock)
    expect(settledTree.text).toContain('const first')
    expect(settledTree.text).toContain('const second')
    expect(settledTree.classes.some(name => name.includes('hljs-'))).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['mid-stream.expected.md'])
  }, 60_000)
})
