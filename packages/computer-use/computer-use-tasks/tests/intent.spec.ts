/**
 * The task-intent importer.
 *
 * The fixtures are trimmed copies of each source's real shape, kept small enough to
 * read. The properties under test are the ones that decide whether the catalog is
 * trustworthy: that each source's vocabulary is read correctly, that a file which
 * is not a task is skipped rather than counted, and that a file which fails to
 * parse is reported rather than dropped.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  checkVocabulary,
  countBySource,
  fromMacAgentBench,
  fromOsworld,
  groupByApp,
  listJsonFiles,
  readTaskFile,
  readTaskSet,
  readTaskSets,
  renderCatalog,
  type TaskIntent,
} from '../src/index.ts'
import { allTools, groupByFamily, readToolCatalog } from '../src/tools.ts'
import {
  canonicalDomain,
  harnessOnlyCount,
  isHarnessDomain,
  normalizeIntent,
  renameReport,
} from '../src/normalize.ts'

/** An OSWorld-shaped task, trimmed to the fields the importer reads. */
const OSWORLD_CALC = {
  id: '01b269ae-2111-4a07-81fd-3fcd711993b0',
  snapshot: 'libreoffice_calc',
  instruction: 'Fill all the blank cells in B1:E30 with the value in the cell above it.',
  config: [
    { type: 'download', parameters: { files: [] } },
    { type: 'open', parameters: { path: '/home/user/x.xlsx' } },
  ],
  trajectory: 'trajectories/01b269ae',
  related_apps: ['libreoffice calc'],
  evaluator: {
    func: 'compare_table',
    postconfig: [{ type: 'activate_window' }, { type: 'sleep' }],
  },
}

/** A MacAgentBench-shaped task. */
const MAC_CALENDAR = {
  id: '1_1',
  system_img: 'default',
  instruction: "In the Calendar App, create a recurring event called 'Lab Meeting' every Monday at 10:00AM.",
  config: [{ type: 'cmd', parameters: { command: ["open -a 'Calendar'"] } }],
  related_apps: ['calendar'],
  evaluator: {
    func: ['calendar_check_weekly_event'],
    conj: 'and',
    parameters: [{ event_name: 'Lab Meeting', start_hour: 10, start_minute: 0, day: 'Monday' }],
    expected: [{ type: 'common', rules: { func: 'is_true', parameters: [] } }],
  },
}

describe('reading the OSWorld shape', () => {
  it('normalizes the instruction, apps, setup and end-state check', () => {
    const intent = fromOsworld(OSWORLD_CALC)
    expect(intent.source).toBe('osworld')
    expect(intent.id).toBe('01b269ae-2111-4a07-81fd-3fcd711993b0')
    expect(intent.instruction).toContain('Fill all the blank cells')
    expect(intent.apps).toEqual(['libreoffice calc'])
    expect(intent.setupTypes).toEqual(['download', 'open'])
    expect(intent.hasTrajectory).toBe(true)
  })

  it('collects the evaluator function and its post-configuration steps as checks', () => {
    expect(fromOsworld(OSWORLD_CALC).checks).toEqual(['compare_table', 'activate_window', 'sleep'])
  })

  it('records the Windows variant as its own source, since it shares the shape', () => {
    expect(fromOsworld(OSWORLD_CALC, 'windowsagentarena').source).toBe('windowsagentarena')
  })

  it('tolerates a task with no evaluator rather than throwing', () => {
    const intent = fromOsworld({ id: 'x', instruction: 'do something' })
    expect(intent.checks).toEqual([])
    expect(intent.setupTypes).toEqual([])
    expect(intent.hasTrajectory).toBe(false)
  })

  it('ignores a setup array that is not an array', () => {
    expect(fromOsworld({ id: 'x', instruction: 'y', config: 'nonsense' }).setupTypes).toEqual([])
  })

  it('drops non-string entries from a string array', () => {
    expect(fromOsworld({ id: 'x', instruction: 'y', related_apps: ['calc', 7, null] }).apps).toEqual(['calc'])
  })
})

