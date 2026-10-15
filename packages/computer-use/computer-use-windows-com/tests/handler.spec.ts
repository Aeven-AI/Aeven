/**
 * The COM handler, and the end-to-end path it completes.
 *
 * The generated programs are checked without running them — they must attach to a
 * running instance rather than launch one, must embed values as single-quoted
 * literals, and must save through the host's own member when the operation does not
 * write the file itself.
 *
 * One test runs the **whole stack** against the real filesystem: recipe → router →
 * executor → handler → verify. The handler is a stub there, but the verification is
 * genuine, which is the property under test.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TaskExecutor } from '@aeven/computer-use-executor'
import type { MechanismRequest } from '@aeven/computer-use-executor'
import { STARTER_BOOK } from '@aeven/computer-use-router'
import {
  COM_APPLICATIONS,
  COM_MECHANISM,
  COM_OPERATIONS,
  createComHandler,
  powerShellLiteral,
  type ComRunner,
} from '../src/index.ts'

/** A runner that records programs and answers with prepared output. */
function runnerAnswering(stdout: string, code: number | null = 0, stderr = '') {
  const scripts: string[] = []
  const runner: ComRunner = {
    run: (script) => {
      scripts.push(script)
      return Promise.resolve({ code, stdout, stderr })
    },
  }
  return { runner, scripts }
}

// Typed as MechanismRequest on purpose: an inferred return type here would only
// describe what this helper happens to build, so a handler signature that drifted
// from the helper's shape would go unnoticed.
const request = (
  operation: string,
  parameters: Record<string, string> = {},
  app = 'Excel.Application',
): MechanismRequest => ({
  invocation: { mechanism: COM_MECHANISM, operation },
  parameters,
  app,
})

/** One call per operation the recipe book declares, with the parameters it needs. */
const CALLS: readonly { readonly operation: string; readonly parameters: Record<string, string> }[] = [
  { operation: 'Worksheets(sheet).Range(cell).Value2 = value', parameters: { sheet: 'Sheet1', cell: 'A1', value: '42' } },
  { operation: 'Worksheets(sheet).Range(cell).Formula = formula', parameters: { sheet: 'Sheet1', cell: 'B2', formula: '=SUM(A1:A9)' } },
  { operation: 'Range(address).Select()', parameters: { address: 'A1:C9' } },
  { operation: 'Worksheets.Add(After:=Worksheets(Count))', parameters: { name: 'Totals' } },
  { operation: 'Workbook.SaveAs2(path)', parameters: { path: 'C:\\out\\book.xlsx' } },
  { operation: 'Shapes.AddChart2(style, chartType, left, top, width, height).Chart.SetSourceData(Source:=Range(address))', parameters: { chartType: '51', address: 'A1:B9' } },
  { operation: 'ActiveDocument.Content.InsertAfter(text)', parameters: { text: 'The Cartographer of Small Hours' } },
  { operation: 'Selection.WholeStory(); Selection.Font.Name = family; Selection.Font.Size = size', parameters: { family: 'Georgia', size: '12' } },
  { operation: 'ExportAsFixedFormat(17, path)', parameters: { path: 'C:\\out\\report.pdf' } },
  { operation: 'Presentations(item).Slides(index).Shapes(shape).TextFrame.TextRange.Text = text', parameters: { index: '1', shape: '2', text: 'Slide one' } },
  { operation: 'Slides.Add(index, layout)', parameters: { index: '2', layout: '12' } },
  { operation: 'Slides(index).NotesPage.Shapes(2).TextFrame.TextRange.Text = text', parameters: { index: '1', text: 'Speaker note' } },
  { operation: 'SaveAs(path, 32)', parameters: { path: 'C:\\out\\deck.pdf' } },
]

/** The application each operation's recipe names, so the host resolves as it would in a run. */
const APPLICATION_FOR: Readonly<Record<string, string>> = {
  'ActiveDocument.Content.InsertAfter(text)': 'Word.Application',
  'Selection.WholeStory(); Selection.Font.Name = family; Selection.Font.Size = size': 'Word.Application',
  'ExportAsFixedFormat(17, path)': 'Word.Application',
  'Presentations(item).Slides(index).Shapes(shape).TextFrame.TextRange.Text = text': 'PowerPoint.Application',
  'Slides.Add(index, layout)': 'PowerPoint.Application',
  'Slides(index).NotesPage.Shapes(2).TextFrame.TextRange.Text = text': 'PowerPoint.Application',
  'SaveAs(path, 32)': 'PowerPoint.Application',
}

