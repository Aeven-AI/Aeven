/**
 * Office and LibreOffice recipes.
 *
 * These are the programs most people actually use, and the rung that matters for
 * them is **semantic**, not accessibility and certainly not vision: a cell write
 * is one COM member call on Windows and one UNO call on Linux, where the same
 * operation through the ribbon is a sequence of clicks, keystrokes, and dialogs.
 * Encoding the cheap path is the entire reason this file exists.
 *
 * **Everything here is `documented`, not `verified`.** COM and UNO are stable and
 * well documented, and the operations below are their canonical entry points — but
 * no test in this repository has driven a live Excel, Word, PowerPoint, or
 * LibreOffice. The evidence tag says so, and the router surfaces it, so a consumer
 * cannot mistake these for measured coverage.
 *
 * **Verification is weaker here than for the macOS recipes, deliberately.**
 * Office files are OOXML zips and `.odt`/`.ods` are zips of XML, so a text search
 * of the raw bytes is not a reliable assertion that a *cell* or a *slide* holds a
 * value. Rather than assert something that would pass for the wrong reason, these
 * recipes verify what is honestly checkable — that the file was written — and
 * leave content verification to the consumer's own semantic read-back. A recipe
 * whose check cannot fail is worse than no check.
 *
 * Task vocabulary cross-checked against `microsoft/cua_skill`'s per-application
 * action modules (Excel, Word, PowerPoint), which enumerate the same operations
 * from the UI side.
 *
 * @module @aeven/computer-use-router/office
 */

import type { RecipeBook } from './recipe.ts'

