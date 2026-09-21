/**
 * The file-format layer.
 *
 * The properties under test are the ones that make an unrunnable recipe honest: the
 * readiness report names every missing tool with a remedy, a task's requirements are
 * derived from its own operation text rather than a parallel list, and a blocked tool
 * makes its tasks refusable *before* they run rather than failing inside one.
 */

import { describe, expect, it } from 'vitest'
import {
  FORMAT_RECIPES,
  FORMAT_TOOLS,
  missingTools,
  probeFormatReadiness,
  requiredTools,
  type FormatProbeRunner,
} from '../src/index.ts'

const everything: FormatProbeRunner = { probe: () => Promise.resolve({ available: true }) }
const nothing: FormatProbeRunner = { probe: () => Promise.resolve({ available: false, reason: 'not installed' }) }

describe('readiness names every missing tool with a remedy', () => {
  it('reports every tool ready on a complete host, with no blockers', async () => {
    const report = await probeFormatReadiness(everything)
    expect(report.blockers).toEqual([])
    expect(report.probes).toHaveLength(FORMAT_TOOLS.length)
  })

  it('reports each missing tool as blocked, by name', async () => {
    const report = await probeFormatReadiness(nothing)
    expect(report.probes.every(probe => probe.state === 'blocked')).toBe(true)
    expect(report.probes.map(probe => probe.name)).toContain('format.openpyxl')
    expect(report.probes.map(probe => probe.name)).toContain('format.pandoc')
  })

  it('carries the reported reason onto the probe rather than a generic message', async () => {
    const report = await probeFormatReadiness(nothing)
    expect(report.probes[0]?.reason).toBe('not installed')
  })

  it('offers a remedy for every tool, so a blocker is actionable', async () => {
    const report = await probeFormatReadiness(nothing)
    for (const probe of report.probes) {
      expect(probe.remedy, probe.name).toBeTruthy()
      expect(probe.code).toBe('tool-missing')
    }
  })

  it('names the platform, since a remedy differs per platform', async () => {
    const report = await probeFormatReadiness(everything)
    expect(['darwin', 'win32', 'linux']).toContain(report.platform)
  })

  it('reports a mixed host as partly ready', async () => {
    const onlySoffice: FormatProbeRunner = {
      probe: tool => Promise.resolve(tool.name === 'soffice' ? { available: true } : { available: false }),
    }
    const report = await probeFormatReadiness(onlySoffice)
    expect(report.blockers).not.toContain('format.soffice')
    expect(report.blockers).toContain('format.pandoc')
  })
})

describe('a task declares the tools it needs, read from its own operation', () => {
  it('derives the requirement from the operation text, so it cannot drift', () => {
    expect(requiredTools('spreadsheet.createWorkbook')).toEqual(['soffice', 'openpyxl'])
    expect(requiredTools('document.createFromText')).toEqual(['python-docx'])
    expect(requiredTools('document.readText')).toEqual(['pandoc'])
    expect(requiredTools('pdf.extractText')).toEqual(['pdfplumber'])
    expect(requiredTools('document.convertToPdf')).toEqual(['soffice'])
  })

  it('reports no requirement for an unknown task rather than guessing', () => {
    expect(requiredTools('nothing.here')).toEqual([])
  })

  it('refuses a task whose tool is missing, naming the tool', async () => {
    const report = await probeFormatReadiness(nothing)
    expect(missingTools('spreadsheet.createWorkbook', report)).toEqual(['soffice', 'openpyxl'])
    expect(missingTools('document.readText', report)).toEqual(['pandoc'])
  })

  it('reports nothing missing when the host is complete', async () => {
    const report = await probeFormatReadiness(everything)
    for (const recipe of FORMAT_RECIPES) {
      expect(missingTools(recipe.task, report), recipe.task).toEqual([])
    }
  })

  it('reports a task with no requirements as runnable on any host', async () => {
    const report = await probeFormatReadiness(nothing)
    expect(missingTools('nothing.here', report)).toEqual([])
  })
})

describe('the recipes hold the invariants every recipe must', () => {
  it('gives every task an operation and a verification expectation', () => {
    for (const recipe of FORMAT_RECIPES) {
      expect(recipe.verify.length, recipe.task).toBeGreaterThan(0)
      for (const entry of recipe.on) {
        expect(entry.invocation.operation.length, recipe.task).toBeGreaterThan(0)
      }
    }
  })

  it('covers all three platforms identically, since the format layer is not platform-specific', () => {
    for (const recipe of FORMAT_RECIPES) {
      const platforms = recipe.on.map(entry => entry.platform).sort()
      expect(platforms, recipe.task).toEqual(['darwin', 'linux', 'win32'])
    }
  })

  it('needs no application, which is the whole point of the layer', () => {
    for (const recipe of FORMAT_RECIPES) {
      for (const entry of recipe.on) {
        expect(entry.apps, recipe.task).toEqual([])
      }
    }
  })

  it('marks every entry documented, since nothing here has been run on this host', () => {
    for (const recipe of FORMAT_RECIPES) {
      for (const entry of recipe.on) {
        expect(entry.evidence, recipe.task).toBe('documented')
      }
    }
  })

  it('never ships an empty-string content check, which would pass for anything', () => {
    for (const recipe of FORMAT_RECIPES) {
      for (const expectation of recipe.verify) {
        if (expectation.kind === 'fileContains' || expectation.kind === 'fileEquals') {
          expect(expectation.text.length, recipe.task).toBeGreaterThan(0)
        }
      }
    }
  })

  it('declares its blind spots where a tool cannot do the whole job', () => {
    const calc = FORMAT_RECIPES.find(recipe => recipe.task === 'spreadsheet.createWorkbook')
    expect(calc?.on[0]?.knownBlind).toContain('spreadsheet.writeWithoutRecalculating')
    const pdf = FORMAT_RECIPES.find(recipe => recipe.task === 'pdf.extractText')
    expect(pdf?.on[0]?.knownBlind).toContain('pdf.ocrScannedPages')
  })
})

describe('this host, measured', () => {
  it('reports which format tools are actually present here', async () => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const run = promisify(execFile)
    const runner: FormatProbeRunner = {
      probe: async (tool) => {
        if (tool.probe.kind === 'executable') {
          try {
            await run(tool.probe.command, [...tool.probe.versionArgs])
            return { available: true }
          } catch {
            return { available: false, reason: `${tool.probe.command} is not on PATH` }
          }
        }
        try {
          await run('python3', ['-c', `import ${tool.probe.module}`])
          return { available: true }
        } catch {
          return { available: false, reason: `python3 -c "import ${tool.probe.module}" failed` }
        }
      },
    }
    const report = await probeFormatReadiness(runner)
    // Recorded, not asserted as a requirement: the host may gain these tools, and a
    // test that pinned the machine's current state would fail for the wrong reason.
    // What is asserted is the property that matters — every tool is either ready or
    // blocked with a remedy, never an ambiguous third state.
    for (const probe of report.probes) {
      expect(['ready', 'blocked']).toContain(probe.state)
      if (probe.state === 'blocked') {
        expect(probe.remedy, probe.name).toBeTruthy()
      }
    }
    expect(report.probes).toHaveLength(FORMAT_TOOLS.length)
  })
})