describe('value embedding', () => {
  it('produces a single-quoted literal, the only PowerShell form that does not interpolate', () => {
    expect(powerShellLiteral('plain')).toBe("'plain'")
    expect(powerShellLiteral('say "hi"')).toBe("'say \"hi\"'")
  })

  it('doubles a quote rather than ending the literal', () => {
    expect(powerShellLiteral("it's")).toBe("'it''s'")
    expect(powerShellLiteral("'; Remove-Item C:\\ -Recurse; '")).toBe("'''; Remove-Item C:\\ -Recurse; '''")
  })

  it('leaves a dollar sign literal, so a value cannot become a variable', () => {
    expect(powerShellLiteral('$(throw)')).toBe("'$(throw)'")
  })
})

describe('the generated program', () => {
  it('attaches to a running instance instead of launching one', () => {
    const { runner, scripts } = runnerAnswering('{"ok":true}')
    return createComHandler({ runner })(request(CALLS[0]!.operation, CALLS[0]!.parameters)).then(() => {
      expect(scripts[0]).toContain("[Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application')")
      expect(scripts[0]).not.toContain('New-Object -ComObject')
    })
  })

  it('refuses when the running application has no open document', () => {
    const { runner, scripts } = runnerAnswering('{"ok":true}')
    return createComHandler({ runner })(request(CALLS[0]!.operation, CALLS[0]!.parameters)).then(() => {
      expect(scripts[0]).toContain('$doc = $app.ActiveWorkbook')
      expect(scripts[0]).toContain('has no open document')
    })
  })

  it('performs the operation against the document the application exposes', async () => {
    const { runner, scripts } = runnerAnswering('{"ok":true}')
    await createComHandler({ runner })(request(
      'ActiveDocument.Content.InsertAfter(text)',
      { text: 'Zebra' },
      'Word.Application',
    ))
    expect(scripts[0]).toContain('$doc = $app.ActiveDocument')
    expect(scripts[0]).toContain("$doc.Content.InsertAfter('Zebra')")
  })

  it('performs the Word font statements against the application selection, not the document', async () => {
    const { runner, scripts } = runnerAnswering('{"ok":true}')
    await createComHandler({ runner })(request(
      'Selection.WholeStory(); Selection.Font.Name = family; Selection.Font.Size = size',
      { family: 'Georgia', size: '12' },
      'Word.Application',
    ))
    expect(scripts[0]).toContain('$app.Selection.WholeStory()')
    expect(scripts[0]).toContain("$app.Selection.Font.Name = 'Georgia'")
    expect(scripts[0]).toContain('$app.Selection.Font.Size = \'12\'')
  })

  it('saves through the host member when the operation leaves the document modified', async () => {
    const { runner, scripts } = runnerAnswering('{"ok":true}')
    await createComHandler({ runner })(request(
      'Worksheets(sheet).Range(cell).Value2 = value',
      { sheet: 'Sheet1', cell: 'A1', value: '42', path: 'C:\\out\\book.xlsx' },
    ))
    expect(scripts[0]).toContain("$doc.SaveAs2('C:\\out\\book.xlsx')")
  })

  it('uses the presentation member the object model actually has', async () => {
    const { runner, scripts } = runnerAnswering('{"ok":true}')
    await createComHandler({ runner })(request(
      'Slides.Add(index, layout)',
      { index: '2', layout: '12', path: 'C:\\out\\deck.pptx' },
      'PowerPoint.Application',
    ))
    expect(scripts[0]).toContain("$doc.SaveAs('C:\\out\\deck.pptx')")
  })

  it('does not save again when the operation writes the file itself', async () => {
    const { runner, scripts } = runnerAnswering('{"ok":true}')
    await createComHandler({ runner })(request('Workbook.SaveAs2(path)', { path: 'C:\\out\\book.xlsx' }))
    expect(scripts[0]).toContain("$doc.SaveAs2('C:\\out\\book.xlsx')")
    expect(scripts[0]!.match(/\$doc\.SaveAs2\(/gu)).toHaveLength(1)
  })

  it('does not save when the caller named no path', async () => {
    const { runner, scripts } = runnerAnswering('{"ok":true}')
    await createComHandler({ runner })(request(CALLS[2]!.operation, CALLS[2]!.parameters))
    expect(scripts[0]).not.toContain('$doc.SaveAs2(')
    expect(scripts[0]).not.toContain('$doc.SaveAs(')
  })

  it('does not save when the caller named an empty path', async () => {
    const { runner, scripts } = runnerAnswering('{"ok":true}')
    await createComHandler({ runner })(request(CALLS[2]!.operation, { ...CALLS[2]!.parameters, path: '' }))
    expect(scripts[0]).not.toContain('$doc.SaveAs2(')
  })

  it('releases the COM reference and prints one JSON object', async () => {
    const { runner, scripts } = runnerAnswering('{"ok":true,"path":"C:\\\\out\\\\book.xlsx"}')
    const result = await createComHandler({ runner })(request('Workbook.SaveAs2(path)', { path: 'C:\\out\\book.xlsx' }))
    expect(scripts[0]).toContain('ReleaseComObject($app)')
    expect(scripts[0]).toContain('ConvertTo-Json -Compress')
    expect(scripts[0]).toContain("path = 'C:\\out\\book.xlsx'")
    expect(result.observed).toBe('{"ok":true,"path":"C:\\\\out\\\\book.xlsx"}')
  })

  it('stops the program at the first failure rather than continuing', async () => {
    const { runner, scripts } = runnerAnswering('{"ok":true}')
    await createComHandler({ runner })(request(CALLS[0]!.operation, CALLS[0]!.parameters))
    expect(scripts[0]!.startsWith("$ErrorActionPreference = 'Stop'")).toBe(true)
  })
})

describe('dispatch', () => {
  it('implements every operation the recipe book names', () => {
    expect(COM_OPERATIONS).toHaveLength(CALLS.length)
    expect(COM_OPERATIONS).toEqual(CALLS.map(call => call.operation))
  })

  it.each(CALLS)('performs $operation', async ({ operation, parameters }) => {
    const { runner, scripts } = runnerAnswering('{"ok":true}')
    const handler = createComHandler({ runner })
    const result = await handler(request(operation, parameters, APPLICATION_FOR[operation] ?? 'Excel.Application'))
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain('GetActiveObject')
    expect(scripts[0]!.length).toBeGreaterThan(200)
    expect(result.notes).toEqual([`performed through ${APPLICATION_FOR[operation] ?? 'Excel.Application'} COM automation`])
  })

  it('names every application it drives when the request names another one', async () => {
    const { runner, scripts } = runnerAnswering('{}')
    const handler = createComHandler({ runner })
    await expect(handler(request(CALLS[0]!.operation, CALLS[0]!.parameters, 'Numbers')))
      .rejects.toThrow(/drives Excel\.Application, Word\.Application, PowerPoint\.Application; it was asked for "Numbers"/)
    expect(COM_APPLICATIONS).toEqual(['Excel.Application', 'Word.Application', 'PowerPoint.Application'])
    expect(scripts).toHaveLength(0)
  })

  it('names the application it drives when the request names none at all', async () => {
    const { runner } = runnerAnswering('{}')
    const handler = createComHandler({ runner })
    await expect(handler({
      invocation: { mechanism: COM_MECHANISM, operation: CALLS[0]!.operation },
      parameters: CALLS[0]!.parameters,
    })).rejects.toThrow(/it was asked for ""/)
  })

  it('refuses an operation it does not implement instead of silently doing nothing', async () => {
    const { runner, scripts } = runnerAnswering('{}')
    const handler = createComHandler({ runner })
    await expect(handler(request('deleteEverything()')))
      .rejects.toThrow(/does not implement "deleteEverything\(\)"/)
    expect(scripts).toHaveLength(0)
  })

  it.each([
    ['sheet', 'Worksheets(sheet).Range(cell).Value2 = value', { cell: 'A1', value: '42' }],
    ['cell', 'Worksheets(sheet).Range(cell).Value2 = value', { sheet: 'Sheet1', value: '42' }],
    ['value', 'Worksheets(sheet).Range(cell).Value2 = value', { sheet: 'Sheet1', cell: 'A1' }],
    ['formula', 'Worksheets(sheet).Range(cell).Formula = formula', { sheet: 'Sheet1', cell: 'A1' }],
    ['address', 'Range(address).Select()', {}],
    ['name', 'Worksheets.Add(After:=Worksheets(Count))', {}],
    ['path', 'Workbook.SaveAs2(path)', {}],
    ['chartType', 'Shapes.AddChart2(style, chartType, left, top, width, height).Chart.SetSourceData(Source:=Range(address))', { address: 'A1:B9' }],
    ['text', 'ActiveDocument.Content.InsertAfter(text)', {}],
    ['family', 'Selection.WholeStory(); Selection.Font.Name = family; Selection.Font.Size = size', { size: '12' }],
    ['size', 'Selection.WholeStory(); Selection.Font.Name = family; Selection.Font.Size = size', { family: 'Georgia' }],
    ['index', 'Slides.Add(index, layout)', { layout: '12' }],
    ['shape', 'Presentations(item).Slides(index).Shapes(shape).TextFrame.TextRange.Text = text', { index: '1', text: 'x' }],
    ['layout', 'Slides.Add(index, layout)', { index: '1' }],
  ] as const)('names the missing %s parameter rather than running a broken program', async (key, operation, parameters) => {
    const { runner, scripts } = runnerAnswering('{}')
    const handler = createComHandler({ runner })
    await expect(handler(request(operation, { ...parameters }, APPLICATION_FOR[operation] ?? 'Excel.Application')))
      .rejects.toThrow(new RegExp(`needs a ${key} parameter`))
    expect(scripts).toHaveLength(0)
  })

  it('reports a refused operation with the application and its message', async () => {
    const { runner } = runnerAnswering('', 1, 'Exception calling "GetActiveObject" with "1" argument(s)')
    const handler = createComHandler({ runner })
    await expect(handler(request('Workbook.SaveAs2(path)', { path: 'C:\\out\\book.xlsx' })))
      .rejects.toThrow(/Excel\.Application failed: Exception calling/)
  })

  it('reports a refused operation that explained nothing', async () => {
    const { runner } = runnerAnswering('', 1)
    const handler = createComHandler({ runner })
    await expect(handler(request('Workbook.SaveAs2(path)', { path: 'C:\\out\\book.xlsx' })))
      .rejects.toThrow(/Excel\.Application failed without reporting a reason/)
  })

  it('does not call the runner for an operation it refused', async () => {
    const run = vi.fn(() => Promise.resolve({ code: 0, stdout: '{}', stderr: '' }))
    const handler = createComHandler({ runner: { run } })
    await expect(handler(request('unknownOp()'))).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })

  it('uses a caller-supplied encoder when one is given', async () => {
    const { runner, scripts } = runnerAnswering('{"ok":true}')
    const handler = createComHandler({ runner, literal: value => `[${value}]` })
    await handler(request('Workbook.SaveAs2(path)', { path: 'C:\\out\\book.xlsx' }))
    expect(scripts[0]).toContain('$doc.SaveAs2([C:\\out\\book.xlsx])')
    expect(scripts[0]).toContain('GetActiveObject([Excel.Application])')
  })
})

describe('end to end through router, executor and handler', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aeven-com-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('resolves the book, runs the handler, and verifies from disk', async () => {
    const path = join(dir, 'book.xlsx')
    // The handler stands in for Excel: it writes exactly what the operation would
    // have written, so the verification below is exercised for real.
    const executor = new TaskExecutor({
      book: STARTER_BOOK,
      handlers: {
        com: async ({ parameters }) => {
          await writeFile(parameters.path as string, 'workbook', 'utf8')
          return { observed: `wrote ${parameters.path as string}` }
        },
      },
    })
    const outcome = await executor.execute({
      task: 'spreadsheet.saveAs',
      platform: 'win32',
      app: 'Excel.Application',
      parameters: { path },
    })
    expect(outcome.verified).toBe(true)
    expect(outcome.rung).toBe('semantic')
    expect(outcome.mechanism).toBe(COM_MECHANISM)
  })

  it('resolves a Windows spreadsheet task to the COM mechanism without a handler', () => {
    const executor = new TaskExecutor({ book: STARTER_BOOK })
    const resolved = executor.routing.resolve({ task: 'spreadsheet.setCell', platform: 'win32', app: 'Excel.Application' })
    expect(resolved.invocation.mechanism).toBe(COM_MECHANISM)
    expect(resolved.rung).toBe('semantic')
    expect(resolved.evidence).toBe('documented')
  })

  it('refuses the mechanism when no handler performs it', async () => {
    await expect(new TaskExecutor({ book: STARTER_BOOK }).execute({
      task: 'spreadsheet.saveAs',
      platform: 'win32',
      app: 'Excel.Application',
      parameters: { path: join(dir, 'unwritten.xlsx') },
    })).rejects.toThrow(/no handler performs the "com" mechanism/)
  })
})