describe('reading the MacAgentBench shape', () => {
  it('normalizes the instruction and app', () => {
    const intent = fromMacAgentBench(MAC_CALENDAR)
    expect(intent.source).toBe('macagentbench')
    expect(intent.apps).toEqual(['calendar'])
    expect(intent.setupTypes).toEqual(['cmd'])
  })

  it('reads the check function name, which states the semantic end state', () => {
    expect(fromMacAgentBench(MAC_CALENDAR).checks).toContain('calendar_check_weekly_event')
  })

  it('also collects the expected-rule functions', () => {
    expect(fromMacAgentBench(MAC_CALENDAR).checks).toContain('is_true')
  })

  it('tolerates expected entries that carry no rules', () => {
    const intent = fromMacAgentBench({ id: 'x', instruction: 'y', evaluator: { expected: [{ type: 'common' }] } })
    expect(intent.checks).toEqual([])
  })

  it('tolerates an evaluator whose expected field is not an array', () => {
    expect(fromMacAgentBench({ id: 'x', instruction: 'y', evaluator: { expected: 'nope' } }).checks).toEqual([])
  })
})

describe('walking a task-set directory', () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'aeven-tasks-'))
    await mkdir(join(root, 'calendar'), { recursive: true })
    await mkdir(join(root, 'pages'), { recursive: true })
    await writeFile(join(root, 'calendar', '1_1.json'), JSON.stringify(MAC_CALENDAR))
    await writeFile(join(root, 'pages', '2_1.json'), JSON.stringify({ ...MAC_CALENDAR, id: '2_1', related_apps: ['pages'] }))
    // Not a task, and not an error either.
    await writeFile(join(root, 'metadata.json'), JSON.stringify({ version: 1 }))
    // Genuinely broken, and must be reported.
    await writeFile(join(root, 'calendar', 'broken.json'), '{ not json')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists every json file, sorted', () => {
    const files = listJsonFiles(root)
    expect(files).toHaveLength(4)
    const names = files.map(file => file.slice(root.length + 1))
    expect(names).toEqual([...names].sort())
    expect(names).toContain(join('calendar', 'broken.json'))
    expect(names).toContain('metadata.json')
  })

  it('returns an empty list for a directory that does not exist instead of throwing', () => {
    expect(listJsonFiles(join(root, 'nope'))).toEqual([])
  })

  it('reads the tasks and skips the non-task file', () => {
    const result = readTaskSet(root, 'macagentbench')
    expect(result.intents).toHaveLength(2)
    expect(result.intents.map(intent => intent.id).sort()).toEqual(['1_1', '2_1'])
  })

  it('reports the file that failed to parse rather than dropping it silently', () => {
    const result = readTaskSet(root, 'macagentbench')
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.path.endsWith('broken.json')).toBe(true)
  })

  it('skips a json file with no id and instruction pair, since that is not a failure', () => {
    const result = readTaskFile(join(root, 'metadata.json'), 'macagentbench')
    expect(result.intent).toBeUndefined()
    expect(result.skipped).toContain('not a task file')
    expect(result.failure).toBeUndefined()
  })

  it('reports a JSON array as skipped rather than as a task', () => {
    const result = readTaskFile(join(root, 'metadata.json'), 'macagentbench')
    expect(result.skipped).toBeDefined()
  })
})

describe('merging sources', () => {
  let rootA: string
  let rootB: string

  beforeAll(async () => {
    rootA = await mkdtemp(join(tmpdir(), 'aeven-src-a-'))
    rootB = await mkdtemp(join(tmpdir(), 'aeven-src-b-'))
    await writeFile(join(rootA, 'a.json'), JSON.stringify(OSWORLD_CALC))
    await writeFile(join(rootB, 'b.json'), JSON.stringify(MAC_CALENDAR))
  })

  afterAll(async () => {
    await rm(rootA, { recursive: true, force: true })
    await rm(rootB, { recursive: true, force: true })
  })

  it('merges intents from several sources', () => {
    const result = readTaskSets([{ root: rootA, source: 'osworld' }, { root: rootB, source: 'macagentbench' }])
    expect(result.intents).toHaveLength(2)
    expect(countBySource(result.intents)).toEqual({ osworld: 1, macagentbench: 1, windowsagentarena: 0 })
  })
})

