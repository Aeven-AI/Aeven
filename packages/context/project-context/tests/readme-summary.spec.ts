/** `readmeSummary` keeps the opening prose of a README and nothing that frames it. */
import { describe, expect, it } from 'vitest'
import { readmeSummary } from '../src/index.ts'

const README = `---
title: Site
layout: default
---

Language switcher: [English](index.md) | [中文](index.zh.md)

# Site

![banner](banner.png)

An open builder that turns a folder of field notes into a browsable site.

\`\`\`sh
pnpm install
\`\`\`

<div align="center">html block</div>

| name | role |
| --- | --- |
| Ada | author |

- bullet item
1. numbered item

[only a link](index.md)

The logo ![icon](icon.png) sits in the header of every page.

See [the docs](docs/architecture.md) for the full contract of the site engine.

~~~
tilde fenced block
~~~
`

describe('readmeSummary', () => {
  it('keeps opening prose and skips the framing a README opens with', () => {
    expect(readmeSummary(README, 10_000)).toBe([
      'An open builder that turns a folder of field notes into a browsable site.',
      'The logo sits in the header of every page.',
      'See the docs for the full contract of the site engine.',
    ].join('\n\n'))
  })

  it('reports no prose for a README made only of framing', () => {
    expect(readmeSummary('', 500)).toBe('')
    expect(readmeSummary('# Title\n\n- one\n- two\n\n[docs](index.md)\n', 500)).toBe('')
  })

  it('clips at the code-point budget and marks the cut', () => {
    expect(readmeSummary('abcdefghijklmnopqrstuvwxyz', 3)).toBe('abc…')
    expect(readmeSummary('abcdefghijklmnopqrstuvwxyz', 26)).toBe('abcdefghijklmnopqrstuvwxyz')
    // Code points, not UTF-16 units: a CJK sentence is measured the same way.
    expect(readmeSummary('日本語サイトの見出しです、これは二十文字以上あります', 4)).toBe('日本語サ…')
    // The cut never keeps trailing whitespace before the ellipsis.
    expect(readmeSummary('alpha beta gamma delta epsilon', 6)).toBe('alpha…')
  })
})
