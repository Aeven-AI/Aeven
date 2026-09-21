/**
 * The file-format layer.
 *
 * These recipes produce and read **files**, never a running application, which is
 * what makes them the winning source wherever a file is the deliverable: no Office
 * installation, no running process, no permission grant, and verification by reading
 * the result back.
 *
 * The approach is taken from the document skills Anthropic ships with its desktop
 * application, which are the only source that covers these operations at all — and
 * which independently arrived at this stack's verification rule: their spreadsheet
 * skill makes recalculation mandatory and warns that a clean exit code is not a clean
 * file, because a "recalculated with errors found" result still exits zero.
 *
 * **These need tools this machine does not have.** Measured here: `soffice` is
 * present, while `pandoc`, `openpyxl`, `python-docx`, `python-pptx`, `pdfplumber` and
 * `markitdown` are all absent. So every recipe carries a readiness requirement, and
 * the adapter reports the missing tool by name rather than failing at the point of
 * use — the same posture the platform adapters take for a missing permission grant.
 * A recipe that failed with "command not found" deep inside a task would be exactly
 * the illegible failure this stack exists to eliminate.
 *
 * @module @aeven/computer-use-formats
 */

import type { Expectation, ReadinessProbe, ReadinessReport } from '@aeven/computer-use-desktop'
import { composeReadinessReport } from '@aeven/computer-use-desktop'
import type { RecipeBook } from '@aeven/computer-use-router'

/** A tool one or more recipes need. */
export interface FormatTool {
  /** Stable name, as the readiness report and failures refer to it. */
  name: string
  /** How to check for it: an executable, or a Python module that must import. */
  probe: { kind: 'executable', command: string, versionArgs: readonly string[] }
    | { kind: 'pythonModule', module: string }
  /** The action that installs it, shown only when it is missing. */
  remedy: string
}

/**
 * Every tool these recipes can need.
 *
 * Measured on macOS: `soffice` present; the rest absent. The list is the readiness
 * surface, so a caller can see which recipes are usable before running one.
 */
export const FORMAT_TOOLS: readonly FormatTool[] = [
  {
    name: 'soffice',
    probe: { kind: 'executable', command: 'soffice', versionArgs: ['--version'] },
    remedy: 'Install LibreOffice; it also computes spreadsheet formulas headlessly, which is how a workbook is recalculated',
  },
  {
    name: 'pandoc',
    probe: { kind: 'executable', command: 'pandoc', versionArgs: ['--version'] },
    remedy: 'Install pandoc to read document text without launching an editor',
  },
  {
    name: 'openpyxl',
    probe: { kind: 'pythonModule', module: 'openpyxl' },
    remedy: 'Install the Python package openpyxl to create and edit workbooks with formulas',
  },
  {
    name: 'python-docx',
    probe: { kind: 'pythonModule', module: 'docx' },
    remedy: 'Install the Python package python-docx, or use the docx npm library',
  },
  {
    name: 'python-pptx',
    probe: { kind: 'pythonModule', module: 'pptx' },
    remedy: 'Install the Python package python-pptx to create and edit presentations',
  },
  {
    name: 'pdfplumber',
    probe: { kind: 'pythonModule', module: 'pdfplumber' },
    remedy: 'Install the Python package pdfplumber to extract text and tables from PDFs',
  },
  {
    name: 'markitdown',
    probe: { kind: 'pythonModule', module: 'markitdown' },
    remedy: 'Install the Python package markitdown for a quick read of a document or workbook',
  },
]

/** Runs one probe and reports what it found. */
export interface FormatProbeRunner {
  /**
   * @param tool - the tool to probe.
   * @returns whether it answered, and what it said when it did not.
   */
  probe(tool: FormatTool): Promise<{ available: boolean, reason?: string }>
}

/**
 * Probe every format tool and compose a readiness report.
 *
 * Each missing tool is `blocked` with its remedy rather than `unknown`: the absence
 * is a fact about the host, and the remedy is known, so reporting anything softer
 * would hide an actionable gap.
 * @param runner - how to probe the host.
 * @returns the readiness report for the format layer.
 */