describe('catalog reporting', () => {
  const intents: TaskIntent[] = [fromOsworld(OSWORLD_CALC), fromMacAgentBench(MAC_CALENDAR)]

  it('groups by application, listing a task under each app it names', () => {
    const groups = groupByApp(intents)
    expect([...groups.keys()]).toEqual(['calendar', 'libreoffice calc'])
    expect(groups.get('calendar')).toHaveLength(1)
  })

  it('counts by source', () => {
    expect(countBySource(intents)).toEqual({ osworld: 1, macagentbench: 1, windowsagentarena: 0 })
  })

  it('ranks the end-state check vocabulary by how many tasks use it', () => {
    const vocabulary = checkVocabulary(intents)
    expect(vocabulary.get('is_true')).toBe(1)
    expect(vocabulary.get('compare_table')).toBe(1)
    expect(vocabulary.get('calendar_check_weekly_event')).toBe(1)
  })

  it('renders a catalog with counts, intents and the check vocabulary', () => {
    const markdown = renderCatalog(intents, 'Test catalog')
    expect(markdown).toContain('# Test catalog')
    expect(markdown).toContain('2 task intents')
    expect(markdown).toContain('### calendar (1)')
    expect(markdown).toContain('calendar_check_weekly_event')
    expect(markdown).toContain('## End-state check vocabulary')
  })

  it('truncates a long group with a count rather than printing everything', () => {
    const many: TaskIntent[] = Array.from({ length: 30 }, (_, index) => ({
      ...fromMacAgentBench(MAC_CALENDAR),
      id: `id-${String(index)}`,
    }))
    const markdown = renderCatalog(many, 'Many')
    expect(markdown).toContain('…and 5 more')
  })
})

describe('domain normalization', () => {
  it('folds the spellings each source uses for the same application', () => {
    expect(canonicalDomain('libreoffice calc')).toBe('libreoffice-calc')
    expect(canonicalDomain('libreoffice_calc')).toBe('libreoffice-calc')
    expect(canonicalDomain('libreoffice-calc')).toBe('libreoffice-calc')
    expect(canonicalDomain('LibreOffice_Calc')).toBe('libreoffice-calc')
  })

  it('folds the other aliases the sources use', () => {
    expect(canonicalDomain('vs_code')).toBe('vscode')
    expect(canonicalDomain('msedge')).toBe('edge')
    expect(canonicalDomain('reminder')).toBe('reminders')
    expect(canonicalDomain('file_explorer')).toBe('file-explorer')
    expect(canonicalDomain('mac_system_settings')).toBe('system-settings')
  })

  it('passes an unseen domain through rather than inventing a canonical name', () => {
    expect(canonicalDomain('some_new_app')).toBe('some-new-app')
    expect(canonicalDomain('Keynote')).toBe('keynote')
  })

  it('trims surrounding whitespace', () => {
    expect(canonicalDomain('  pages  ')).toBe('pages')
  })

  it('recognises the harness markers the sources carry in the domain field', () => {
    expect(isHarnessDomain('terminal_no_reset')).toBe(true)
    expect(isHarnessDomain('clock_no_kill')).toBe(true)
    expect(isHarnessDomain('multi_apps')).toBe(true)
    expect(isHarnessDomain('libreoffice-calc')).toBe(false)
  })

  it('drops harness markers and deduplicates the surviving domains', () => {
    const normalized = normalizeIntent({
      ...fromMacAgentBench(MAC_CALENDAR),
      apps: ['terminal_no_reset', 'calendar', 'Calendar'],
    })
    expect(normalized.apps).toEqual(['calendar'])
  })

  it('leaves the original intent untouched, since the raw domains are evidence', () => {
    const original = { ...fromMacAgentBench(MAC_CALENDAR), apps: ['libreoffice_calc'] }
    normalizeIntent(original)
    expect(original.apps).toEqual(['libreoffice_calc'])
  })

  it('reports which raw spellings were folded, so a dropped count is explainable', () => {
    const renames = renameReport([
      { ...fromMacAgentBench(MAC_CALENDAR), apps: ['libreoffice_calc'] },
      { ...fromMacAgentBench(MAC_CALENDAR), apps: ['vs_code'] },
    ])
    expect(renames.get('libreoffice-calc')).toEqual(['libreoffice_calc'])
    expect(renames.get('vscode')).toEqual(['vs_code'])
  })

  it('reports no rename for a domain already canonical', () => {
    expect(renameReport([{ ...fromMacAgentBench(MAC_CALENDAR), apps: ['pages'] }]).size).toBe(0)
  })

  it('counts the intents that only named harness markers', () => {
    expect(harnessOnlyCount([
      { ...fromMacAgentBench(MAC_CALENDAR), apps: ['terminal_no_reset'] },
      { ...fromMacAgentBench(MAC_CALENDAR), apps: ['pages'] },
    ])).toBe(1)
  })
})

