/**
 * The COM mechanism for Windows.
 *
 * Registered with `@aeven/computer-use-executor` by a consumer that knows it is on
 * Windows. It performs a recipe's operation against an Office application's
 * automation model through PowerShell, because that is what the semantic rung means
 * on this platform: a cell write is one COM member call where the ribbon is a
 * sequence of clicks, keystrokes, and dialogs.
 *
 * Three things it deliberately does not do.
 *
 * It does not treat its own output as a verdict. A handler reports what it
 * observed; the executor decides, by re-reading an independent observable that the
 * recipe names. That separation is what catches a save reporting success while
 * writing nothing.
 *
 * It does not start the application, and that is the reason every operation here is
 * written against `$app.ActiveWorkbook`, `$app.ActiveDocument`, or
 * `$app.ActivePresentation`: the recipe book's Windows operations are phrased
 * against the running instance (`ActiveDocument`, `Selection`, `Presentations`), so
 * the handler attaches with `GetActiveObject` and refuses by name when there is no
 * instance to attach to. Attaching also sidesteps PowerPoint's refusal to run
 * hidden, which a `New-Object` launch would have to satisfy.
 *
 * It does not attempt an operation it does not implement. A recipe naming an
 * operation nothing implements is a bug worth surfacing, not a silence worth
 * tolerating.
 *
 * ## Evidence status
 *
 * The book marks these recipes `documented` rather than `verified` because no test
 * in this repository has driven a live Excel, Word, or PowerPoint on Windows. This
 * handler keeps that honesty rather than implying more: its tests assert the
 * generated program and the dispatch behaviour against a recording runner, and the
 * README names the parts that still need a Windows host with Office installed.
 *
 * @module @aeven/computer-use-windows-com
 */

import type { MechanismHandler, MechanismResult } from '@aeven/computer-use-executor'

/** Runs one PowerShell program and reports its streams. */
export interface ComRunner {
  /**
   * @param script - the program source to run.
   * @param signal - cancellation of the calling batch.
   * @returns the process streams; a non-zero exit resolves rather than rejects,
   * because PowerShell reports a failed operation through its exit status and a
   * caller needs the status and the message together.
   */
  run(script: string, signal?: AbortSignal): Promise<{ code: number | null; stdout: string; stderr: string }>
}

/** Options for constructing the handler. */
export interface ComHandlerOptions {
  runner: ComRunner
  /**
   * How a value is embedded in the generated program. Defaults to a PowerShell
   * single-quoted literal, which performs no interpolation, so a document
   * containing `$` or `"` cannot change what the program does.
   */
  literal?: (value: string) => string
}

/**
 * The mechanism name this handler registers under.
 *
 * Exported so a consumer registers it without repeating the string, and because
 * the name must match what the recipe book declares.
 */
export const COM_MECHANISM = 'com'

/** One Office application the recipe book drives over COM. */
interface ComHost {
  /** The automation identifier `GetActiveObject` attaches with. */
  readonly progId: string
  /** The PowerShell expression for the open document a recipe's operation acts on. */
  readonly document: string
  /** The member that saves that document to a new path. */
  readonly saveAs: string
}

/**
 * The applications the recipe book's Windows entries name, keyed by the identifier
 * a request carries.
 *
 * The document expression is per host rather than generic because COM exposes no
 * common base for them: a workbook, a document, and a presentation are three
 * unrelated object models that happen to share verbs.
 */
const HOSTS: Readonly<Record<string, ComHost>> = {
  'Excel.Application': { progId: 'Excel.Application', document: '$app.ActiveWorkbook', saveAs: 'SaveAs2' },
  'Word.Application': { progId: 'Word.Application', document: '$app.ActiveDocument', saveAs: 'SaveAs2' },
  'PowerPoint.Application': { progId: 'PowerPoint.Application', document: '$app.ActivePresentation', saveAs: 'SaveAs' },
}

/** The application identifiers this handler accepts, for diagnostics. */
export const COM_APPLICATIONS: readonly string[] = Object.keys(HOSTS)

/**
 * Escape a value for embedding as a PowerShell single-quoted literal.
 *
 * A single-quoted PowerShell string is the only form that performs no
 * interpolation: `$name`, backticks, and `"` are literal, and the one escape the
 * form has is a doubled quote. Hand-rolled escaping is avoided for exactly the
 * reason a document's own text can contain any of those characters.
 * @param value - the raw value.
 * @returns the literal, including its quotes.
 */