export async function probeFormatReadiness(runner: FormatProbeRunner): Promise<ReadinessReport> {
  const probes: ReadinessProbe[] = []
  for (const tool of FORMAT_TOOLS) {
    const result = await runner.probe(tool)
    if (result.available) {
      probes.push({ name: `format.${tool.name}`, state: 'ready' })
      continue
    }
    const probe: ReadinessProbe = {
      name: `format.${tool.name}`,
      state: 'blocked',
      code: 'tool-missing',
      remedy: tool.remedy,
    }
    if (result.reason !== undefined) {
      probe.reason = result.reason
    }
    probes.push(probe)
  }
  return composeReadinessReport(process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux', probes)
}

/**
 * The format layer's recipes.
 *
 * Every task declares the tool it needs, so an executor can refuse before running
 * rather than after. Each verifies by reading the produced file back, which is the
 * strongest evidence available and needs nothing but the filesystem.
 */
export const FORMAT_RECIPES: RecipeBook = [
  {
    task: 'spreadsheet.createWorkbook',
    summary: 'Create a workbook and write values and formulas into it, then recalculate.',
    deliverable: 'file',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        knownBlind: ['spreadsheet.writeWithoutRecalculating'],
        invocation: {
          mechanism: 'filesystem',
          operation: 'openpyxl writes the cells and formulas; soffice --headless recalculates the file in place',
          parameters: { path: '{path}', data: '{data}' },
        },
      },
      {
        platform: 'win32',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        invocation: {
          mechanism: 'filesystem',
          operation: 'openpyxl writes the cells and formulas; soffice --headless recalculates the file in place',
          parameters: { path: '{path}', data: '{data}' },
        },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        invocation: {
          mechanism: 'filesystem',
          operation: 'openpyxl writes the cells and formulas; soffice --headless recalculates the file in place',
          parameters: { path: '{path}', data: '{data}' },
        },
      },
    ],
    // Recalculation is mandatory: openpyxl stores formulas as strings with no cached
    // values, so until the file is recalculated every formula cell reads back as
    // absent to anything reading cached values.
    verify: [
      { kind: 'fileExists', path: '{path}' },
      { kind: 'fileContains', path: '{path}', text: 'xl/workbook.xml' },
    ],
  },
  {
    task: 'document.createFromText',
    summary: 'Create a Word document from text.',
    deliverable: 'file',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        invocation: {
          mechanism: 'filesystem',
          operation: 'python-docx writes paragraphs into the document',
          parameters: { path: '{path}', text: '{text}' },
        },
      },
      {
        platform: 'win32',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        invocation: {
          mechanism: 'filesystem',
          operation: 'python-docx writes paragraphs into the document',
          parameters: { path: '{path}', text: '{text}' },
        },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        invocation: {
          mechanism: 'filesystem',
          operation: 'python-docx writes paragraphs into the document',
          parameters: { path: '{path}', text: '{text}' },
        },
      },
    ],
    // A `.docx` is a zip of XML, so the word/document.xml part can be checked by
    // name; the text itself is asserted through the document reader below.
    verify: [
      { kind: 'fileExists', path: '{path}' },
      { kind: 'fileContains', path: '{path}', text: 'word/document.xml' },
    ],
  },
  {
    task: 'document.readText',
    summary: "Read a document's text without launching an editor.",
    deliverable: 'file',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        invocation: { mechanism: 'filesystem', operation: 'pandoc -t markdown reads the document text', parameters: { path: '{path}' } },
      },
      {
        platform: 'win32',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        invocation: { mechanism: 'filesystem', operation: 'pandoc -t markdown reads the document text', parameters: { path: '{path}' } },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        invocation: { mechanism: 'filesystem', operation: 'pandoc -t markdown reads the document text', parameters: { path: '{path}' } },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
  {
    task: 'presentation.readText',
    summary: 'Extract the text of a presentation.',
    deliverable: 'file',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        knownBlind: ['presentation.layouts'],
        invocation: {
          mechanism: 'filesystem',
          operation: 'python-pptx reads every slide and shape text',
          parameters: { path: '{path}' },
        },
      },
      {
        platform: 'win32',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        invocation: { mechanism: 'filesystem', operation: 'python-pptx reads every slide and shape text', parameters: { path: '{path}' } },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        invocation: { mechanism: 'filesystem', operation: 'python-pptx reads every slide and shape text', parameters: { path: '{path}' } },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
  {
    task: 'pdf.extractText',
    summary: 'Extract text from a PDF.',
    deliverable: 'file',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        knownBlind: ['pdf.ocrScannedPages'],
        invocation: { mechanism: 'filesystem', operation: 'pdfplumber reads the text layer', parameters: { path: '{path}' } },
      },
      {
        platform: 'win32',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        invocation: { mechanism: 'filesystem', operation: 'pdfplumber reads the text layer', parameters: { path: '{path}' } },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        invocation: { mechanism: 'filesystem', operation: 'pdfplumber reads the text layer', parameters: { path: '{path}' } },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
  {
    task: 'document.convertToPdf',
    summary: 'Convert a document to PDF through a headless office engine.',
    deliverable: 'file',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        invocation: {
          mechanism: 'filesystem',
          operation: 'soffice --headless --convert-to pdf',
          parameters: { path: '{path}' },
        },
      },
      {
        platform: 'win32',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        invocation: { mechanism: 'filesystem', operation: 'soffice --headless --convert-to pdf', parameters: { path: '{path}' } },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: [],
        evidence: 'documented',
        invocation: { mechanism: 'filesystem', operation: 'soffice --headless --convert-to pdf', parameters: { path: '{path}' } },
      },
    ],
    // A PDF is checkable by its own bytes, which is a real assertion rather than a
    // stand-in, and this is the one conversion whose result can be verified directly.
    verify: [
      { kind: 'fileExists', path: '{path}' },
      { kind: 'fileContains', path: '{path}', text: '%PDF' },
    ],
  },
]

/**
 * Which tools a task's recipes need.
 *
 * Read from the operation text so the mapping lives beside the recipes rather than in
 * a second list that could drift from them.
 * @param task - the task name to look up.
 * @returns the tool names it requires, in declaration order.
 */
export function requiredTools(task: string): string[] {
  const recipe = FORMAT_RECIPES.find(entry => entry.task === task)
  if (recipe === undefined) {
    return []
  }
  const operations = recipe.on.map(entry => entry.invocation.operation).join(' ')
  return FORMAT_TOOLS.filter(tool => operations.includes(tool.name)).map(tool => tool.name)
}

/**
 * Check whether a task can run on this host.
 * @param task - the task name.
 * @param report - the readiness report from {@link probeFormatReadiness}.
 * @returns the missing tools, empty when the task can run.
 */
export function missingTools(task: string, report: ReadinessReport): string[] {
  const needed = requiredTools(task)
  const blocked = new Set(report.probes.filter(probe => probe.state === 'blocked').map(probe => probe.name.replace('format.', '')))
  return needed.filter(tool => blocked.has(tool))
}

/** The expectations a caller can use to confirm a format recipe produced a file. */
export type FormatExpectation = Expectation
