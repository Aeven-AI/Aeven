/**
 * The agent-efficiency benchmark's task suite: small, deterministic fixture
 * repositories with a prompt and a success check, shaped after the work the
 * analysed sessions spent their steps on — targeted fixes, multi-file
 * changes, paired documents, new modules, and investigation. Checks use
 * `node --test` and `grep`, so a fixture needs no dependency install.
 *
 * @module scripts/bench/tasks
 */

/** One benchmark task. */
export interface BenchTask {
  /** Stable id used on the command line and in reports. */
  readonly id: string
  /** The single headless prompt. */
  readonly prompt: string
  /** Fixture files by repository-relative path; committed before the run. */
  readonly files: Readonly<Record<string, string>>
  /** Command run in the fixture after the agent finishes; exit 0 means success. */
  readonly check: readonly string[]
}

const PACKAGE_JSON = '{\n  "name": "bench-fixture",\n  "type": "module",\n  "private": true\n}\n'

/** The suite, in run order. */
export const TASKS: readonly BenchTask[] = [
  {
    id: 'small-fix',
    prompt: 'The test in test/price.test.js fails. Fix the bug in src/price.js so it passes. Do not change the test.',
    files: {
      'package.json': PACKAGE_JSON,
      'src/price.js': 'export function totalWithTax(items, rate) {\n  let total = 0\n  for (const item of items) total += item.price\n  return total * rate\n}\n',
      'test/price.test.js': "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { totalWithTax } from '../src/price.js'\n\ntest('adds tax on top of the total', () => {\n  assert.equal(totalWithTax([{ price: 10 }, { price: 20 }], 0.1), 33)\n})\n",
    },
    check: ['node', '--test'],
  },
  {
    id: 'multi-file-rename',
    prompt: 'Rename the function fetchUser to loadUser everywhere in this repository, including its definition, every call site, and the tests. Keep the tests passing.',
    files: {
      'package.json': PACKAGE_JSON,
      'src/users.js': 'export function fetchUser(id) {\n  return { id, name: `user-${id}` }\n}\n',
      'src/profile.js': "import { fetchUser } from './users.js'\n\nexport function profile(id) {\n  const user = fetchUser(id)\n  return `${user.name} (#${user.id})`\n}\n",
      'src/admin.js': "import { fetchUser } from './users.js'\n\nexport function isAdmin(id) {\n  return fetchUser(id).id === 1\n}\n",
      'src/report.js': "import { fetchUser } from './users.js'\n\nexport function report(ids) {\n  return ids.map(id => fetchUser(id).name).join(', ')\n}\n",
      'test/users.test.js': "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { fetchUser } from '../src/users.js'\nimport { profile } from '../src/profile.js'\nimport { isAdmin } from '../src/admin.js'\nimport { report } from '../src/report.js'\n\ntest('users', () => {\n  assert.equal(fetchUser(2).name, 'user-2')\n  assert.equal(profile(3), 'user-3 (#3)')\n  assert.equal(isAdmin(1), true)\n  assert.equal(report([1, 2]), 'user-1, user-2')\n})\n",
    },
    check: ['sh', '-c', 'node --test && ! grep -rn fetchUser src test'],
  },
  {
    id: 'doc-pair',
    prompt: 'Add a "Configuration" section to README.md documenting the PORT (default 8080) and LOG_LEVEL (default info) environment variables, and add the same section, translated, to README.zh.md. Keep the two files structurally aligned.',
    files: {
      'package.json': PACKAGE_JSON,
      'README.md': '# Service\n\nA small HTTP service.\n\n## Usage\n\nRun `node server.js`.\n',
      'README.zh.md': '# 服务\n\n一个小型 HTTP 服务。\n\n## 用法\n\n运行 `node server.js`。\n',
      'server.js': "const port = Number(process.env.PORT ?? 8080)\nconst level = process.env.LOG_LEVEL ?? 'info'\nconsole.log(port, level)\n",
    },
    check: ['sh', '-c', 'grep -q "## Configuration" README.md && grep -q PORT README.md && grep -q LOG_LEVEL README.md && grep -q PORT README.zh.md && grep -q LOG_LEVEL README.zh.md && [ "$(grep -c "^## " README.md)" = "$(grep -c "^## " README.zh.md)" ]'],
  },
  {
    id: 'new-module',
    prompt: 'Add src/slug.js exporting slugify(text): lowercase, trim, replace runs of non-alphanumeric characters with a single dash, and strip leading and trailing dashes. Add tests in test/slug.test.js covering those rules, and make sure all tests pass.',
    files: {
      'package.json': PACKAGE_JSON,
      'src/index.js': "export const version = '1.0.0'\n",
      'test/index.test.js': "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { version } from '../src/index.js'\n\ntest('version', () => assert.equal(version, '1.0.0'))\n",
    },
    check: ['sh', '-c', "node --test && node --input-type=module -e \"import { slugify } from './src/slug.js'; const ok = slugify('  Hello, World!  ') === 'hello-world' && slugify('--a__b--') === 'a-b'; process.exit(ok ? 0 : 1)\""],
  },
  {
    id: 'investigate',
    prompt: 'npm test fails intermittently for some inputs. Find the cause and fix it in the source, without weakening the tests.',
    files: {
      'package.json': '{\n  "name": "bench-fixture",\n  "type": "module",\n  "private": true,\n  "scripts": { "test": "node --test" }\n}\n',
      'src/parse.js': "import { normalize } from './normalize.js'\n\nexport function parseList(input) {\n  return normalize(input).split(',').map(part => part.trim()).filter(Boolean)\n}\n",
      'src/normalize.js': "import { stripComments } from './comments.js'\n\nexport function normalize(input) {\n  return stripComments(input).replace(/;/g, ',')\n}\n",
      'src/comments.js': "export function stripComments(input) {\n  const at = input.indexOf('#')\n  return at > 0 ? input.slice(0, at) : input\n}\n",
      'test/parse.test.js': "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { parseList } from '../src/parse.js'\n\ntest('plain list', () => assert.deepEqual(parseList('a, b; c'), ['a', 'b', 'c']))\ntest('trailing comment', () => assert.deepEqual(parseList('a, b # note'), ['a', 'b']))\ntest('comment only', () => assert.deepEqual(parseList('# nothing here'), []))\n",
    },
    check: ['node', '--test'],
  },
  {
    id: 'multi-site-cleanup',
    prompt: 'In src/config.js, replace every hardcoded timeout number with the TIMEOUT_MS constant defined at the top of the file, and remove the three console.log debug lines. Keep the tests passing.',
    files: {
      'package.json': PACKAGE_JSON,
      'src/config.js': "export const TIMEOUT_MS = 5000\n\nexport function connect() {\n  console.log('debug: connect')\n  return { timeout: 5000 }\n}\n\nexport function retry() {\n  console.log('debug: retry')\n  return { timeout: 5000, attempts: 3 }\n}\n\nexport function close() {\n  console.log('debug: close')\n  return { timeout: 5000 }\n}\n",
      'test/config.test.js': "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { connect, retry, close } from '../src/config.js'\n\ntest('timeouts', () => {\n  assert.equal(connect().timeout, 5000)\n  assert.equal(retry().attempts, 3)\n  assert.equal(close().timeout, 5000)\n})\n",
    },
    check: ['sh', '-c', 'node --test && [ "$(grep -c "5000" src/config.js)" = "1" ] && ! grep -q console.log src/config.js'],
  },
]
