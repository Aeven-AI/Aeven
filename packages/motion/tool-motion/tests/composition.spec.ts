/**
 * The static read of a composition folder: the film's length and scene windows, and the refusal of a folder
 * that cannot render as written, which keeps a half-edited film off the user's screen.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readComposition, spacedTimes } from '../src/composition.ts'

let dir: string | undefined

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

/** A composition folder whose index.html hosts `scenes`, each backed by a file unless named in `missing`. */
async function folder(root: string, scenes: string, missing: readonly string[] = []): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'avn-motion-composition-'))
  await mkdir(join(dir, 'compositions'))
  for (const name of ['intro', 'payoff']) {
    if (!missing.includes(name)) await writeFile(join(dir, 'compositions', `${name}.html`), '<template><div id="root"></div></template>')
  }
  await writeFile(join(dir, 'index.html'), `<!doctype html><html><body>${root}${scenes}</div></body></html>`)
  return dir
}

const ROOT = '<div id="root" data-composition-id="main" data-start="0" data-duration="10" data-width="1920" data-height="1080">'
const INTRO = '<div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="0" data-duration="4"></div>'
const PAYOFF = '<div id=\'payoff\' data-composition-id=\'payoff\' data-composition-src=\'compositions/payoff.html\' data-start=\'4\' data-duration=\'6\'></div>'

describe('readComposition', () => {
  it('reads the film length and every hosted scene window', async () => {
    const facts = await readComposition(await folder(ROOT, INTRO + PAYOFF))
    expect(facts.durationSeconds).toBe(10)
    expect(facts.scenes).toEqual([
      { id: 'intro', src: 'compositions/intro.html', start: 0, duration: 4 },
      { id: 'payoff', src: 'compositions/payoff.html', start: 4, duration: 6 },
    ])
  })

  it('refuses a folder without index.html', async () => {
    dir = await mkdtemp(join(tmpdir(), 'avn-motion-composition-'))
    await expect(readComposition(dir)).rejects.toThrow('no index.html')
  })

  it('refuses a root without a length', async () => {
    const root = '<div id="root" data-composition-id="main" data-start="0">'
    await expect(readComposition(await folder(root, INTRO))).rejects.toThrow('no data-duration above 0')
  })

  it('refuses a scene whose file is missing, and one that runs past the film, naming both', async () => {
    const long = PAYOFF.replace("data-duration='6'", "data-duration='9'")
    const error = await readComposition(await folder(ROOT, INTRO + long, ['intro'])).catch((caught: unknown) => caught)
    expect(String(error)).toContain('scene "intro" names compositions/intro.html, which does not exist')
    expect(String(error)).toContain('scene "payoff" runs to 13 s, past the film\'s 10 s')
  })
})

describe('spacedTimes', () => {
  it('spreads times through a window at the middle of each equal share', () => {
    expect(spacedTimes(0, 10, 4)).toEqual([1.25, 3.75, 6.25, 8.75])
    expect(spacedTimes(4, 6, 3)).toEqual([5, 7, 9])
  })
})