/** Spreadsheet tasks, per platform. */
export const SPREADSHEET_RECIPES: RecipeBook = [
  {
    task: 'spreadsheet.setCell',
    summary: 'Set one cell of a spreadsheet to a value.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'win32',
        rung: 'semantic',
        apps: ['Excel.Application'],
        evidence: 'documented',
        invocation: {
          mechanism: 'com',
          operation: 'Worksheets(sheet).Range(cell).Value2 = value',
          parameters: { sheet: 'Sheet1', cell: '{cell}', value: '{value}' },
        },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: ['libreoffice', 'soffice'],
        evidence: 'documented',
        invocation: {
          mechanism: 'dbus',
          operation: 'UNO: sheet.getCellByPosition(column, row).setValue(value)',
          parameters: { sheet: 'Sheet1', cell: '{cell}', value: '{value}' },
        },
      },
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Numbers'],
        evidence: 'documented',
        invocation: {
          mechanism: 'apple-events',
          operation: 'Numbers: table cell value',
          parameters: { cell: '{cell}', value: '{value}' },
        },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
  {
    task: 'spreadsheet.setFormula',
    summary: 'Set a cell to a formula.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'win32',
        rung: 'semantic',
        apps: ['Excel.Application'],
        evidence: 'documented',
        invocation: {
          mechanism: 'com',
          operation: 'Worksheets(sheet).Range(cell).Formula = formula',
          parameters: { sheet: 'Sheet1', cell: '{cell}', formula: '{formula}' },
        },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: ['libreoffice', 'soffice'],
        evidence: 'documented',
        invocation: {
          mechanism: 'dbus',
          operation: 'UNO: sheet.getCellByPosition(column, row).setFormula(formula)',
          parameters: { sheet: 'Sheet1', cell: '{cell}', formula: '{formula}' },
        },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
  {
    task: 'spreadsheet.selectRange',
    summary: 'Select a range of cells as the current selection.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'win32',
        rung: 'semantic',
        apps: ['Excel.Application'],
        evidence: 'documented',
        invocation: { mechanism: 'com', operation: 'Range(address).Select()', parameters: { address: '{address}' } },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: ['libreoffice', 'soffice'],
        evidence: 'documented',
        invocation: {
          mechanism: 'dbus',
          operation: 'UNO: controller.select(getCellRangeByName(address))',
          parameters: { address: '{address}' },
        },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
  {
    task: 'spreadsheet.createSheet',
    summary: 'Add a sheet to the workbook.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'win32',
        rung: 'semantic',
        apps: ['Excel.Application'],
        evidence: 'documented',
        invocation: { mechanism: 'com', operation: 'Worksheets.Add(After:=Worksheets(Count))', parameters: { name: '{name}' } },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: ['libreoffice', 'soffice'],
        evidence: 'documented',
        invocation: { mechanism: 'dbus', operation: 'UNO: sheets.insertNewByName(name, count)', parameters: { name: '{name}' } },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
  {
    task: 'spreadsheet.saveAs',
    summary: 'Save the workbook to a path.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'win32',
        rung: 'semantic',
        apps: ['Excel.Application'],
        evidence: 'documented',
        invocation: { mechanism: 'com', operation: 'Workbook.SaveAs2(path)', parameters: { path: '{path}' } },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: ['libreoffice', 'soffice'],
        evidence: 'documented',
        invocation: { mechanism: 'dbus', operation: 'UNO: document.storeToURL(path)', parameters: { path: '{path}' } },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
  {
    task: 'spreadsheet.createChart',
    summary: 'Create a chart from a range.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'win32',
        rung: 'semantic',
        apps: ['Excel.Application'],
        evidence: 'documented',
        // The chart-type constant is a documented enum member; naming it in
        // `knownBlind` keeps a caller from expecting a chart *kind* it cannot ask for.
        knownBlind: ['spreadsheet.chartTypesBeyondTheDocumentedEnum'],
        invocation: {
          mechanism: 'com',
          operation: 'Shapes.AddChart2(style, chartType, left, top, width, height).Chart.SetSourceData(Source:=Range(address))',
          parameters: { chartType: '{chartType}', address: '{address}' },
        },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: ['libreoffice', 'soffice'],
        evidence: 'documented',
        invocation: {
          mechanism: 'dbus',
          operation: 'UNO: charts.addNewByName(name, rect, ranges, columnHeaders, rowHeaders)',
          parameters: { name: '{name}', address: '{address}' },
        },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
]

/** Word-processor tasks, per platform. */
export const DOCUMENT_RECIPES: RecipeBook = [
  {
    task: 'document.appendText',
    summary: 'Append text to the open document.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'win32',
        rung: 'semantic',
        apps: ['Word.Application'],
        evidence: 'documented',
        invocation: {
          mechanism: 'com',
          operation: 'ActiveDocument.Content.InsertAfter(text)',
          parameters: { text: '{text}' },
        },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: ['libreoffice', 'soffice'],
        evidence: 'documented',
        invocation: {
          mechanism: 'dbus',
          operation: 'UNO: text.insertString(cursor, text, false)',
          parameters: { text: '{text}' },
        },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
  {
    task: 'document.setFont',
    summary: 'Set the font family and size of the document text.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'win32',
        rung: 'semantic',
        apps: ['Word.Application'],
        evidence: 'documented',
        invocation: {
          mechanism: 'com',
          operation: 'Selection.WholeStory(); Selection.Font.Name = family; Selection.Font.Size = size',
          parameters: { family: '{family}', size: '{size}' },
        },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: ['libreoffice', 'soffice'],
        evidence: 'documented',
        invocation: {
          mechanism: 'dbus',
          operation: 'UNO: cursor.setPropertyValue("CharFontName", family); cursor.setPropertyValue("CharHeight", size)',
          parameters: { family: '{family}', size: '{size}' },
        },
      },
      {
        platform: 'darwin',
        rung: 'accessibility',
        apps: ['com.apple.Pages'],
        evidence: 'documented',
        // Measured: the Pages scripting bridge cannot reach paragraph or font
        // attributes at all, so this task has no semantic rung on macOS.
        knownBlind: ['document.setFontSemantically'],
        invocation: { mechanism: 'ax', operation: 'setValue on the Format inspector font control', parameters: { family: '{family}' } },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
  {
    task: 'document.exportPdf',
    summary: 'Export the document to PDF.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'win32',
        rung: 'semantic',
        apps: ['Word.Application'],
        evidence: 'documented',
        invocation: { mechanism: 'com', operation: 'ExportAsFixedFormat(17, path)', parameters: { path: '{path}' } },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: ['libreoffice', 'soffice'],
        evidence: 'documented',
        invocation: { mechanism: 'dbus', operation: 'UNO: storeToURL(path, FilterName="writer_pdf_Export")', parameters: { path: '{path}' } },
      },
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Pages'],
        evidence: 'documented',
        invocation: { mechanism: 'apple-events', operation: 'Pages: export as PDF', parameters: { path: '{path}' } },
      },
    ],
    // A PDF is checkable by its own bytes, which the OOXML and ODF containers are
    // not, so this one asserts the format rather than only the file's existence.
    verify: [
      { kind: 'fileExists', path: '{path}' },
      { kind: 'fileContains', path: '{path}', text: '%PDF' },
    ],
  },
]

/** Presentation tasks, per platform. */
export const PRESENTATION_RECIPES: RecipeBook = [
  {
    task: 'slide.setText',
    summary: 'Set the text of a shape on a slide.',
    deliverable: 'open-application',
    on: [
      {
        // macOS is listed first because this is the one operand a handler in this
        // repository actually implements, and it was measured against live Keynote.
        // Rows below are the documented target vocabulary for platforms whose
        // adapters have not been verified on a real host.
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Keynote'],
        evidence: 'verified',
        invocation: {
          mechanism: 'apple-events',
          operation: 'keynote.setSlideText',
          parameters: { path: '{path}', slideIndex: '{index}', textItem: '{shape}', text: '{text}' },
        },
      },
      {
        platform: 'win32',
        rung: 'semantic',
        apps: ['PowerPoint.Application'],
        evidence: 'documented',
        invocation: {
          mechanism: 'com',
          operation: 'Presentations(item).Slides(index).Shapes(shape).TextFrame.TextRange.Text = text',
          parameters: { index: '{index}', shape: '{shape}', text: '{text}' },
        },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: ['libreoffice', 'soffice'],
        evidence: 'documented',
        invocation: {
          mechanism: 'dbus',
          operation: 'UNO: slide.getByIndex(index).setText(text)',
          parameters: { index: '{index}', text: '{text}' },
        },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
  {
    task: 'slide.addSlide',
    summary: 'Add a slide to the presentation.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'win32',
        rung: 'semantic',
        apps: ['PowerPoint.Application'],
        evidence: 'documented',
        invocation: { mechanism: 'com', operation: 'Slides.Add(index, layout)', parameters: { index: '{index}', layout: '{layout}' } },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: ['libreoffice', 'soffice'],
        evidence: 'documented',
        invocation: { mechanism: 'dbus', operation: 'UNO: pages.insertNewByIndex(index)', parameters: { index: '{index}' } },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
  {
    task: 'slide.addSpeakerNote',
    summary: 'Set the speaker notes for a slide.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'win32',
        rung: 'semantic',
        apps: ['PowerPoint.Application'],
        evidence: 'documented',
        invocation: {
          mechanism: 'com',
          operation: 'Slides(index).NotesPage.Shapes(2).TextFrame.TextRange.Text = text',
          parameters: { index: '{index}', text: '{text}' },
        },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: ['libreoffice', 'soffice'],
        evidence: 'documented',
        invocation: {
          mechanism: 'dbus',
          operation: 'UNO: notes = page.getNotes(); notes.setText(text)',
          parameters: { index: '{index}', text: '{text}' },
        },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
  {
    task: 'presentation.exportPdf',
    summary: 'Export the presentation to PDF.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'win32',
        rung: 'semantic',
        apps: ['PowerPoint.Application'],
        evidence: 'documented',
        invocation: { mechanism: 'com', operation: 'SaveAs(path, 32)', parameters: { path: '{path}' } },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: ['libreoffice', 'soffice'],
        evidence: 'documented',
        invocation: { mechanism: 'dbus', operation: 'UNO: storeToURL(path, FilterName="impress_pdf_Export")', parameters: { path: '{path}' } },
      },
    ],
    verify: [
      { kind: 'fileExists', path: '{path}' },
      { kind: 'fileContains', path: '{path}', text: '%PDF' },
    ],
  },
]

/**
 * Every Office and LibreOffice recipe.
 *
 * Grouped so a consumer can mount only the set it needs, and so the tests can
 * assert the properties these entries must hold: documented evidence, a semantic
 * rung wherever one exists, and a verification expectation on every task.
 */
export const OFFICE_RECIPES: RecipeBook = [
  ...SPREADSHEET_RECIPES,
  ...DOCUMENT_RECIPES,
  ...PRESENTATION_RECIPES,
]