describe('reading semantic tool catalogs', () => {
  const CATALOG = [
    {
      type: 'function',
      function: {
        name: 'CalcTools.set_cell_value',
        description: 'Set the value of a cell.',
        parameters: { type: 'object', properties: { cell: {}, value: {} }, required: ['cell', 'value'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'CalcTools.save',
        description: 'Save the workbook.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
  ]

  it('reads operation names, families, parameters and required fields', () => {
    const { catalog } = readToolCatalog('libreoffice_calc.json', CATALOG)
    expect(catalog?.family).toBe('CalcTools')
    expect(catalog?.tools.map(tool => tool.operation)).toEqual(['set_cell_value', 'save'])
    expect(catalog?.tools[0]?.parameters).toEqual(['cell', 'value'])
    expect(catalog?.tools[0]?.required).toEqual(['cell', 'value'])
    expect(catalog?.tools[0]?.description).toBe('Set the value of a cell.')
  })

  it('keeps the description verbatim, since it is evidence of the declared behaviour', () => {
    const { catalog } = readToolCatalog('x.json', CATALOG)
    expect(catalog?.tools[1]?.description).toBe('Save the workbook.')
  })

  it('refuses a JSON array that is not a tool catalog rather than returning an empty one', () => {
    const result = readToolCatalog('x.json', [{ not: 'a tool' }])
    expect(result.catalog).toBeUndefined()
    expect(result.reason).toContain('not a tool catalog')
  })

  it('refuses a non-array without throwing', () => {
    expect(readToolCatalog('x.json', { tools: [] }).reason).toBe('not a JSON array of tool definitions')
  })

  it('tolerates an entry with no parameters object', () => {
    const { catalog } = readToolCatalog('x.json', [{ function: { name: 'A.b' } }])
    expect(catalog?.tools[0]?.parameters).toEqual([])
  })

  it('tolerates a required field that is not an array', () => {
    const { catalog } = readToolCatalog('x.json', [{ function: { name: 'A.b', parameters: { properties: {}, required: 'nope' } } }])
    expect(catalog?.tools[0]?.required).toEqual([])
  })

  it('skips an entry whose name is not dotted, since it names no family', () => {
    const { catalog } = readToolCatalog('x.json', [{ function: { name: 'plain' } }, { function: { name: 'A.b' } }])
    expect(catalog?.tools).toHaveLength(1)
  })

  it('groups operations by family, sorted', () => {
    const a = readToolCatalog('a.json', CATALOG).catalog
    const b = readToolCatalog('b.json', [{ function: { name: 'WriterTools.write_text' } }]).catalog
    const groups = groupByFamily([a!, b!])
    expect([...groups.keys()]).toEqual(['CalcTools', 'WriterTools'])
  })

  it('flattens every catalog in order', () => {
    const a = readToolCatalog('a.json', CATALOG).catalog
    expect(allTools([a!])).toHaveLength(2)
  })
})