export function powerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Read a required parameter, naming it when it is absent.
 * @param parameters - the resolved parameters for this call.
 * @param key - the parameter the operation needs.
 * @returns the value.
 * @throws {Error} when the caller did not supply the parameter.
 */
function required(parameters: Readonly<Record<string, string>>, key: string): string {
  const value = parameters[key]
  if (value === undefined || value === '') {
    throw new Error(`the COM operation needs a ${key} parameter`)
  }
  return value
}

/** One operation the recipe book names, and the program that performs it. */
interface OperationPlan {
  /**
   * Statements performing the work, against `$app` and `$doc`. Values are embedded
   * with {@link powerShellLiteral} by the caller through `literal`.
   * @param parameters - the resolved parameters for this call.
   * @param literal - the encoder for values embedded in the program.
   * @returns the PowerShell statements.
   */
  readonly statements: (parameters: Readonly<Record<string, string>>, literal: (value: string) => string) => string
  /**
   * Whether the operation writes the named file itself. When it does, the wrapper
   * does not save again; the operation's own member call is the save.
   */
  readonly writesFile?: boolean
}

/**
 * A whole story in the document, from the selection to the selection.
 *
 * `Selection.WholeStory()` is what makes the font statements apply to the document
 * rather than to wherever the caret happened to be.
 */
const SELECT_WHOLE_STORY = 'Selection.WholeStory(); Selection.Font.Name = family; Selection.Font.Size = size'

/** The operations this handler implements, keyed by the recipe book's own strings. */
const OPERATIONS: ReadonlyMap<string, OperationPlan> = new Map<string, OperationPlan>([
  ['Worksheets(sheet).Range(cell).Value2 = value', { statements: (p, literal) => [
    `$doc.Worksheets.Item(${literal(required(p, 'sheet'))}).Range(${literal(required(p, 'cell'))}).Value2 = ${literal(required(p, 'value'))}`,
  ].join('\n') }],
  ['Worksheets(sheet).Range(cell).Formula = formula', { statements: (p, literal) => [
    `$doc.Worksheets.Item(${literal(required(p, 'sheet'))}).Range(${literal(required(p, 'cell'))}).Formula = ${literal(required(p, 'formula'))}`,
  ].join('\n') }],
  ['Range(address).Select()', { statements: (p, literal) => [
    `$doc.ActiveSheet.Range(${literal(required(p, 'address'))}).Select()`,
  ].join('\n') }],
  ['Worksheets.Add(After:=Worksheets(Count))', { statements: (p, literal) => [
    '$added = $doc.Worksheets.Add([Type]::Missing, $doc.Worksheets.Item($doc.Worksheets.Count))',
    `$added.Name = ${literal(required(p, 'name'))}`,
  ].join('\n') }],
  ['Workbook.SaveAs2(path)', { writesFile: true, statements: (p, literal) => [
    `$doc.SaveAs2(${literal(required(p, 'path'))})`,
  ].join('\n') }],
  ['Shapes.AddChart2(style, chartType, left, top, width, height).Chart.SetSourceData(Source:=Range(address))', {
    statements: (p, literal) => [
      `$chart = $doc.ActiveSheet.Shapes.AddChart2(-1, ${literal(required(p, 'chartType'))}).Chart`,
      `$chart.SetSourceData($doc.ActiveSheet.Range(${literal(required(p, 'address'))}))`,
    ].join('\n'),
  }],
  ['ActiveDocument.Content.InsertAfter(text)', { statements: (p, literal) => [
    `$doc.Content.InsertAfter(${literal(required(p, 'text'))})`,
  ].join('\n') }],
  [SELECT_WHOLE_STORY, { statements: (p, literal) => [
    '$app.Selection.WholeStory()',
    `$app.Selection.Font.Name = ${literal(required(p, 'family'))}`,
    `$app.Selection.Font.Size = ${literal(required(p, 'size'))}`,
  ].join('\n') }],
  ['ExportAsFixedFormat(17, path)', { writesFile: true, statements: (p, literal) => [
    `$doc.ExportAsFixedFormat(17, ${literal(required(p, 'path'))})`,
  ].join('\n') }],
  ['Presentations(item).Slides(index).Shapes(shape).TextFrame.TextRange.Text = text', { statements: (p, literal) => [
    `$doc.Slides.Item([int]${literal(required(p, 'index'))}).Shapes.Item([int]${literal(required(p, 'shape'))}).TextFrame.TextRange.Text = ${literal(required(p, 'text'))}`,
  ].join('\n') }],
  ['Slides.Add(index, layout)', { statements: (p, literal) => [
    `[void]$doc.Slides.Add([int]${literal(required(p, 'index'))}, [int]${literal(required(p, 'layout'))})`,
  ].join('\n') }],
  ['Slides(index).NotesPage.Shapes(2).TextFrame.TextRange.Text = text', { statements: (p, literal) => [
    `$doc.Slides.Item([int]${literal(required(p, 'index'))}).NotesPage.Shapes.Item(2).TextFrame.TextRange.Text = ${literal(required(p, 'text'))}`,
  ].join('\n') }],
  ['SaveAs(path, 32)', { writesFile: true, statements: (p, literal) => [
    `$doc.SaveAs(${literal(required(p, 'path'))}, 32)`,
  ].join('\n') }],
])

/** The operations this handler implements, for diagnostics and tests. */
export const COM_OPERATIONS: readonly string[] = [...OPERATIONS.keys()]

/**
 * Build the program that performs one operation and reports what happened.
 *
 * The program attaches to a running instance instead of launching one, performs the
 * statements, saves to the caller's `path` unless the operation already wrote that
 * file, releases the COM reference, and prints one JSON object. A failure surfaces
 * as a non-zero exit with PowerShell's own message on stderr rather than as a
 * silent success, which is what the executor's independent verification is built
 * on top of.
 * @param host - the application and document the operation acts on.
 * @param plan - the statements for the operation.
 * @param parameters - the resolved parameters for this call.
 * @param literal - the encoder for values embedded in the program.
 * @returns the PowerShell source.
 */
function buildScript(
  host: ComHost,
  plan: OperationPlan,
  parameters: Readonly<Record<string, string>>,
  literal: (value: string) => string,
): string {
  const path = parameters.path
  const save: string[] = []
  if (plan.writesFile !== true && path !== undefined && path !== '') {
    save.push(`$doc.${host.saveAs}(${literal(path)})`)
  }
  const written = path === undefined || path === '' ? '$null' : literal(path)
  return `
$ErrorActionPreference = 'Stop'
try {
  $app = [Runtime.InteropServices.Marshal]::GetActiveObject(${literal(host.progId)})
} catch {
  throw "no running ${host.progId}: open the application with the document this task needs, then retry"
}
$doc = ${host.document}
if ($null -eq $doc) { throw "the running ${host.progId} has no open document" }
${plan.statements(parameters, literal)}
${save.join('\n')}
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{ ok = $true; path = ${written} }))
`.trimStart()
}

/**
 * Build the handler for the COM mechanism.
 *
 * Operations are matched by name against the vocabulary the recipe book uses, and an
 * unrecognised operation is refused rather than attempted.
 * @param options - the runner and optional literal encoder.
 * @returns the mechanism handler.
 */
export function createComHandler(options: ComHandlerOptions): MechanismHandler {
  const literal = options.literal ?? powerShellLiteral
  return async (request): Promise<MechanismResult> => {
    const { operation } = request.invocation
    const app = request.app ?? ''
    const host = HOSTS[app]
    if (host === undefined) {
      throw new Error(`the COM handler drives ${COM_APPLICATIONS.join(', ')}; it was asked for "${app}"`)
    }
    const plan = OPERATIONS.get(operation)
    if (plan === undefined) {
      throw new Error(`the COM handler does not implement "${operation}"`)
    }
    const result = await options.runner.run(buildScript(host, plan, request.parameters, literal), request.signal)
    if (result.code !== 0) {
      const detail = result.stderr.trim()
      throw new Error(detail.length > 0 ? `${host.progId} failed: ${detail}` : `${host.progId} failed without reporting a reason`)
    }
    return {
      observed: result.stdout.trim(),
      notes: [`performed through ${host.progId} COM automation`],
    }
  }
}
